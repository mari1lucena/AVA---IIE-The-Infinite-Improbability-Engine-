"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getClinicConnection, syncClinicNow } from "@/lib/google/sync";
import { currentClinicId, setupWatch, teardownWatch } from "@/lib/google/connection";

// Only these two surfaces host the control, so a redirect target is whitelisted
// to one of them (never an arbitrary/open redirect from form input).
function safeReturn(formData: FormData): "/agenda" | "/settings" {
  return formData.get("redirect_to") === "/settings" ? "/settings" : "/agenda";
}

/** Manual two-way sync (pull Google → slots, push slots → Google). */
export async function syncGoogleNow(formData: FormData) {
  const back = safeReturn(formData);
  const supabase = await createClient();
  const clinicId = await currentClinicId(supabase);
  if (!clinicId) redirect(`${back}?google=error&reason=no_clinic`);

  const admin = createServiceClient();
  const conn = await getClinicConnection(admin, clinicId);
  if (!conn) redirect(`${back}?google=error&reason=not_connected`);

  try {
    await syncClinicNow(admin, conn);
  } catch (e) {
    console.error("[google sync] syncClinicNow failed:", e);
    redirect(`${back}?google=error&reason=sync_failed`);
  }
  revalidatePath("/agenda");
  revalidatePath("/settings");
  redirect(`${back}?google=synced`);
}

/**
 * (Re)arm real-time Google → app push: register a fresh watch channel on every
 * doctor calendar. Needed because Google watch channels expire (~7 days) and the
 * cloudflared tunnel host rotates on restart — both leave the connection alive
 * but in manual-sync mode until re-armed. Idempotent; requires GOOGLE_WEBHOOK_URL.
 */
export async function armRealtimeSync(formData: FormData) {
  const back = safeReturn(formData);
  const supabase = await createClient();
  const clinicId = await currentClinicId(supabase);
  if (!clinicId) redirect(`${back}?google=error&reason=no_clinic`);

  const admin = createServiceClient();
  const conn = await getClinicConnection(admin, clinicId);
  if (!conn) redirect(`${back}?google=error&reason=not_connected`);

  let result: { watching: number; reason?: string };
  try {
    result = await setupWatch(admin, conn);
  } catch (e) {
    console.error("[google watch] setupWatch failed:", e);
    redirect(`${back}?google=error&reason=watch_failed`);
  }
  revalidatePath("/agenda");
  revalidatePath("/settings");
  // No public webhook URL configured → tell the user rather than silently no-op.
  if (result.reason === "no_webhook_url") {
    redirect(`${back}?google=error&reason=no_webhook_url`);
  }
  redirect(`${back}?google=armed&watching=${result.watching}`);
}

/** Disconnect Google Calendar: stop the push channel, clear the stored tokens. */
export async function disconnectGoogle(formData: FormData) {
  const back = safeReturn(formData);
  const supabase = await createClient();
  const clinicId = await currentClinicId(supabase);
  if (!clinicId) redirect(`${back}?google=error&reason=no_clinic`);

  const admin = createServiceClient();
  await teardownWatch(admin, clinicId);
  await admin
    .from("clinics")
    .update({
      google_refresh_token: null,
      google_connected_email: null,
      google_connected_at: null,
      google_sync_token: null,
    })
    .eq("id", clinicId);
  // Reset each doctor's sync cursor so a reconnect does a full resync. Keep the
  // calendar ids so reconnecting the same account reuses the doctor calendars.
  await admin
    .from("doctors")
    .update({ google_sync_token: null })
    .eq("clinic_id", clinicId);

  revalidatePath("/agenda");
  revalidatePath("/settings");
  redirect(`${back}?google=disconnected`);
}
