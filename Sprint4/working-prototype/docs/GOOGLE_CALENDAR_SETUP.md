# Google Calendar two-way sync — setup

The agenda (`/agenda`) can sync **two-way** with a clinic's Google Calendar,
**one calendar per doctor**:

- The clinic connects **one** Google account (its refresh token lives on
  `clinics`). On connect we auto-create **one calendar per active doctor** in
  that account ("Dr. Sousa — II ∞", etc.) and store each id on the doctor row
  (`doctors.google_calendar_id`). No manual calendar setup.
- **Google → agenda**: events created/moved/cancelled in a doctor's calendar
  flow into `slots` for that doctor (near-real-time via push, or on demand). An
  event created straight in the calendar becomes a slot — this is how a clinic's
  agenda is ingested **without any incumbent (IMED/Clicloud) API**.
- **agenda → Google**: reception creating/cancelling a slot, and (via reconcile)
  agent changes, are mirrored out to **that slot's doctor's** calendar.

Google's incremental sync token and push channel are per-calendar, so they live
on the doctor row too (`doctors.google_sync_token` / `google_channel_id` /
`google_resource_id` / `google_channel_expiration`, migration `026`).

All the code is in place. It stays **dormant and honest** until the OAuth
credentials below are set: with none set, the header button shows
"Google Calendar (configurar)" (disabled) instead of pretending to work.

---

## 1. Create the Google OAuth app (once)

1. Go to <https://console.cloud.google.com/> → create/select a project.
2. **APIs & Services → Library →** enable the **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**: External, add your Google
   account(s) as **Test users** (no verification needed while in Testing).
   Scope used: `https://www.googleapis.com/auth/calendar` (full — needed to
   create one calendar per doctor).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application**. Add an **Authorized redirect URI**:
   - local dev: `http://localhost:3000/api/google/callback`
   - deployed:  `https://YOUR_DOMAIN/api/google/callback`
5. Copy the **Client ID** and **Client secret**.

## 2. Fill the env vars (`web/.env.local`)

```bash
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
# 32 random bytes, base64 — seals the refresh token at rest. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
GOOGLE_TOKEN_ENC_KEY=base64-of-32-random-bytes

# OPTIONAL — only needed for real-time push (see §4). Public HTTPS URL Google
# can reach; the cloudflared tunnel already used for n8n works:
# GOOGLE_WEBHOOK_URL=https://<public-host>/api/google/notifications
# OPTIONAL — override the derived callback (normally not needed):
# GOOGLE_OAUTH_REDIRECT_URI=https://YOUR_DOMAIN/api/google/callback
```

`SUPABASE_SERVICE_ROLE_KEY` must also be set (it already is) — the callback and
the push webhook write the sealed token / pull deltas with it.

Restart `next dev` after editing `.env.local`.

## 3. Connect a clinic

Sign in → **Definições → Integrações → Ligar Google Calendar** → consent. On
return the refresh token is sealed onto the clinic row, **one calendar per
doctor is auto-created** in the connected account, an initial two-way sync runs,
and the card shows the connected state (account email · "Sincronizar agora" ·
"Desligar"). The **Agenda** header carries a compact status chip + "Sincronizar"
once connected.

> The consent scope is `https://www.googleapis.com/auth/calendar` (full —
> needed to create the per-doctor calendars, and it covers events too). Already
> requested in `oauth.ts`.

## 4. Freshness: real-time vs. manual (current state + how to go real-time)

The two directions of sync have different freshness, on purpose.

### App → Google is already real-time

A reception booking / cancel in the agenda mirrors to that doctor's Google
calendar **immediately** (the inline push in `createSlot` / `cancelSlot`). No
setup, no tunnel. (This only works because a booking carries a `doctor_id` — the
"Nova marcação" form uses a doctor dropdown for exactly this reason.)

### Google → App is MANUAL right now (by choice)

A change made **in Google** (a doctor edits/deletes an event, or types a new
one) reaches the agenda only when someone presses **"Sincronizar"** (or the
push webhook fires, see below). The connected badge shows **"· manual"** when
real-time push is off. This is the current, deliberate default — it needs **no
public exposure of the app**.

### Making Google → App real-time (the webhook) — NOT enabled yet

The code fully supports near-real-time push: on connect we call `events.watch`
per doctor calendar, so Google POSTs `…/api/google/notifications` within seconds
of any change and we pull the delta. To turn it on:

1. Set `GOOGLE_WEBHOOK_URL` to a **public HTTPS URL** that reaches the app's
   `/api/google/notifications` route, then **reconnect** Google (so the watch
   channels are created). The badge flips to "· tempo real".
2. Google **cannot reach `localhost`**, so in dev this needs a tunnel.

**Tunnel gotcha — it is NOT the n8n tunnel.** The n8n tunnel forwards to n8n
(port **5678**); the Next.js app runs on port **3000**. Google must reach the
**app**, so you need a *separate* cloudflared quick tunnel pointed at 3000:

```bash
cloudflared tunnel --url http://localhost:3000
# → https://<random>.trycloudflare.com
# GOOGLE_WEBHOOK_URL=https://<random>.trycloudflare.com/api/google/notifications
```

**⚠️ Security — why it's left off for now.** A quick tunnel publishes the
**entire local app** to the public internet, not just the webhook. Mitigating
factors: the sensitive pages are behind login (auth middleware), the webhook
validates the Google channel id/token (forged POSTs are ignored), and the URL is
random + ephemeral. It's the same risk class as the n8n tunnel. Still, exposing
an un-hardened dev app is a real trade-off — hence manual is the default.

**Safer ways to get Google → App fresh without exposing the app:**
- **Poll instead of push.** A scheduled job calls the sync every 1–2 min —
  near-real-time, and traffic only goes *outbound* to Google (nothing exposed).
  Can run on the **n8n you already have** (n8n → `http://localhost:3000/...`
  directly, both local, no tunnel) via a small secret-protected sync endpoint.
- **Deploy the app** (Vercel/etc. with a real domain). Then
  `GOOGLE_WEBHOOK_URL = https://yourdomain/api/google/notifications` — a normal
  hardened endpoint, no tunnel, nothing on your laptop exposed. This is the real
  production answer.

**Also note:** watch channels lapse after ~1 week and need re-arming (reconnect,
or a future cron renewer); and a quick-tunnel host changes on every restart, so
`GOOGLE_WEBHOOK_URL` would need updating + a reconnect each time.

## 5. Letting real clinics connect WITHOUT the "unverified app" warning

This is the difference between the demo and production. **The clinic side is
always one click** — the "Ligar Google Calendar" button IS the OAuth flow: the
clinic clicks it → Google's own consent screen → Allow → synced. They never
touch Google Cloud Console or any credential. The catch is a Google *policy*
gate on what that consent screen looks like:

- **Testing mode (what the demo uses):** only Google accounts you add as **Test
  users** (max 100) can connect, and they must click past a scary
  **"Google hasn't verified this app"** warning. Fine for interviews — add the
  interviewee's or a demo clinic account as a test user and it works end to end.
- **Production ("In production" + verified):** to let **any** clinic connect
  with **no warning**, the OAuth app must pass **Google verification**. Because
  we request the **full `calendar` scope** (needed to auto-create the per-doctor
  calendars), Google classes it as a **restricted** scope → verification
  includes an annual **CASA security assessment** (can be costly/slow), on top
  of brand verification (logo, domain, privacy policy). This is a real
  production barrier, not a demo one.

**Lighter alternative if restricted-scope verification becomes a blocker:** drop
back to the **`calendar.events`** scope (Google's *sensitive* tier — lighter
review, no CASA). We then **cannot auto-create calendars**, so each clinic would
instead pick/share one existing Google calendar per doctor (more clinic setup,
much lighter Google review). Trade-off to revisit when approaching real paying
clinics; the demo does not need it.

---

## How it maps (implementation notes)

- Files: `web/src/lib/google/{oauth,calendar,sync,connection}.ts`, routes
  `web/src/app/api/google/{connect,callback,notifications}/route.ts`, agenda
  actions `google-actions.ts`, control `google-calendar-control.tsx`.
- **No new npm deps** — OAuth + Calendar REST via `fetch`, refresh token sealed
  with Node `crypto` (AES-256-GCM) under `GOOGLE_TOKEN_ENC_KEY`.
- Echo-loop guard: events we create carry
  `extendedProperties.private.ii_slot_id` + `ii_managed=1`; on pull we skip
  re-writing our own events and only ingest/update externally-created ones.
- A slot ingested from Google (no patient row) shows its event title from
  `slots.notes`.
- A **cancelled** Google event cancels its slot → fires
  `trg_notify_n8n_slot_cancelled` → the WF-B cascade, exactly like any other
  cancellation. So freeing a slot in Google Calendar drives the wedge too.
- DB: migration `025_google_calendar_sync_fields.sql` (sync cursor + watch
  channel columns on `clinics`).
