import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getClinicConnection, pushSlot } from "@/lib/google/sync";

/**
 * Slot → Google push webhook. The DB trigger `trg_notify_app_slot_push` POSTs
 * here (via pg_net) whenever a slot row meaningfully changes — so EVERY writer
 * mirrors to Google in real-time, not just app-UI actions. The SMS agent books
 * through Postgres RPCs directly (never touching this app), so without this a
 * agent booking would never reach the shared calendar (the "Vasco Maria" gap).
 *
 * Auth: the shared webhook secret (same one n8n uses), sent as x-webhook-secret
 * and compared against II_WEBHOOK_SECRET. No secret configured → reject, so a
 * misconfig fails closed rather than accepting anonymous pushes.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.II_WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-webhook-secret") !== secret) {
    return new NextResponse(null, { status: 401 });
  }

  let body: { slot_id?: string; clinic_id?: string };
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const { slot_id, clinic_id } = body;
  if (!slot_id || !clinic_id) return new NextResponse(null, { status: 400 });

  try {
    const admin = createServiceClient();
    const conn = await getClinicConnection(admin, clinic_id);
    // Not connected to Google → nothing to mirror; ack so pg_net doesn't retry.
    if (conn) await pushSlot(admin, conn, slot_id);
  } catch (e) {
    // Swallow: a 500 just makes pg_net's queue retry; the next change re-fires
    // anyway, and "Sincronizar agora" is the reconcile backstop.
    console.error(`[google push] slot ${slot_id}:`, e);
    return new NextResponse(null, { status: 200 });
  }

  return new NextResponse(null, { status: 200 });
}
