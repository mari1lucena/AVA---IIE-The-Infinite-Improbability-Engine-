#!/usr/bin/env node
// Flip which n8n workflow handles real inbound patient replies: WF-A (the
// handwritten branching workflow) or the tool-calling Agent Pilot.
//
// Run from working-prototype/web:
//   npm run switch-agent               -> show which one is currently live
//   npm run switch-agent -- wfa        -> point real traffic at WF-A
//   npm run switch-agent -- pilot      -> point real traffic at the Agent Pilot
//
// This only repoints private.app_config.n8n_inbound_webhook_url (via the
// admin_get_agent_route / admin_set_agent_route RPCs, service_role only) —
// it does not touch n8n itself. Both workflows stay "active" in n8n either
// way; only one of them is actually reachable from real traffic at a time,
// because the Supabase trigger only ever calls the one URL stored there.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env.local loader (no extra dependency) — same file Next.js reads.
function loadEnvLocal() {
  const envPath = join(__dirname, "..", ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
  );
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY is required (bypasses RLS) — get it from",
    "Supabase Dashboard → Project Settings → API → service_role secret.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

const target = process.argv[2]; // undefined | "wfa" | "pilot"

function report(data, label) {
  const route = data.active_route;
  const icon = route === "pilot" ? "🧪" : route === "wfa" ? "🟢" : "❓";
  console.log(`${icon} ${label}: ${route.toUpperCase()}`);
  console.log(`   inbound_webhook_url = ${data.inbound_webhook_url}`);
}

if (!target) {
  const { data, error } = await supabase.rpc("admin_get_agent_route");
  if (error) {
    console.error("Failed to read current route:", error.message);
    process.exit(1);
  }
  report(data, "Currently live");
  console.log("\nUsage: npm run switch-agent -- wfa|pilot");
  process.exit(0);
}

if (target !== "wfa" && target !== "pilot") {
  console.error(`Unknown target "${target}". Use "wfa" or "pilot".`);
  process.exit(1);
}

const { data, error } = await supabase.rpc("admin_set_agent_route", {
  p_target: target,
});
if (error) {
  console.error("Failed to switch route:", error.message);
  process.exit(1);
}
if (data.status !== "ok") {
  console.error("Switch rejected:", data.reason);
  process.exit(1);
}
report(data, "Now live");
