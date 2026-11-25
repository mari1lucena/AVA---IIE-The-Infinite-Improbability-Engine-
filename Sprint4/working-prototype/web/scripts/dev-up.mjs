#!/usr/bin/env node
// One command to bring the whole dev stack up after cloudflared's quick-tunnel
// hosts have rotated (they change every restart). Replaces the ~8 manual steps:
//
//   1. start a cloudflared tunnel to the app   (:3000)
//   2. start a cloudflared tunnel to n8n        (:5678)
//   3. repoint private.app_config.n8n_inbound_webhook_url  (keeps pilot/wfa path)
//   4. repoint private.app_config.n8n_cascade_webhook_url
//   5. repoint private.app_config.app_google_push_url       (Direction A)
//   6. rewrite GOOGLE_WEBHOOK_URL in .env.local              (Direction B)
//   7. (re)start `next dev` so it reads the fresh env
//   8. re-arm the Google watch channels once the app is healthy
//
// Run from working-prototype/web:   npm run dev:up
// Ctrl+C tears down both tunnels and the dev server.
//
// NOTE: n8n itself is NOT started here — make sure your n8n container is already
// listening on :5678 (the tunnel is created regardless; it just needs something
// to forward to when a request arrives).

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");

const APP_PORT = 3000;
const N8N_PORT = 5678;
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

// --- .env.local (the same file Next.js reads) -------------------------------
function loadEnvLocal() {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (!(k in process.env)) process.env[k] = t.slice(eq + 1).trim();
  }
}
function setEnvLocal(key, value) {
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split("\n") : [];
  let found = false;
  const out = lines.map((l) => {
    if (l.trim().startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return l;
  });
  if (!found) out.push(`${key}=${value}`);
  writeFileSync(envPath, out.join("\n"));
}

loadEnvLocal();

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = process.env.II_WEBHOOK_SECRET;
if (!SUPA_URL || !SERVICE_KEY || !SECRET) {
  console.error(
    "Missing env in .env.local — need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and II_WEBHOOK_SECRET.",
  );
  process.exit(1);
}

// --- child-process bookkeeping + teardown -----------------------------------
const children = [];
let tornDown = false;
function teardown() {
  if (tornDown) return;
  tornDown = true;
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}
process.on("SIGINT", () => {
  console.log("\n⏹  Shutting down tunnels + dev server…");
  teardown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  teardown();
  process.exit(0);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start a cloudflared quick tunnel to a local port; resolve with its public URL. */
function startTunnel(port, label) {
  return new Promise((resolve, reject) => {
    const cf = spawn(
      "cloudflared",
      ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    children.push(cf);
    let settled = false;
    const onData = (buf) => {
      const m = String(buf).match(URL_RE);
      if (m && !settled) {
        settled = true;
        resolve(m[0]);
      }
    };
    cf.stdout.on("data", onData);
    cf.stderr.on("data", onData);
    cf.on("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`cloudflared (${label}) exited (code ${code}) before printing a URL`));
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`cloudflared (${label}) timed out waiting for a URL`));
      }
    }, 45000);
  });
}

async function rpc(fn, args) {
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn} → HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function waitForApp(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(`http://localhost:${APP_PORT}/login`);
      return true;
    } catch {
      await sleep(1000);
    }
  }
  return false;
}

async function main() {
  // Refuse to start on top of an existing dev server (this script starts its
  // own `next dev`, which would collide on :3000). Fail early and clearly.
  try {
    await fetch(`http://localhost:${APP_PORT}/login`);
    console.error(
      `Something is already serving on :${APP_PORT}. Stop your existing 'next dev' (and any manual tunnels) first, then re-run npm run dev:up.`,
    );
    process.exit(1);
  } catch {
    /* port free — good */
  }

  console.log("🌩  Starting cloudflared tunnels (app :3000 + n8n :5678)…");
  const [appBase, n8nBase] = await Promise.all([
    startTunnel(APP_PORT, "app"),
    startTunnel(N8N_PORT, "n8n"),
  ]);
  console.log(`   app → ${appBase}`);
  console.log(`   n8n → ${n8nBase}`);

  console.log("🗄  Repointing app_config URLs (Supabase)…");
  const cfg = await rpc("admin_set_tunnel_config", {
    p_n8n_base: n8nBase,
    p_app_base: appBase,
  });
  console.log(`   inbound → ${cfg.n8n_inbound_webhook_url}`);
  console.log(`   cascade → ${cfg.n8n_cascade_webhook_url}`);
  console.log(`   push    → ${cfg.app_google_push_url}`);

  const webhook = `${appBase}/api/google/notifications`;
  setEnvLocal("GOOGLE_WEBHOOK_URL", webhook);
  console.log(`📝 .env.local GOOGLE_WEBHOOK_URL → ${webhook}`);

  console.log("▶️  Starting `next dev`…");
  const dev = spawn("npm", ["run", "dev"], { stdio: "inherit" });
  children.push(dev);
  dev.on("exit", (code) => {
    console.log(`\nnext dev exited (code ${code}) — tearing down tunnels.`);
    teardown();
    process.exit(code ?? 0);
  });

  console.log("⏳ Waiting for the app to be healthy…");
  if (!(await waitForApp(90000))) {
    console.error("⚠️  App did not become healthy in time — skipping watch re-arm. Once it's up, arm from Settings › 'Renovar tempo real'.");
    return;
  }
  await sleep(1500); // let the route compile on first hit
  try {
    const res = await fetch(`http://localhost:${APP_PORT}/api/google/arm`, {
      method: "POST",
      headers: { "x-webhook-secret": SECRET },
    });
    const body = await res.json().catch(() => null);
    if (res.ok) {
      const total = (body?.armed ?? []).reduce((n, r) => n + (r.watching ?? 0), 0);
      console.log(`📡 Watch re-armed — ${total} calendar(s) now push in real-time.`);
    } else {
      console.error(`⚠️  Watch re-arm returned HTTP ${res.status}. Arm manually from Settings.`);
    }
  } catch (e) {
    console.error("⚠️  Watch re-arm failed:", e.message, "— arm manually from Settings.");
  }

  console.log("\n✅ Stack is up. Both directions of Google sync are live. Ctrl+C to stop.\n");
}

main().catch((e) => {
  console.error("dev-up failed:", e.message);
  teardown();
  process.exit(1);
});
