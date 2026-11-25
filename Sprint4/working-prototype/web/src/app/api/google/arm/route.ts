import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getClinicConnection } from "@/lib/google/sync";
import { setupWatch } from "@/lib/google/connection";

/**
 * (Re)arm Google → app push for every connected clinic — the headless twin of
 * the "Ativar tempo real" button, so the dev-up script can register fresh watch
 * channels after a tunnel restart without a browser session. Watches expire
 * (~7 days) and the tunnel host rotates on restart, so this runs each startup.
 *
 * Auth: the shared webhook secret (same one n8n / the push webhook use), sent as
 * x-webhook-secret and compared against II_WEBHOOK_SECRET. Needs GOOGLE_WEBHOOK_
 * URL set (else setupWatch reports skipped).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.II_WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-webhook-secret") !== secret) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const admin = createServiceClient();
    // Every clinic that has connected a Google account.
    const { data: clinics } = await admin
      .from("clinics")
      .select("id")
      .not("google_refresh_token", "is", null);

    const results: Array<{ clinic_id: string; watching: number; reason?: string }> = [];
    for (const { id } of clinics ?? []) {
      const conn = await getClinicConnection(admin, id);
      if (!conn) continue;
      const r = await setupWatch(admin, conn);
      results.push({ clinic_id: id, ...r });
    }
    return NextResponse.json({ armed: results });
  } catch (e) {
    console.error("[google arm]:", e);
    return new NextResponse(null, { status: 500 });
  }
}
