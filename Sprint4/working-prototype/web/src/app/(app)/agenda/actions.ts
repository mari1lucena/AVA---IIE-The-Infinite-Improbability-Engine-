"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getClinicConnection,
  pushCancelSlot,
  pushNewSlot,
} from "@/lib/google/sync";
import { currentClinicId } from "@/lib/google/connection";

const TZ = "Europe/Lisbon";

/**
 * Best-effort mirror of a reception agenda change out to Google Calendar.
 * Wrapped so Google being unreachable can never fail the DB write that already
 * happened — the next full "Sincronizar agora" (or push webhook) reconciles.
 */
async function mirrorToGoogle(
  clinicId: string,
  action: "create" | "cancel",
  slotId: string,
) {
  try {
    const admin = createServiceClient();
    const conn = await getClinicConnection(admin, clinicId);
    if (!conn) return;
    if (action === "create") await pushNewSlot(admin, conn, slotId);
    else await pushCancelSlot(admin, conn, slotId);
  } catch {
    // Swallow — the agenda write stands; sync reconciles later.
  }
}

/**
 * Turn a Lisbon wall-clock date + time (what reception types) into a UTC ISO
 * instant (what `slots.start_time` stores). Derives the zone offset for that
 * exact date via Intl, so it stays correct across the WET/WEST DST switch.
 */
function lisbonToUtcISO(date: string, time: string): string {
  const guess = new Date(`${date}T${time}:00Z`); // first read the wall time as UTC
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asTz = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
  const offsetMs = asTz - guess.getTime(); // how far Lisbon is ahead of UTC then
  return new Date(guess.getTime() - offsetMs).toISOString();
}

/**
 * Cancel a booked slot from the agenda. Mirrors the DB `confirmation_decline`
 * path exactly: park the patient in `original_patient_id`, clear `patient_id`,
 * set status='cancelled'. That status change fires `trg_notify_n8n_slot_cancelled`
 * -> WF-B cascade, which offers the freed slot to the next candidate.
 *
 * Runs as the signed-in staff member, so RLS keeps it scoped to their clinic.
 */
export async function cancelSlot(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();

  const { data: slot } = await supabase
    .from("slots")
    .select("clinic_id, patient_id, original_patient_id")
    .eq("id", id)
    .maybeSingle();

  if (!slot) return;

  // Reception cancelling an appointment FREES the time back to an open vaga
  // (status='available'), so it stays visible and rebookable instead of
  // vanishing. The patient is parked in original_patient_id for the record.
  await supabase
    .from("slots")
    .update({
      original_patient_id: slot.original_patient_id ?? slot.patient_id,
      patient_id: null,
      status: "available",
      cancelled_at: new Date().toISOString(),
      cancellation_reason: "cancelled_by_reception",
    })
    .eq("id", id)
    .in("status", ["booked", "confirmed", "pending_confirmation", "offered"]);

  // Remove the appointment from the doctor's Google calendar (and clear the
  // event link), so the reopened vaga isn't mirrored back as a booking.
  await mirrorToGoogle(slot.clinic_id, "cancel", id);
  revalidatePath("/agenda");
}

/**
 * Create an appointment manually from the agenda. Reception picks a patient (or
 * leaves it as an open slot), a doctor, date, time and duration. clinic_id comes
 * from the signed-in staff row, so RLS (`clinic_id = auth_clinic_id()`) accepts
 * the insert. A slot with a patient is `booked` (which the day-before
 * confirmation flow will later pick up); a patient-less slot is `available`.
 */
export async function createSlot(formData: FormData) {
  const patientId = String(formData.get("patient_id") ?? "");
  const doctorId = String(formData.get("doctor_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const duration = Number(formData.get("duration") ?? 30) || 30;
  if (!date || !time) return;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: staff } = await supabase
    .from("staff")
    .select("clinic_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!staff) return;

  const startISO = lisbonToUtcISO(date, time);
  const endISO = new Date(
    new Date(startISO).getTime() + duration * 60_000,
  ).toISOString();

  // Resolve the chosen doctor (name for display; also confirms it's this clinic's).
  let doctorName: string | null = null;
  if (doctorId) {
    const { data: doc } = await supabase
      .from("doctors")
      .select("name")
      .eq("id", doctorId)
      .maybeSingle();
    doctorName = doc?.name ?? null;
  }
  const fail = (msg: string) =>
    redirect(`/agenda?date=${date}&slot_error=${encodeURIComponent(msg)}`);

  // Is there already a slot for this doctor at this exact time?
  const existing = doctorId
    ? (
        await supabase
          .from("slots")
          .select("id, status")
          .eq("clinic_id", staff.clinic_id)
          .eq("doctor_id", doctorId)
          .eq("start_time", startISO)
          .not("status", "eq", "cancelled")
          .order("status", { ascending: true })
          .limit(1)
          .maybeSingle()
      ).data
    : null;

  if (existing) {
    // Double-booking guard: an active appointment already occupies this slot.
    if (["booked", "confirmed", "pending_confirmation"].includes(existing.status)) {
      fail("Já existe uma marcação com esse médico a essa hora.");
    }
    // There's an open vaga here — FILL it instead of creating a parallel slot.
    if (existing.status === "available") {
      if (!patientId) fail("Já existe uma vaga com esse médico a essa hora.");
      await supabase
        .from("slots")
        .update({
          patient_id: patientId,
          status: "booked",
          booked_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      await mirrorToGoogle(staff.clinic_id, "create", existing.id);
      revalidatePath("/agenda");
      redirect(`/agenda?date=${date}`);
    }
  }

  const { data: created } = await supabase
    .from("slots")
    .insert({
      clinic_id: staff.clinic_id,
      patient_id: patientId || null,
      doctor_id: doctorId || null,
      doctor_name: doctorName,
      start_time: startISO,
      end_time: endISO,
      status: patientId ? "booked" : "available",
      booked_at: patientId ? new Date().toISOString() : null,
    })
    .select("id")
    .maybeSingle();

  if (created?.id) await mirrorToGoogle(staff.clinic_id, "create", created.id);

  revalidatePath("/agenda");
  redirect(`/agenda?date=${date}`);
}

/**
 * Bulk-import an agenda from a CSV file — the "bring your own schedule" path
 * for a clinic switching over from whatever they use today (e.g. a platform
 * whose only way out is a CSV export, no API). Expected columns, header row
 * required, comma-separated: data,hora,duracao,medico,paciente
 *   - data: YYYY-MM-DD or DD/MM/YYYY
 *   - hora: HH:MM (24h, Lisbon wall-clock)
 *   - duracao: minutes, optional (defaults to 30)
 *   - medico: doctor name — matched (case/accent-insensitive) against this
 *     clinic's `doctors`; unmatched names are still stored as free-text
 *     `doctor_name` so nothing is silently dropped
 *   - paciente: optional, matched against `patients.name`; blank → an
 *     `available` slot (a vaga to be filled), matched → `booked`
 *
 * Row-level failures (bad date, missing required field) are skipped and
 * counted, not fatal to the whole import — one bad row in 200 shouldn't
 * block the other 199.
 */
function parseCsv(text: string): string[][] {
  // Hand-rolled on purpose: the format is small and fixed (5 columns, no
  // embedded newlines), not worth a dependency for. Handles quoted fields
  // with embedded commas (e.g. "Silva, Dr. João") and "" as an escaped quote.
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // strip combining diacritics for matching
}

function parseCsvDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // DD/MM/YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export async function importAgendaCsv(formData: FormData) {
  const file = formData.get("csv");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/agenda?import_error=${encodeURIComponent("Escolhe um ficheiro .csv primeiro.")}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: staff } = await supabase
    .from("staff")
    .select("clinic_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!staff) return;

  const [{ data: doctors }, { data: patientsList }] = await Promise.all([
    supabase.from("doctors").select("id, name").eq("clinic_id", staff.clinic_id),
    supabase.from("patients").select("id, name").eq("clinic_id", staff.clinic_id),
  ]);
  const doctorByName = new Map((doctors ?? []).map((d) => [normalize(d.name), d]));
  const patientByName = new Map((patientsList ?? []).map((p) => [normalize(p.name), p]));

  const text = await (file as File).text();
  const allRows = parseCsv(text);
  if (!allRows.length) {
    redirect(`/agenda?import_error=${encodeURIComponent("Ficheiro vazio.")}`);
  }

  // First row is the header — locate columns by name instead of assuming order,
  // so a slightly reordered export still works.
  const header = allRows[0].map((h) => normalize(h));
  const col = (name: string) => header.indexOf(name);
  const iData = col("data");
  const iHora = col("hora");
  const iDuracao = col("duracao");
  const iMedico = col("medico");
  const iPaciente = col("paciente");
  if (iData === -1 || iHora === -1) {
    redirect(
      `/agenda?import_error=${encodeURIComponent('Cabeçalho tem de incluir pelo menos "data" e "hora".')}`,
    );
  }

  type NewSlot = {
    clinic_id: string;
    start_time: string;
    end_time: string;
    doctor_id: string | null;
    doctor_name: string | null;
    patient_id: string | null;
    status: string;
    booked_at: string | null;
  };
  const toInsert: NewSlot[] = [];
  let skipped = 0;

  for (const row of allRows.slice(1)) {
    const date = parseCsvDate(row[iData] ?? "");
    const time = (row[iHora] ?? "").trim();
    if (!date || !/^\d{1,2}:\d{2}$/.test(time)) {
      skipped++;
      continue;
    }
    const duration = Number(row[iDuracao]) || 30;
    const doctorRaw = (iMedico !== -1 ? row[iMedico] : "")?.trim() || "";
    const patientRaw = (iPaciente !== -1 ? row[iPaciente] : "")?.trim() || "";
    const doctor = doctorRaw ? doctorByName.get(normalize(doctorRaw)) : undefined;
    const patient = patientRaw ? patientByName.get(normalize(patientRaw)) : undefined;

    const startISO = lisbonToUtcISO(date, time.padStart(5, "0"));
    const endISO = new Date(new Date(startISO).getTime() + duration * 60_000).toISOString();

    toInsert.push({
      clinic_id: staff.clinic_id,
      start_time: startISO,
      end_time: endISO,
      doctor_id: doctor?.id ?? null,
      doctor_name: doctorRaw || null,
      patient_id: patient?.id ?? null,
      status: patient ? "booked" : "available",
      booked_at: patient ? new Date().toISOString() : null,
    });
  }

  let imported = 0;
  if (toInsert.length) {
    // RLS (`slots_isolation`, ALL, with_check clinic_id = auth_clinic_id()) covers
    // a multi-row insert the same way it covers createSlot's single-row one.
    const { error, data } = await supabase.from("slots").insert(toInsert).select("id");
    if (!error) imported = data?.length ?? 0;
    else skipped += toInsert.length;
  }

  revalidatePath("/agenda");
  redirect(`/agenda?imported=${imported}&skipped=${skipped}`);
}

/**
 * Reset the demo to the clean Ana/Bruno/Carla scenario. Calls the SECURITY
 * DEFINER `demo_reset()` RPC (scoped to clinica-sousa) and jumps to the seeded
 * day so the fresh appointments are visible.
 */
export async function resetDemo() {
  const supabase = await createClient();
  // Gate on an authenticated staff member. demo_reset is destructive (it wipes
  // the clinic), so it's revoked from anon/authenticated and runs only via the
  // service client here — it can't be called directly through the public API.
  const clinicId = await currentClinicId(supabase);
  if (!clinicId) return;

  const admin = createServiceClient();
  const { data } = await admin.rpc("demo_reset");

  // demo_reset wipes/recreates the DB but can't touch Google — the previously
  // mirrored events linger there. Clear each doctor's sync cursor so the next
  // sync does a FULL pull: that lets it re-see those now-orphaned events and
  // dedupe them (adopt one onto each fresh appointment, delete the strays)
  // instead of cloning them back into the agenda.
  await admin
    .from("doctors")
    .update({ google_sync_token: null })
    .eq("clinic_id", clinicId);

  revalidatePath("/agenda");
  const day = (data as { day?: string } | null)?.day;
  redirect(day ? `/agenda?date=${day}` : "/agenda");
}
