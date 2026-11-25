import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { openToken, refreshAccessToken } from "./oauth";
import { createCalendar, stopChannel, watchEvents } from "./calendar";
import { getDoctorTargets, type ClinicConn } from "./sync";

type Supa = SupabaseClient<Database>;

/** The signed-in staff member's clinic id, or null. */
export async function currentClinicId(supabase: Supa): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("staff")
    .select("clinic_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return data?.clinic_id ?? null;
}

/**
 * The public HTTPS URL Google should POST change-notifications to. Google can't
 * reach localhost, so real-time push only works when this is set to a public
 * URL (a deploy, or the cloudflared tunnel already used for n8n). Unset →
 * push is skipped and sync falls back to manual / cron. Kept as its own env so
 * dev (localhost app) and the tunnel host can differ.
 */
function webhookAddress(): string | null {
  return process.env.GOOGLE_WEBHOOK_URL ?? null;
}

const WATCH_TTL_SECONDS = 7 * 24 * 3600; // Google caps calendar channels ~1 week

/**
 * Provision one Google calendar per active doctor that doesn't have one yet, in
 * the clinic's connected account. Idempotent — a doctor who already has a
 * calendar id is skipped, so reconnecting the same account reuses them.
 */
export async function ensureDoctorCalendars(
  supabase: Supa,
  clinic: ClinicConn,
): Promise<{ created: number }> {
  if (!clinic.google_refresh_token) return { created: 0 };
  const { data } = await supabase
    .from("doctors")
    .select("id, name, google_calendar_id")
    .eq("clinic_id", clinic.id)
    .eq("is_active", true);

  const missing = (data ?? []).filter((d) => !d.google_calendar_id);
  if (missing.length === 0) return { created: 0 };

  const accessToken = await refreshAccessToken(openToken(clinic.google_refresh_token));
  let created = 0;
  for (const doc of missing) {
    const cal = await createCalendar(accessToken, `${doc.name} — II ∞`);
    await supabase
      .from("doctors")
      .update({ google_calendar_id: cal.id, google_sync_token: null })
      .eq("id", doc.id);
    created++;
  }
  return { created };
}

/**
 * Subscribe to push notifications for every doctor calendar of the clinic.
 * Best-effort: if no public webhook URL is configured it just reports skipped,
 * leaving the connection working in manual-sync mode. Each channel's token is
 * the clinic id (routes the webhook back to the right clinic); the channel id
 * is stored per doctor so the webhook can verify it.
 */
export async function setupWatch(
  supabase: Supa,
  clinic: ClinicConn,
): Promise<{ watching: number; reason?: string }> {
  const address = webhookAddress();
  if (!address) return { watching: 0, reason: "no_webhook_url" };
  if (!clinic.google_refresh_token) return { watching: 0, reason: "not_connected" };

  const accessToken = await refreshAccessToken(openToken(clinic.google_refresh_token));
  const targets = await getDoctorTargets(supabase, clinic.id);

  // Existing channels, so a re-arm (renewal cron / tunnel restart / button)
  // stops the old channel before opening a new one — otherwise each re-arm
  // leaks a live channel that keeps pinging until it expires (~7 days),
  // causing duplicate pulls.
  const { data: prior } = await supabase
    .from("doctors")
    .select("id, google_channel_id, google_resource_id")
    .eq("clinic_id", clinic.id)
    .not("google_channel_id", "is", null);
  const priorById = new Map(
    (prior ?? []).map((d) => [d.id, d]),
  );

  let watching = 0;
  for (const t of targets) {
    const old = priorById.get(t.doctor_id);
    if (old?.google_channel_id && old.google_resource_id) {
      try {
        await stopChannel(accessToken, {
          id: old.google_channel_id,
          resourceId: old.google_resource_id,
        });
      } catch {
        // Old channel may already be gone/expired — a new one supersedes it anyway.
      }
    }
    const channelId = crypto.randomUUID();
    const channel = await watchEvents(accessToken, t.calendar_id, {
      id: channelId,
      address,
      token: clinic.id, // routes the webhook back to this clinic
      ttlSeconds: WATCH_TTL_SECONDS,
    });
    await supabase
      .from("doctors")
      .update({
        google_channel_id: channel.id,
        google_resource_id: channel.resourceId,
        google_channel_expiration: channel.expiration
          ? new Date(Number(channel.expiration)).toISOString()
          : null,
      })
      .eq("id", t.doctor_id);
    watching++;
  }
  return { watching };
}

/** Stop every doctor's push channel and clear its bookkeeping (best-effort). */
export async function teardownWatch(supabase: Supa, clinicId: string): Promise<void> {
  const { data: clinic } = await supabase
    .from("clinics")
    .select("google_refresh_token")
    .eq("id", clinicId)
    .maybeSingle();
  const refresh = (clinic as { google_refresh_token: string | null } | null)
    ?.google_refresh_token;

  const { data: doctors } = await supabase
    .from("doctors")
    .select("id, google_channel_id, google_resource_id")
    .eq("clinic_id", clinicId)
    .not("google_channel_id", "is", null);

  if (refresh) {
    const accessToken = await refreshAccessToken(openToken(refresh)).catch(() => null);
    if (accessToken) {
      for (const d of doctors ?? []) {
        if (d.google_channel_id && d.google_resource_id) {
          try {
            await stopChannel(accessToken, {
              id: d.google_channel_id,
              resourceId: d.google_resource_id,
            });
          } catch {
            // Channel may already be gone / token revoked — clearing our side is enough.
          }
        }
      }
    }
  }

  // Also drop the per-doctor calendar association + sync cursor. Otherwise a
  // later reconnect with a DIFFERENT Google account keeps the old account's
  // calendar ids (ensureDoctorCalendars only creates for doctors *missing* one),
  // and every push then 404s on calendars the new token can't see → sync_failed.
  // Clearing here means the next connect always recreates calendars in whatever
  // account is now linked.
  await supabase
    .from("doctors")
    .update({
      google_calendar_id: null,
      google_sync_token: null,
      google_channel_id: null,
      google_resource_id: null,
      google_channel_expiration: null,
    })
    .eq("clinic_id", clinicId);
}
