import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAuthUrl, isGoogleConfigured } from "@/lib/google/oauth";

/**
 * Kicks off the Google Calendar OAuth consent flow. Requires a signed-in staff
 * member (the middleware already gates this path). Sets a short-lived CSRF
 * cookie and redirects to Google's consent screen.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;

  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL("/agenda?google=not_configured", origin));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/agenda", origin));
  }

  // Where to return after consent — whitelisted to the two surfaces that host
  // the control, so it can never be an open redirect.
  const nextParam = request.nextUrl.searchParams.get("next");
  const next = nextParam === "/settings" ? "/settings" : "/agenda";

  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(buildAuthUrl(origin, state));
  const cookieOpts = {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600, // 10 min to complete consent
  };
  res.cookies.set("g_oauth_state", state, cookieOpts);
  res.cookies.set("g_oauth_next", next, cookieOpts);
  return res;
}
