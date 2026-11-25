import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  emailFromIdToken,
  exchangeCode,
  isGoogleConfigured,
  sealToken,
} from "@/lib/google/oauth";
import { getClinicConnection, syncClinicNow } from "@/lib/google/sync";
import {
  currentClinicId,
  ensureDoctorCalendars,
  setupWatch,
} from "@/lib/google/connection";

/**
 * OAuth redirect target. Google sends the user back here with `code` + `state`.
 * We verify the CSRF state, exchange the code, seal the refresh token onto the
 * clinic row, then best-effort set up push + do an initial sync. All arriving
 * with the staff member's own cookies, so we know which clinic to attach to.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const next =
    request.cookies.get("g_oauth_next")?.value === "/settings"
      ? "/settings"
      : "/agenda";
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`${next}?google=error&reason=${reason}`, origin));

  if (!isGoogleConfigured()) return fail("not_configured");

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) return fail(encodeURIComponent(oauthError));
  if (!code || !state) return fail("missing_code");

  // CSRF: the state must match the cookie we set in /connect.
  const cookieState = request.cookies.get("g_oauth_state")?.value;
  if (!cookieState || cookieState !== state) return fail("bad_state");

  const supabase = await createClient();
  const clinicId = await currentClinicId(supabase);
  if (!clinicId) return fail("no_clinic");

  let email: string | null = null;
  try {
    const tokens = await exchangeCode(origin, code);
    if (!tokens.refresh_token) return fail("no_refresh_token");
    email = emailFromIdToken(tokens.id_token);

    // Store with the service client: the refresh token column and cross-cutting
    // connection fields shouldn't depend on a staff UPDATE policy on clinics.
    const admin = createServiceClient();
    await admin
      .from("clinics")
      .update({
        google_refresh_token: sealToken(tokens.refresh_token),
        google_connected_email: email,
        google_connected_at: new Date().toISOString(),
      })
      .eq("id", clinicId);

    const conn = await getClinicConnection(admin, clinicId);
    if (conn) {
      // Provision one calendar per doctor in the connected account (idempotent).
      await ensureDoctorCalendars(admin, conn).catch(() => ({ created: 0 }));
      // Push subscription is nice-to-have (needs a public URL); never fatal.
      await setupWatch(admin, conn).catch(() => ({ watching: 0 }));
      // Initial two-way sync so the agenda reflects the calendars immediately.
      await syncClinicNow(admin, conn).catch(() => null);
    }
  } catch {
    return fail("exchange_failed");
  }

  const res = NextResponse.redirect(new URL(`${next}?google=connected`, origin));
  res.cookies.delete("g_oauth_state");
  res.cookies.delete("g_oauth_next");
  return res;
}
