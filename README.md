# II ∞: Intelligent Clinic Scheduling

**An AI receptionist that fills cancelled appointments before they turn into lost revenue.**

Built by Vasco Campos and Mariana Lins during the II ∞ product sprint programme at 42 Lisboa. This is a public showcase of the product and code. Interview notes, customer data and internal planning are not included.

## The problem

Small private physiotherapy and medical clinics lose money quietly. When a patient cancels, the slot usually stays empty: no one has the time to phone the next patient and ask whether they'd like to come in earlier. Many of these clinics don't offer online booking either, so every change goes through a phone call to reception. The loss never shows up in a report, so it never gets fixed.

## What it does

A system that runs alongside the clinic's existing software and handles the time between appointments:

- **Cancellation cascade**: when a slot frees up, it is automatically offered to the next suitable patient by SMS. If they decline or don't answer before the cutoff, it moves on to the next one.
- **Day-before confirmations**: patients are asked the day before to confirm, so cancellations surface while there's still time to fill the slot.
- **Pull-forward**: patients booked further out are offered earlier openings.
- **AI receptionist agent**: patients reply in free-form Portuguese ("can I move to Thursday afternoon?"), and an LLM agent with tools checks availability, books, cancels, asks a new contact for their name, or escalates to staff.
- **Staff dashboard**: an agenda grid, patients, conversations, escalations and settings, updated in real time and synced with Google Calendar.
- **Honest accounting**: only recovered revenue counts. Moving a patient within the same day doesn't count as a recovery.

## Repository

```
Sprint4/
  prototype/          Clickable demo used in user interviews (Vite + React, fictional data, no backend).
                      Every step advances on a click, with no timers.
  working-prototype/  The real system
    web/              Next.js 16 + React 19 staff app (agenda, patients, conversations, escalations,
                      settings) and a mock phone (/sms) for demos
    supabase/         Postgres schema, RLS tenant isolation, and RPCs for the cascade, offers,
                      booking and agent tools (migrations 001–036)
    n8n-workflows/    Agent and automation workflows: inbound replies, slot cascade,
                      day-before confirmation, pull-forward, agent pilot
    docs/             Architecture, agent design, Google Calendar setup
PROGRAM_STRUCTURE.md  Scope and architecture overview
```

## Architecture

```
Patient SMS ─▶ n8n agent workflow ─▶ LLM (Gemini 2.5 Flash / Groq gpt-oss-120b)
                    │                    │ tool calls
                    ▼                    ▼
              Supabase RPCs ◀────── availability · book · cancel · offer accept/decline · escalate
                    │
                    ├─▶ Next.js staff app (realtime)
                    └─▶ Google Calendar sync (push notifications)
```

- **Database-first logic**: the cascade, offer expiry and concurrency guards live in Postgres functions, so every client sees the same rules.
- **Multi-tenant**: row-level security isolates each clinic's data.
- **Mock SMS first**: the `/sms` page simulates the patient's phone, so the whole flow can be demonstrated without a telecom provider.

## Running it

### Clickable demo

```sh
cd Sprint4/prototype
npm install
npm run dev              # http://localhost:5173
node verify-demo.mjs     # checks the cascade accounting without a browser
```

### Working prototype

1. Create a Supabase project and apply the migrations in `Sprint4/working-prototype/supabase/migrations/`.
2. Import the workflows from `n8n-workflows/` into n8n, and replace `YOUR_PROJECT_REF` with your Supabase project ref.
3. Run the app:

```sh
cd Sprint4/working-prototype/web
npm install
npm run dev
```

You'll need to set your Supabase URL and keys in `web/.env.local`. Google Calendar sync is optional; see `docs/GOOGLE_CALENDAR_SETUP.md`.

## Tech

Next.js · React · TypeScript · Tailwind · Supabase (Postgres, RLS, Realtime) · n8n · LangChain agent nodes · Gemini · Groq · Google Calendar API · Vite
