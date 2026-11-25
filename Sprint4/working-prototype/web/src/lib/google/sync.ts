import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { openToken, refreshAccessToken } from "./oauth";
import {
  type GCalEvent,
  SyncTokenExpiredError,
  deleteEvent,
  insertEvent,
  listEvents,
  patchEvent,
} from "./calendar";

/**
 * The two-way mapping between our `slots` table and Google Calendar events.
 *
 * PER-DOCTOR MODEL: the clinic connects ONE Google account (refresh token on
 * `clinics`), whose account owns one calendar per doctor (`doctors.google_
 * calendar_id`). Every slot routes to ITS doctor's calendar. Google's sync
 * token and watch channel are per-calendar, so they live on the doctor row too.
 *
 *   slots  → Google : reconcilePush() (and the inline push* helpers) mirror
 *            reception/agent changes out to each doctor's calendar. Events we
 *            create are tagged extendedProperties.private.ii_slot_id so we
 *            recognize them on the way back and never duplicate.
 *   Google → slots : pullEvents() ingests changes per doctor calendar. An event
 *            WE didn't create (the doctor typed straight into their calendar —
 *            the whole point of "own the agenda without the incumbent's API")
 *            becomes a new slot for THAT doctor. A cancelled event cancels its
 *            slot (which fires the WF-B cascade).
 *
 * Freshness is via per-calendar incremental sync tokens; the push webhook just
 * says "pull now", it carries no data.
 */

type Supa = SupabaseClient<Database>;
const TZ = "Europe/Lisbon";
const II_MARK = "Gerido por II ∞ (agenda inteligente).";

/** The clinic's Google account connection — just the refresh token holder. */
export type ClinicConn = {
  id: string;
  google_refresh_token: string | null;
};

/** One doctor's calendar + its incremental-sync cursor. */
export type DoctorTarget = {
  doctor_id: string;
  name: string;
  calendar_id: string;
  sync_token: string | null;
};

/** Load a clinic's Google connection, or null if it isn't connected. */
export async function getClinicConnection(
  supabase: Supa,
  clinicId: string,
): Promise<ClinicConn | null> {
  const { data } = await supabase
    .from("clinics")
    .select("id, google_refresh_token")
    .eq("id", clinicId)
    .maybeSingle();
  if (!data || !data.google_refresh_token) return null;
  return data as ClinicConn;
}

/** Active doctors of a clinic that have a provisioned calendar. */
export async function getDoctorTargets(
  supabase: Supa,
  clinicId: string,
): Promise<DoctorTarget[]> {
  const { data } = await supabase
    .from("doctors")
    .select("id, name, google_calendar_id, google_sync_token")
    .eq("clinic_id", clinicId)
    .eq("is_active", true)
    .not("google_calendar_id", "is", null);
  return (data ?? [])
    .filter((d) => d.google_calendar_id)
    .map((d) => ({
      doctor_id: d.id,
      name: d.name,
      calendar_id: d.google_calendar_id as string,
      sync_token: d.google_sync_token ?? null,
    }));
}

async function accessTokenFor(clinic: ClinicConn): Promise<string> {
  if (!clinic.google_refresh_token) throw new Error("Clinic is not connected");
  return refreshAccessToken(openToken(clinic.google_refresh_token));
}

// --- slot ⇄ event mapping ---------------------------------------------------

type SlotForPush = {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  doctor_name: string | null;
  notes: string | null;
  google_event_id: string | null;
  patient: { name: string } | null;
  doctor: { google_calendar_id: string | null } | null;
};

function slotTitle(slot: SlotForPush): string {
  return slot.patient?.name ?? slot.notes ?? "Vaga";
}

function slotToEvent(slot: SlotForPush): Partial<GCalEvent> {
  return {
    summary: slotTitle(slot),
    description:
      `Estado: ${slot.status}` +
      (slot.doctor_name ? ` · ${slot.doctor_name}` : "") +
      `\n\n${II_MARK}`,
    start: { dateTime: slot.start_time, timeZone: TZ },
    end: { dateTime: slot.end_time, timeZone: TZ },
    extendedProperties: {
      private: { ii_slot_id: slot.id, ii_managed: "1", ii_status: slot.status },
    },
  };
}

/** RFC3339 instant from a Google event side (dateTime), or null for all-day. */
function eventInstant(dt?: { dateTime?: string }): string | null {
  if (!dt?.dateTime) return null;
  return new Date(dt.dateTime).toISOString();
}

// --- Google → slots (pull) --------------------------------------------------

const WINDOW_BACK_DAYS = 1;
const WINDOW_FWD_DAYS = 90;

function fullSyncWindow() {
  const now = Date.now();
  return {
    timeMin: new Date(now - WINDOW_BACK_DAYS * 86400_000).toISOString(),
    timeMax: new Date(now + WINDOW_FWD_DAYS * 86400_000).toISOString(),
  };
}

/** Pull one doctor's calendar into `slots`; returns applied count. */
async function pullOneCalendar(
  supabase: Supa,
  clinicId: string,
  accessToken: string,
  target: DoctorTarget,
): Promise<number> {
  const collect = async (syncToken: string | null): Promise<{
    items: GCalEvent[];
    nextSyncToken?: string;
  }> => {
    const items: GCalEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    const win = syncToken ? {} : fullSyncWindow();
    do {
      const page = await listEvents(accessToken, target.calendar_id, {
        syncToken,
        pageToken,
        ...win,
      });
      items.push(...page.items);
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    return { items, nextSyncToken };
  };

  let result: { items: GCalEvent[]; nextSyncToken?: string };
  try {
    result = await collect(target.sync_token);
  } catch (e) {
    if (e instanceof SyncTokenExpiredError) {
      result = await collect(null); // token lapsed → full resync
    } else throw e;
  }

  let applied = 0;
  for (const ev of result.items) {
    // One malformed / problematic event must not abort the whole pull.
    try {
    const priv = ev.extendedProperties?.private;

    // Cancelled in Google → cancel the mapped slot (fires the cascade trigger).
    if (ev.status === "cancelled") {
      // A doctor deleting the event in Google frees that time — reopen it as an
      // available vaga (same as a reception cancel), detach the patient, and
      // drop the event link (the event is already gone, so reconcile must not
      // try to re-delete it).
      const { data } = await supabase
        .from("slots")
        .update({
          status: "available",
          patient_id: null,
          cancelled_at: new Date().toISOString(),
          cancellation_reason: "cancelled_in_google_calendar",
          google_event_id: null,
          last_synced_at: new Date().toISOString(),
        })
        .eq("clinic_id", clinicId)
        .eq("google_event_id", ev.id)
        .not("status", "eq", "available")
        .select("id");
      applied += data?.length ?? 0;
      continue;
    }

    const start = eventInstant(ev.start);
    const end = eventInstant(ev.end);
    if (!start || !end) continue; // all-day / malformed → not a consultation slot

    // Does a slot already track this event?
    const { data: existing } = await supabase
      .from("slots")
      .select("id, status")
      .eq("clinic_id", clinicId)
      .eq("google_event_id", ev.id)
      .maybeSingle();

    if (existing) {
      // An event we manage (ii_managed) is just the echo of our own push —
      // leave the slot as the source of truth. Only mirror edits made to a
      // slot's time/title directly in Google (external events, or a moved one).
      if (priv?.ii_managed === "1") continue;
      await supabase
        .from("slots")
        .update({
          start_time: start,
          end_time: end,
          notes: ev.summary ?? existing.status,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      applied++;
      continue;
    }

    // Is there already a slot for this doctor at exactly this time? Prefer one
    // not yet linked to a Google event — an open vaga, or a fresh booking that
    // hasn't been mirrored yet (e.g. right after a demo reset). We reuse it
    // rather than create a parallel slot.
    const { data: sameTime } = await supabase
      .from("slots")
      .select("id, status, google_event_id")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", target.doctor_id)
      .eq("start_time", start)
      .not("status", "eq", "cancelled")
      .order("google_event_id", { nullsFirst: true })
      .limit(1)
      .maybeSingle();

    if (sameTime && !sameTime.google_event_id) {
      // FILL an open vaga (→ booked) or ADOPT an existing unlinked booking —
      // either way one slot, one event, no duplicate.
      const upd: {
        notes: string | null;
        google_event_id: string;
        last_synced_at: string;
        status?: string;
        booked_at?: string;
      } = {
        notes: ev.summary ?? null,
        google_event_id: ev.id,
        last_synced_at: new Date().toISOString(),
      };
      if (sameTime.status === "available") {
        upd.status = "booked";
        upd.booked_at = new Date().toISOString();
      }
      await supabase.from("slots").update(upd).eq("id", sameTime.id);
      applied++;
      continue;
    }

    if (sameTime) {
      // The time is already booked AND linked to a DIFFERENT event → this event
      // is a stray duplicate (e.g. an old event left in Google after a demo
      // reset). Remove it from Google so it can't spawn a phantom slot.
      try {
        await deleteEvent(accessToken, target.calendar_id, ev.id);
      } catch (err) {
        console.error(`[google pull] remove duplicate event ${ev.id}:`, err);
      }
      continue;
    }

    // No slot at this time → a genuinely new appointment for that doctor.
    await supabase.from("slots").insert({
      clinic_id: clinicId,
      doctor_id: target.doctor_id,
      start_time: start,
      end_time: end,
      status: "booked",
      notes: ev.summary ?? null,
      google_event_id: ev.id,
      last_synced_at: new Date().toISOString(),
    });
    applied++;
    } catch (e) {
      console.error(`[google pull] event ${ev.id}:`, e);
    }
  }

  const nextSyncToken = result.nextSyncToken ?? target.sync_token ?? null;
  await supabase
    .from("doctors")
    .update({ google_sync_token: nextSyncToken })
    .eq("id", target.doctor_id);

  return applied;
}

/**
 * Pull Google changes into `slots` across every doctor's calendar. Incremental
 * per calendar when a sync token exists, else a bounded full sync.
 */
export async function pullEvents(
  supabase: Supa,
  clinic: ClinicConn,
): Promise<{ applied: number }> {
  const accessToken = await accessTokenFor(clinic);
  const targets = await getDoctorTargets(supabase, clinic.id);
  let applied = 0;
  for (const t of targets) {
    applied += await pullOneCalendar(supabase, clinic.id, accessToken, t);
  }
  return { applied };
}

// --- slots → Google (push) --------------------------------------------------

const SLOT_PUSH_COLS =
  "id, start_time, end_time, status, doctor_name, notes, google_event_id, patient:patients!slots_patient_id_fkey(name), doctor:doctors!slots_doctor_id_fkey(google_calendar_id)";

// Only real appointments belong on a doctor's calendar — NOT the empty grid of
// `available` vagas (there are ~450 of them) nor cancelled/offered slots. A slot
// that leaves this set but still has a google_event_id gets its event cleaned up.
const APPOINTMENT_STATUSES = new Set([
  "booked",
  "confirmed",
  "pending_confirmation",
]);

/** The calendar a slot pushes to — its doctor's, or null if unroutable. */
function slotCalendar(slot: SlotForPush): string | null {
  return slot.doctor?.google_calendar_id ?? null;
}

/**
 * Mirror the DB out to Google for the forward window: create events for
 * active slots that lack one, refresh recently-changed ones, and remove events
 * for cancelled slots. Each slot goes to its doctor's calendar; slots with no
 * doctor calendar are skipped. Idempotent — safe to run as often as you like.
 */
export async function reconcilePush(
  supabase: Supa,
  clinic: ClinicConn,
): Promise<{ created: number; updated: number; removed: number; failed: number }> {
  const accessToken = await accessTokenFor(clinic);
  const win = fullSyncWindow();

  // Pull only real appointments, plus any slot still carrying an event to clean
  // up — never the ~450 `available` vagas.
  const { data } = await supabase
    .from("slots")
    .select(SLOT_PUSH_COLS)
    .eq("clinic_id", clinic.id)
    .gte("start_time", win.timeMin)
    .lte("start_time", win.timeMax)
    .or(
      "status.in.(booked,confirmed,pending_confirmation),google_event_id.not.is.null",
    );

  const slots = (data ?? []) as unknown as SlotForPush[];
  let created = 0,
    updated = 0,
    removed = 0,
    failed = 0;

  for (const slot of slots) {
    // One bad event (a timeout, a transient Google error, a gone calendar) must
    // NOT abort the whole sync — skip it, log it, carry on.
    try {
      const outcome = await pushSlotRow(supabase, accessToken, slot);
      if (outcome === "created") created++;
      else if (outcome === "updated") updated++;
      else if (outcome === "removed") removed++;
    } catch (e) {
      console.error(`[google reconcile] slot ${slot.id} (${slot.status}):`, e);
      failed++;
    }
  }
  return { created, updated, removed, failed };
}

/**
 * Mirror ONE slot row out to Google: create the event if it's a real
 * appointment without one, patch it if it changed, or delete it if the slot is
 * no longer an appointment. The single-slot core shared by reconcilePush (batch)
 * and pushSlot (the DB-trigger webhook). Returns what it did.
 */
async function pushSlotRow(
  supabase: Supa,
  accessToken: string,
  slot: SlotForPush,
): Promise<"created" | "updated" | "removed" | "skipped"> {
  const cal = slotCalendar(slot);
  if (!cal) return "skipped"; // no doctor calendar to route to

  // Not (or no longer) a real appointment → remove its event if it had one.
  if (!APPOINTMENT_STATUSES.has(slot.status)) {
    if (!slot.google_event_id) return "skipped";
    await deleteEvent(accessToken, cal, slot.google_event_id);
    await supabase
      .from("slots")
      .update({ google_event_id: null, last_synced_at: new Date().toISOString() })
      .eq("id", slot.id);
    return "removed";
  }
  if (!slot.google_event_id) {
    const ev = await insertEvent(accessToken, cal, slotToEvent(slot));
    await supabase
      .from("slots")
      .update({ google_event_id: ev.id, last_synced_at: new Date().toISOString() })
      .eq("id", slot.id);
    return "created";
  }
  await patchEvent(accessToken, cal, slot.google_event_id, slotToEvent(slot));
  await supabase
    .from("slots")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", slot.id);
  return "updated";
}

/**
 * Push a single slot by id to its doctor's Google calendar — the real-time
 * write path used by the DB-trigger webhook (`/api/google/push`), so that EVERY
 * writer (the SMS agent's RPCs, reception, anything that changes the row)
 * publishes to the shared calendar, not just app-UI actions.
 */
export async function pushSlot(supabase: Supa, clinic: ClinicConn, slotId: string) {
  const accessToken = await accessTokenFor(clinic);
  const { data } = await supabase
    .from("slots")
    .select(SLOT_PUSH_COLS)
    .eq("id", slotId)
    .maybeSingle();
  const slot = data as unknown as SlotForPush | null;
  if (!slot) return;
  await pushSlotRow(supabase, accessToken, slot);
}

/** Pull + push in one shot — used by "Sincronizar agora" and the webhook. */
export async function syncClinicNow(supabase: Supa, clinic: ClinicConn) {
  const pull = await pullEvents(supabase, clinic);
  const push = await reconcilePush(supabase, clinic);
  return { pull, push };
}

// --- targeted inline pushes (called from the agenda server actions) ---------

/** Create a Google event for a single freshly-created slot (in its doctor's calendar). */
export async function pushNewSlot(supabase: Supa, clinic: ClinicConn, slotId: string) {
  const accessToken = await accessTokenFor(clinic);
  const { data } = await supabase
    .from("slots")
    .select(SLOT_PUSH_COLS)
    .eq("id", slotId)
    .maybeSingle();
  const slot = data as unknown as SlotForPush | null;
  if (!slot || slot.google_event_id) return;
  if (!APPOINTMENT_STATUSES.has(slot.status)) return; // don't mirror empty vagas
  const cal = slotCalendar(slot);
  if (!cal) return; // no doctor calendar to route to
  const ev = await insertEvent(accessToken, cal, slotToEvent(slot));
  await supabase
    .from("slots")
    .update({ google_event_id: ev.id, last_synced_at: new Date().toISOString() })
    .eq("id", slotId);
}

/** Delete the Google event backing a single just-cancelled slot. */
export async function pushCancelSlot(supabase: Supa, clinic: ClinicConn, slotId: string) {
  const accessToken = await accessTokenFor(clinic);
  const { data } = await supabase
    .from("slots")
    .select(SLOT_PUSH_COLS)
    .eq("id", slotId)
    .maybeSingle();
  const slot = data as unknown as SlotForPush | null;
  const eventId = slot?.google_event_id;
  const cal = slot ? slotCalendar(slot) : null;
  if (!eventId || !cal) return;
  await deleteEvent(accessToken, cal, eventId);
  await supabase
    .from("slots")
    .update({ google_event_id: null, last_synced_at: new Date().toISOString() })
    .eq("id", slotId);
}
