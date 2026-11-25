# Program Structure — II ∞ | Intelligent Clinic Scheduling

> **Status:** Draft
> **Version:** 1.0
> **Date:** 2026-08-12

---

## 1. What this software is (and isn't)

**Parallel companion software** — does NOT replace existing clinic software (e.g. IMED). Clinics run it alongside their current system.

**In scope v1:**
1. **Online booking** — patients book without calling reception
2. **Intelligent scheduling cascade** — cancelled slots auto-offered to next patient
3. **SMS notifications** — confirmation requests, slot offers, reminders

**NOT in scope v1:** AI consultation summary.

---

## 2. Architecture Overview

```
Patient (mobile/web)
  - Online booking page
  - SMS link to confirm/reject

Clinic Staff (desktop web)
  - Admin dashboard
  - Slot management
  - Patient management
  - Cascade history

Next.js App Router
  - Both clinic and booking interfaces
  - Server Actions / API routes
  - Middleware for auth

Supabase
  - Postgres (data)
  - Auth (staff accounts)
  - Edge Functions (cascade logic, cron)
  - Realtime (optional live updates)

Twilio / Bird
  - SMS sending and receiving
  - Webhook for incoming replies
```

---

## 3. Directory Structure

```
app/
├── (clinic)/
│   ├── layout.tsx           # Authenticated shell for staff
│   ├── page.tsx            # Dashboard overview
│   ├── slots/
│   │   ├── page.tsx        # Slot calendar view
│   │   └── [id]/page.tsx   # Slot detail / edit
│   ├── patients/
│   │   ├── page.tsx        # Patient list
│   │   └── [id]/page.tsx  # Patient detail
│   ├── cascade/
│   │   └── page.tsx        # Cascade history log
│   └── settings/
│       └── page.tsx        # Clinic settings, SMS config
├── (booking)/
│   ├── [clinicSlug]/page.tsx    # Clinic booking page (public)
│   ├── [clinicSlug]/confirm/page.tsx  # Confirmation page
│   └── api/
│       ├── available-slots/route.ts
│       ├── book/route.ts
│       └── webhook/route.ts     # Twilio SMS webhook
├── login/page.tsx
└── layout.tsx

components/
├── ui/                     # shadcn/ui components
├── clinic/
│   ├── slot-calendar.tsx
│   ├── slot-card.tsx
│   ├── patient-row.tsx
│   └── cascade-log.tsx
└── booking/
    ├── booking-flow.tsx
    ├── slot-picker.tsx
    └── patient-form.tsx

lib/
├── supabase/
│   ├── client.ts           # Browser client
│   ├── server.ts           # Server client
│   └── middleware.ts       # Auth middleware
├── sms/
│   ├── send.ts             # Twilio/Bird wrapper
│   └── parser.ts           # Parse incoming SMS replies
├── cascade/
│   ├── trigger.ts          # Run cascade for a cancelled slot
│   ├── offer-slot.ts       # Send offer to next patient
│   └── cutoff-check.ts     # -2h cutoff logic
└── types.ts

supabase/
├── migrations/             # Postgres schema migrations
│   ├── 001_initial_schema.sql
│   └── 002_cascade_functions.sql
└── functions/              # Edge Functions
    ├── cascade-trigger/
    └── daily-reminder/

hooks/
├── use-slots.ts
├── use-patients.ts
└── use-cascade.ts
```

---

## 4. Database Schema (Supabase / Postgres)

### Tables

**clinics**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| slug | text | Unique, used in booking URL |
| name | text | Clinic name |
| phone | text | Clinic phone |
| sms_sender | text | Twilio sender number |
| cascade_cutoff_hours | int | Default 2 |
| created_at | timestamp | |

**staff**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| clinic_id | uuid | FK → clinics |
| email | text | Unique |
| name | text | |
| role | text | admin / receptionist |
| created_at | timestamp | |

**patients**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| clinic_id | uuid | FK → clinics |
| name | text | |
| phone | text | For SMS |
| email | text | Optional |
| created_at | timestamp | |

**slots**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| clinic_id | uuid | FK → clinics |
| doctor_name | text | |
| start_time | timestamp | |
| end_time | timestamp | |
| status | text | available / booked / cancelled / offered / filled |
| patient_id | uuid | FK → patients (nullable) |
| booked_at | timestamp | |
| original_patient_id | uuid | Who had it before cancellation |
| cascade_level | int | 0 = first offer, 1 = second, etc. |
| created_at | timestamp | |

**cascade_offers**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| slot_id | uuid | FK → slots |
| patient_id | uuid | FK → patients |
| offered_at | timestamp | |
| expires_at | timestamp | When the -2h cutoff is |
| status | text | pending / accepted / declined / expired |
| sms_message_id | text | Twilio message SID |

**booking_requests**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| clinic_id | uuid | FK → clinics |
| patient_name | text | |
| patient_phone | text | |
| patient_email | text | Optional |
| preferred_date | date | |
| preferred_time | time | |
| doctor_name | text | Optional preference |
| notes | text | Optional |
| status | text | pending / confirmed / cancelled |
| created_at | timestamp | |

### Row Level Security (RLS)

- `staff` → can only read/write their own clinic
- `patients` → can only read/write their own clinic
- `slots` → can only read/write their own clinic
- `booking_requests` → public INSERT, clinic can read
- `cascade_offers` → staff full access

---

## 5. Core Flows

### 5.1 Online Booking (Patient)

```
Patient opens: /[clinicSlug]
  → Sees available slots (fetched from /api/available-slots)
  → Picks slot, fills name + phone + email
  → Submits → POST /api/book
    → Creates booking_request (status: pending)
    → Creates slot (status: booked)
    → Sends confirmation SMS via Twilio
  → Patient receives SMS "Confirm: [Yes link] / [No link]"
  → If confirmed → slot stays booked
  → If declined → slot.status = cancelled → triggers cascade
```

### 5.2 Intelligent Scheduling Cascade

Triggered whenever a slot becomes `cancelled`.

```
Slot cancelled
  │
  ├─ Find patients with upcoming slots at same clinic
  │    (any slot after the cancelled one, same doctor preferred)
  │
  ├─ Offer freed slot to patient with EARLIEST upcoming slot
  │    (they have most to gain by moving up)
  │
  ├─ Send SMS: "Earlier slot available: [date/time]. Reply YES or visit [link]"
  │    → cascade_offer created (status: pending, expires_at = slot.start - 2h)
  │
  ├─ Wait for response...
  │
  ├─ YES / accepts link → slot.status = filled, new patient linked
  │    cascade_offer.status = accepted
  │
  ├─ NO → cascade_offer.status = declined
  │    → Offer to next patient (cascade_level + 1)
  │    → Repeat until -2h cutoff
  │
  └─ Cutoff reached OR no more patients → slot stays empty
       cascade_offer.status = expired
```

### 5.3 Confirmation Cascade (day before)

Day before each booked slot, send confirmation SMS to two consecutive patients.

```
CRON: daily at 9am
  │
  ├─ Find all slots for tomorrow between X and Y time
  │
  ├─ For each pair of consecutive slots:
  │    → Send SMS to patient A: "Confirm [datetime]? Reply YES/NO"
  │    → Send SMS to patient B: "Confirm [datetime]? Reply YES/NO"
  │
  ├─ If A cancels:
  │    → Immediately offer to B (same-day cascade)
  │    → Offer to next-week patients if B declines
  │
  └─ Non-response = YES (confirmed)
```

---

## 6. API Routes

### Public (patient-facing)

```
GET  /api/available-slots?clinic=[slug]&date=[YYYY-MM-DD]
     → Returns slots with status = available

POST /api/book
     Body: { clinicSlug, slotId, patientName, patientPhone, patientEmail }
     → Creates booking_request + updates slot

GET  /api/booking/[id]/status
     → Check booking confirmation status

POST /api/webhook (Twilio webhook)
     → Handles incoming SMS replies (YES/NO/confirma)
```

### Authenticated (clinic staff)

```
GET  /api/slots?clinic=[id]&from=&to=
POST /api/slots
PUT  /api/slots/[id]
DELETE /api/slots/[id]

GET  /api/patients?clinic=[id]
POST /api/patients
PUT  /api/patients/[id]

GET  /api/cascade?clinic=[id]
     → History of all cascade offers

GET  /api/clinic/settings
PUT  /api/clinic/settings
```

---

## 7. SMS Design

### Message templates

| Trigger | Message |
|---------|---------|
| Booking confirmation | "Ola [name], confirma a consulta em [clinic] para [date] às [time]? Responde SIM ou NAO. [link]" |
| Day-before reminder | "Lembranca: tem consulta em [clinic] amanha às [time]. Responde SIM para confirmar ou NAO para cancelar." |
| Slot offer (cascade) | "Slot Earlier disponivel! [date] às [time] em [clinic]. Quer mudar? Responde SIM ou visita [link] para aceitar." |
| Booking accepted | "Confirmado! A sua consulta em [clinic] é [date] às [time]." |
| Booking cancelled | "A sua consulta em [clinic] em [date] às [time] foi cancelada." |

### Incoming SMS parsing

Replies are routed via Twilio webhook to `/api/webhook`:

```
"SIM", "sim", "yes", "YES", "Confirma", "confirma"  → CONFIRM
"NAO", "nao", "no", "NO", "Cancela", "cancela"     → DECLINE
```

Pattern match on first word, case-insensitive.

---

## 8. Auth & Access Control

**v1:** One login per clinic (clinic owner/admin account)

**Future (planned):**
- Multiple staff accounts per clinic (receptionist, admin roles)
- Patient portal (view own appointments)

**Implementation:**
- Supabase Auth with email/password
- Middleware checks `auth.uid()` → fetches `staff.clinic_id`
- All data queries filtered by `clinic_id` (RLS enforced at DB level)

---

## 9. Tech Stack

```
Frontend     Next.js 15 (App Router, TypeScript)
UI           shadcn/ui + Tailwind CSS
Icons        Lucide React
Forms        React Hook Form + Zod
Scaffolding  v0.dev (for UI pages)

Backend      Next.js API Routes + Server Actions
             Supabase Edge Functions (cascade cron jobs)

Database     Supabase (Postgres)
Auth         Supabase Auth (email/password)

SMS          Twilio OR Bird.com
             (abstraction layer so provider is swappable)

Realtime     Supabase Realtime (optional — live slot updates)

Deployment   Vercel (Next.js) + Supabase Cloud
Domain       clinic-slug.yourdomain.com OR /[clinicSlug] routes
```

---

## 10. MVP Scope — What to Build First

### Phase 1: Core loop (this is the MVP)

1. Clinic signs up → gets `slug` → access to dashboard
2. Staff creates slots manually (calendar view)
3. Patients book via public `/[slug]` page
4. SMS confirmation sent on booking
5. Staff can cancel a slot → cascade triggers → offer SMS sent
6. Patient responds YES/NO → slot updated

### Phase 2: Polish

- Day-before confirmation cascade (cron job)
- Cascade history dashboard
- Better slot creation (drag-and-drop, recurring slots)
- Clinic settings (SMS sender name, cascade cutoff)

### Phase 3: Future

- AI consultation summary
- Patient portal (view appointments, reschedule)
- Multi-staff accounts
- IMED partnership / data sync
- Payment integration

---

## 11. Key Decisions to Make

| Question | Options | Recommendation |
|----------|---------|----------------|
| SMS provider | Twilio vs Bird.com | Twilio (more mature, better docs) |
| Slot creation | Manual only vs import CSV | Manual + CSV import |
| Cascade trigger | Staff cancel vs auto-detect via IMED | Staff cancel only (parallel software) |
| Booking flow | One-step vs two-step (request → confirm) | One-step (simpler, faster) |
| Domain structure | Subdomain per clinic vs path `/[slug]` | Path `/[slug]` (simpler, one domain) |

---

## 12. Open Questions

1. **IMED partnership** — Is this still the plan? Would they expose an API so cancelled slots auto-detected?
2. **SMS cost** — Who pays? Clinic? Per-SMS cost? Included in subscription?
3. **Patient data** — Is a patient account needed, or just name + phone per booking?
4. **Slot creation workflow** — Import from IMED CSV? Manual only?
5. **Doctor assignment** — Is doctor name required per slot, or just time blocks?
6. **Duplicate booking** — Can the same patient book two slots? Lock them out?
7. **Waitlist** — If cascade exhausts all options, does the patient go to a waitlist?
