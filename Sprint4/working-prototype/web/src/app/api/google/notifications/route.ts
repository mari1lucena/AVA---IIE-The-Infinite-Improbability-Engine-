import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getClinicConnection, pullEvents } from "@/lib/google/sync";

/**
 * Google Calendar push webhook. Google POSTs here (no body, headers only)
 * whenever a watched calendar changes — the near-real-time half of the sync.
 * The ping carries no data, just "something changed", so we pull the delta.
 *
 * Auth: the channel token (X-Goog-Channel-Token) is the clinic id we set at
 * watch time, and we additionally require the channel id to match the one we
 * stored — so a spoofed ping for a clinic can't trigger a pull.
 */
export async function POST(request: NextRequest) {
  const state = request.headers.get("x-goog-resource-state");
  const channelToken = request.headers.get("x-goog-channel-token"); // = clinic id
  const channelId = request.headers.get("x-goog-channel-id");

  // Initial handshake ping right after watch() — nothing to do, just ack.
  if (state === "sync") return new NextResponse(null, { status: 200 });
  if (!channelToken || !channelId) return new NextResponse(null, { status: 400 });

  try {
    const admin = createServiceClient();

    // Verified: the token names a real clinic AND the channel id belongs to one
    // of that clinic's doctor calendars (channels are per doctor). A spoofed
    // ping for a clinic can't trigger a pull.
    const { data: doctor } = await admin
      .from("doctors")
      .select("id")
      .eq("clinic_id", channelToken)
      .eq("google_channel_id", channelId)
      .maybeSingle();
    if (!doctor) return new NextResponse(null, { status: 404 });

    // Pull the whole clinic (per-calendar incremental tokens keep this cheap).
    const conn = await getClinicConnection(admin, channelToken);
    if (conn) await pullEvents(admin, conn);
  } catch {
    // Swallow: a 500 makes Google retry/back off; the next change re-pings anyway.
    return new NextResponse(null, { status: 200 });
  }

  return new NextResponse(null, { status: 200 });
}
