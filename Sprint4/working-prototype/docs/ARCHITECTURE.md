# Working Prototype Architecture — II ∞

> **Status:** In Development  
> **Started:** 2026-08-12  
> **Team:** Mariana Lins, Vasco Campos

---

## System Overview

A hybrid cloud/local system for intelligent clinic scheduling with an AI receptionist agent that handles follow-ups autonomously.

### Core Principle

**The agent initiates, humans escalate.**

The system starts conversations (follow-ups, confirmations, slot offers). Patients can respond, but the agent doesn't handle inbound "I want to book" messages — that's for human reception or direct booking.

---

## Architecture Decisions

### 1. Deployment Model

**Hybrid Cloud:**
- **Next.js app + Supabase** (cloud) — patient booking, staff dashboard, database
- **n8n agent** (cloud-hosted, centralized) — cascade logic, AI conversations
- **Reason:** Cost-effective for pilot; remote debugging without driving to Porto

### 2. IMED Integration

**Parallel system (Option C):**
- No IMED API integration (closed API)
- Our system is independent
- Staff manually syncs or uses our system as primary agenda

### 3. SMS Strategy

**Phase 1 (current):** Mock SMS interface in the app
- Staff can send test messages
- n8n agent responds as if real SMS
- Simulates patient replies for development

**Phase 2 (future):** Twilio integration
- Drop-in replacement for mock interface
- Minimal code changes

### 4. AI Agent Architecture

**LLM-powered receptionist:**
- **Model:** GPT (with rate limiting) or free models initially
- **Scope:** Follow-ups only, NOT inbound booking
  - Appointment confirmations (day before)
  - Slot offers (cascade)
  - Exam reminders
  - No-show follow-ups
- **Tone:** Formal (você), no introduction
- **Escalation to human:**
  - Patient initiates conversation (not a reply)
  - Insurance/financial issues
  - Patient shows frustration (3+ messages)
  - Agent uncertainty
- **Memory:** Minimal — only current conversation context
  - Example: "You had Thursday, changed to Friday" ✓
  - NOT: Full conversation history ✗

### 5. Agenda/Calendar Strategy

**Dual-source support:**

**Option A:** Google Calendar sync
- Clinic uses Google Calendar
- n8n reads/writes via Google Calendar API
- Two-way sync: changes in either system reflect in both

**Option B:** Manual agenda in dashboard
- Clinic doesn't have online scheduling
- Staff uses our calendar UI
- n8n reads from Supabase database

**Option C (later):** CSV import from IMED
- Periodic export → import
- One-way sync

**v1 builds both A and B.**

---

## Component Map

```
┌─────────────────────────────────────────────────────────────┐
│                         CLOUD LAYER                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐        ┌────────────────────┐        │
│  │   Next.js App    │◄──────►│    Supabase        │        │
│  │  (Vercel)        │        │  - Postgres        │        │
│  │                  │        │  - Auth            │        │
│  │  - Patient       │        │  - RLS             │        │
│  │    booking       │        │  - Realtime (opt)  │        │
│  │  - Staff         │        └────────────────────┘        │
│  │    dashboard     │                 ▲                     │
│  │  - Mock SMS UI   │                 │                     │
│  └──────────────────┘                 │                     │
│         ▲                              │                     │
│         │                              │                     │
│         │         ┌────────────────────┴──────┐             │
│         │         │                           │             │
│         │         │      n8n (Cloud)          │             │
│         │         │  - Cascade workflows      │             │
│         │         │  - AI agent (GPT)         │             │
│         │         │  - SMS mock interface     │             │
│         │         │  - Google Calendar sync   │             │
│         │         │                           │             │
│         └─────────┤  Webhooks & API calls     │             │
│                   │                           │             │
│                   └───────────────────────────┘             │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      FUTURE: ON-PREM                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────────────────────────────┐          │
│  │         Clinic Local Network (Porto)         │          │
│  │                                              │          │
│  │   ┌─────────────┐                           │          │
│  │   │ n8n (local) │                           │          │
│  │   │  - RGPD     │◄──► Supabase Cloud        │          │
│  │   │    compliant│                           │          │
│  │   └─────────────┘                           │          │
│  │                                              │          │
│  └──────────────────────────────────────────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Cascade Example

**Scenario:** Rita cancels her 17:00 appointment

1. **Staff marks slot as cancelled** in dashboard (Next.js)
2. **Next.js** updates Supabase: `slots.status = 'cancelled'`
3. **Next.js** triggers webhook → n8n: `/webhook/slot-cancelled`
4. **n8n workflow** executes:
   - Queries Supabase for cascade candidates
   - Ranks by: same day > future booking > waiting list
   - Generates offer message via GPT
   - Posts to mock SMS interface (or Twilio later)
5. **Patient replies** via mock SMS UI
6. **n8n receives reply** via webhook
7. **GPT parses intent** (yes/no/question)
8. **If yes:** n8n updates slot in Supabase, sends confirmation
9. **If no:** n8n offers to next candidate
10. **If question/frustrated:** n8n creates ticket for human reception

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Next.js 15 (App Router) | Server components, API routes |
| UI | shadcn/ui + Tailwind | Fast prototyping, accessible |
| Database | Supabase (Postgres) | Auth, RLS, realtime, easy setup |
| Auth | Supabase Auth | Built-in, secure |
| AI Agent | n8n + GPT-4o-mini (or free models) | Visual workflows, rate limiting |
| SMS (dev) | Mock interface in Next.js | Fast iteration |
| SMS (prod) | Twilio | Reliable, mature |
| Calendar | Google Calendar API | Most clinics already use it |
| Deployment | Vercel (Next.js) + Supabase Cloud | Zero-config, fast |

---

## Free Models for AI Agent

Options for rate-limited GPT calls:

1. **GPT-4o-mini** (OpenAI) — $0.15/1M input tokens
   - Cheap, fast, good for simple follow-ups
   - Recommended for v1

2. **Free alternatives:**
   - **Groq** (free tier) — Llama 3.1 70B, very fast
   - **Together AI** (free tier) — Various open models
   - **Anthropic** (Claude Haiku) — $0.25/1M tokens

3. **Rate limiting strategy:**
   - Max 10 messages/patient/day
   - After 3 unanswered messages, stop
   - Escalate to human after 3 back-and-forths

---

## Dashboard Features (Staff)

**Agenda View:**
- Calendar grid (day/week view)
- Drag-and-drop slots
- Import from Google Calendar button
- Manual slot creation

**Conversation Monitor:**
- Live feed of agent conversations
- Filter: active / needs attention / resolved
- Click to take over conversation
- Send manual message

**Patient List:**
- Search by name/phone
- Filter: upcoming / no-show / waiting list
- Quick actions: book, cancel, add note

**Analytics (Phase 2):**
- Slots recovered
- Minutes saved
- Revenue recovered

---

## Next Steps

1. ✅ Create architecture doc (this file)
2. ⏳ **Database schema** (`001_initial_schema.sql`)
3. ⏳ Next.js app scaffold
4. ⏳ Mock SMS interface
5. ⏳ n8n cascade workflow
6. ⏳ Google Calendar sync
7. ⏳ AI agent integration

---

## Open Questions

1. **Google Calendar setup:** Who creates the clinic's Google account? We provide instructions or do it as a service?
2. **n8n hosting:** Self-host on your server or use n8n.cloud?
3. **Domain:** What domain for the app? `[clinic-slug].yourdomain.com`?
4. **First pilot clinic:** Do you have one lined up? What's their setup?
5. **RGPD compliance:** Do we need a DPO (Data Protection Officer) for pilot?
