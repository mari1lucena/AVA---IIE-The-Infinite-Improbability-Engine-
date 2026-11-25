# II ∞ — Working Prototype

> **Status:** In Development  
> **Started:** 2026-08-12  
> **Team:** Mariana Lins, Vasco Campos

---

## What This Is

The **real, production-ready system** for intelligent clinic scheduling with AI receptionist agent.

This is separate from `../prototype/` (the clickable demo for user interviews).

---

## System Architecture

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for full details.

**TL;DR:**
- **Next.js + Supabase** (cloud) for web app + database
- **n8n** (cloud, centralized) for AI agent workflows
- **Hybrid model:** Remote debugging, no on-site visits to clinics
- **Mock SMS first**, Twilio later

---

## Directory Structure

```
working-prototype/
├── docs/
│   └── ARCHITECTURE.md          # System design, tech decisions
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql   # Database schema
├── n8n-workflows/
│   └── (workflow JSON exports will go here)
├── app/                         # Next.js app (to be created)
│   ├── (clinic)/               # Staff dashboard
│   ├── (booking)/              # Patient booking pages
│   └── api/                    # API routes
└── README.md                    # This file
```

---

## Current Progress

- [x] Architecture documented
- [x] Database schema designed (`001_initial_schema.sql`)
- [ ] Supabase project setup
- [ ] Next.js app scaffold
- [ ] Mock SMS interface
- [ ] n8n cascade workflow
- [ ] Google Calendar integration
- [ ] AI agent (GPT) integration

---

## Database Schema

The schema supports:

✅ **Multi-tenant** (multiple clinics per instance)  
✅ **Staff dashboard** (agenda, patient list, escalation queue)  
✅ **Cascade offers** (slot recovery tracking)  
✅ **AI conversations** (message logs, escalation)  
✅ **Google Calendar sync** (calendar_id + refresh_token per clinic)  
✅ **Waiting list** (patients wanting slots)  
✅ **Escalation queue** (tasks for human reception)

### Key Tables

| Table | Purpose |
|-------|---------|
| `clinics` | Clinic accounts (multi-tenant) |
| `staff` | Dashboard users (linked to Supabase Auth) |
| `patients` | Patient records |
| `doctors` | Doctors (optional, for multi-doctor clinics) |
| `slots` | Appointment slots (the core unit) |
| `cascade_offers` | Tracks each cascade offer attempt |
| `conversations` | AI agent chat sessions |
| `messages` | Individual messages in conversations |
| `escalation_queue` | Tasks requiring human attention |
| `waiting_list` | Patients waiting for next slot |

---

## AI Agent Behavior

**What it does:**
- Sends day-before confirmations
- Offers freed slots (cascade)
- Follows up on exams/tests
- Contacts no-show patients

**What it doesn't do:**
- Handle inbound "I want to book" messages → escalates to human
- Answer medical questions → escalates
- Deal with insurance/payments → escalates
- Continue after 3 back-and-forth exchanges → escalates

**Tone:** Formal (você), no introduction, human-like but professional

**Memory:** Minimal — only current conversation context

---

## Mock SMS Interface (Phase 1)

For development, we simulate SMS in the app:

1. **Staff dashboard** has a "Test SMS" panel
2. Staff can send messages as the system
3. Staff can reply as a patient
4. n8n agent processes these as if real SMS
5. Later: swap for Twilio with minimal code changes

---

## Google Calendar Integration

Two-way sync:

- **Clinic → App:** Periodic import of calendar events → slots table
- **App → Clinic:** New bookings create events in Google Calendar
- **Auth:** OAuth 2.0, refresh token stored (encrypted) in `clinics.google_refresh_token`

---

## Next Steps

### Step 1: Set up Supabase project

```bash
# Install Supabase CLI
npm install -g supabase

# Initialize project
supabase init

# Link to cloud project (or create new)
supabase link --project-ref <your-project-ref>

# Run migration
supabase db push
```

### Step 2: Scaffold Next.js app

```bash
npx create-next-app@latest app --typescript --tailwind --app --use-npm
cd app
npm install @supabase/supabase-js @supabase/auth-helpers-nextjs
```

### Step 3: Build mock SMS interface

Create API routes:
- `POST /api/mock-sms/send` — System sends message
- `POST /api/mock-sms/reply` — Patient replies
- `GET /api/mock-sms/conversations` — View all threads

### Step 4: n8n cascade workflow

1. Webhook: slot cancelled
2. Query Supabase: find cascade candidates
3. Rank: same day > future > waiting list
4. Generate message via GPT
5. Send to mock SMS interface
6. Wait for reply (webhook)
7. Update database

### Step 5: Deploy

- **Next.js** → Vercel (automatic from GitHub)
- **Supabase** → Already cloud
- **n8n** → n8n.cloud or self-hosted

---

## Environment Variables

Create `.env.local` in `app/`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# OpenAI (for AI agent)
OPENAI_API_KEY=sk-...

# n8n webhook URL
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/

# Google Calendar (OAuth)
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxx
```

---

## Development Workflow

1. **Database changes:** Create new migration in `supabase/migrations/`
2. **Apply locally:** `supabase db push`
3. **Test in Next.js app**
4. **Commit to git**
5. **Deploy:** Vercel auto-deploys, Supabase runs migrations

---

## Testing Strategy

**Phase 1 (current):**
- Manual testing via mock SMS interface
- Staff uses dashboard, simulates patient replies
- Verify cascade logic, conversation flow

**Phase 2 (before pilot):**
- Automated tests for cascade logic
- Integration tests for n8n workflows
- Load testing (simulate 100 patients/clinic)

**Phase 3 (pilot):**
- One real clinic, 2-4 weeks
- Monitor: error rates, response times, escalation reasons
- Iterate based on feedback

---

## Open Questions

1. **n8n hosting:** Use n8n.cloud ($20/mo) or self-host?
2. **Domain:** What domain for the app? Suggestion: `agendai.pt` or similar
3. **First pilot clinic:** Do you have one? What's their setup?
4. **Google Calendar:** Create service account or use clinic's own Google Workspace?
5. **RGPD:** Do we need DPO (Data Protection Officer) before pilot?

---

## Resources

- [Supabase Docs](https://supabase.com/docs)
- [Next.js App Router](https://nextjs.org/docs)
- [n8n Docs](https://docs.n8n.io)
- [Google Calendar API](https://developers.google.com/calendar/api)
- [Twilio SMS API](https://www.twilio.com/docs/sms)

---

## Contact

Questions? Reach the team:
- Mariana Lins
- Vasco Campos

