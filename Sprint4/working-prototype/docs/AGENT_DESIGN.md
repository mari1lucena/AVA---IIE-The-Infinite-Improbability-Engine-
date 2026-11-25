# AI Receptionist Agent — Design

> **Status:** Draft for discussion  
> **Date:** 2026-08-12

---

## Core Identity

**The agent is a follow-up receptionist, not a booking receptionist.**

- It **initiates** every conversation (the patient never texts first)
- It handles **outbound flows** the clinic already wants done but nobody has time for
- The moment a patient tries to start something new, it **hands off to a human**

**Persona:**
- Formal (você), no self-introduction ("Olá, sou a assistente...")
- Human-like, professional, never blames the patient
- Explains the *why* behind requests
- Short messages (SMS-length where possible)

---

## The Four Flows (from the demo)

Each flow is a state machine the agent drives. All start with the agent sending the first message.

### Flow 1: Slot Cascade (the wedge)
```
TRIGGER: A booked slot becomes free (cancellation/no-show)
  │
  ├─ Agent offers slot to candidate #1
  │    "Abriu uma vaga hoje às 17:00. Quer trocar a sua das 18:00?"
  │
  ├─ Patient: SIM → confirm, update agenda, STOP (or chain if same-day)
  ├─ Patient: NÃO → offer to candidate #2
  ├─ Patient: question → ESCALATE
  └─ No reply by -2h cutoff → mark lost, STOP
```

### Flow 2: Exam Follow-up
```
TRIGGER: Doctor requested an exam, nothing scheduled
  │
  ├─ Agent: "O Dr. pediu uma ecografia. Quer que marque?"
  │
  ├─ Patient: SIM → offer 3 dates → patient picks → book → STOP
  ├─ Patient: NÃO → mark "passive follow-up", STOP
  └─ Patient: question → ESCALATE
```

### Flow 3: Post-Visit Summary
```
TRIGGER: Consultation ended
  │
  └─ Agent sends summary (diagnosis, meds, next step)
       → No response expected, informational
       → If patient replies with question → ESCALATE
```

### Flow 4: No-Show Follow-up
```
TRIGGER: Patient didn't show up
  │
  ├─ Agent: "Não conseguiu vir ontem. Quer remarcar?" (never accusatory)
  │
  ├─ Patient: SIM → offer dates → book → STOP
  ├─ Patient: NÃO → mark, STOP
  └─ Patient: question → ESCALATE
```

---

## Escalation Rules (hand off to human)

The agent escalates — creates an `escalation_queue` entry — when:

| Trigger | Category | Priority |
|---------|----------|----------|
| Patient sends first message (not a reply to agent) | `booking_request` | normal |
| Patient mentions insurance/seguro/subsistema | `insurance_issue` | high |
| Patient mentions money/pagamento/preço problems | `insurance_issue` | high |
| Patient frustrated (detected 3rd time) | `complaint` | high |
| Agent uncertain how to respond | `conversation_takeover` | normal |
| Patient asks medical question | `conversation_takeover` | high |

**After escalation:** Agent stops. Human sees it in the dashboard escalation queue.

---

## Memory Model (minimal, scoped)

The agent does NOT have full conversation history. It only knows:

1. **The current conversation** (this flow's messages)
2. **The relevant slot(s)** tied to this conversation
3. **Immediate context switches within the flow**

**Example of what it SHOULD know:**
> Patient had Thursday 17:00. The day before, they cancel and say "Friday is better."
> Agent knows: this person had Thursday, wants Friday → can offer Friday slots.

**Example of what it should NOT know:**
> "Last month you complained about parking."
> That's out of scope — not relevant to the current flow.

**Implementation:**
- Each `conversation` row loads only its own `messages`
- The agent's prompt includes: patient name, current flow type, related slot details, and this conversation's messages
- No cross-conversation memory retrieval

---

## Agent Prompt Structure

Every agent call gets a system prompt like:

```
You are a receptionist at {clinic_name} in Portugal.
You are handling a {flow_type} conversation with {patient_name}.

CONTEXT:
- Patient: {patient_name}, {patient_age} years old
- {relevant_slot_info}
- {flow_specific_context}

RULES:
- Speak formal European Portuguese (use "você", never "tu")
- Never introduce yourself
- Keep messages under 160 characters when possible
- Never blame the patient for cancelling or not showing
- Explain the "why" when asking for something
- If the patient asks about insurance, money, or medical questions,
  respond: "Vou pedir a alguém da receção para o/a contactar." and STOP.
- If the patient seems frustrated, escalate the same way.

CURRENT CONVERSATION:
{message_history}

Respond with ONLY the message text, nothing else.
```

Then a separate **intent-parsing** call classifies the patient's reply:
```
Classify this patient reply into ONE category:
- ACCEPT (yes, agrees, confirms)
- DECLINE (no, refuses)
- QUESTION (asks something)
- FRUSTRATED (angry, repeated demands, complaints)
- INSURANCE (mentions seguro, subsistema, ADSE, money)
- UNCLEAR (can't tell)

Reply: "{patient_message}"
Category:
```

---

## Rate Limiting

To control cost and prevent runaway loops:

| Limit | Value | Reason |
|-------|-------|--------|
| Max messages per patient per day | 10 | Prevent spam |
| Max agent replies per conversation | 5 | Force escalation if stuck |
| Max cascade offers per slot | 3 | Don't annoy whole patient list |
| Cutoff before slot | -2h | Practical booking limit |
| Cooldown between messages | 30s min | Feel human, not robotic |

**When a limit is hit:** Escalate to human or mark the flow as ended.

---

## Two-Model Approach

Use **two separate AI calls** per turn:

1. **Intent classifier** (small, fast, cheap)
   - Input: patient's raw message
   - Output: ACCEPT / DECLINE / QUESTION / FRUSTRATED / INSURANCE / UNCLEAR
   - Model: Llama 3.1 8B or Gemini Flash (very cheap)

2. **Response generator** (bigger, better Portuguese)
   - Input: full context + classified intent
   - Output: the message to send
   - Model: Llama 3.3 70B or GPT-4o-mini

**Why split?** The classifier is deterministic and cheap; the generator needs quality. Splitting also lets the state machine make decisions based on intent BEFORE generating a reply (e.g., escalate without wasting a generation call).

---

## Free Model Setup (Groq)

**Recommended starting stack:**

| Task | Model | Provider | Free Limit |
|------|-------|----------|-----------|
| Intent classification | Llama 3.1 8B | Groq | 14,400/day |
| Response generation | Llama 3.3 70B | Groq | 14,400/day |

**n8n integration:**
- Groq has an OpenAI-compatible API
- Use n8n's HTTP Request node or OpenAI node (point base URL to Groq)
- API endpoint: `https://api.groq.com/openai/v1/chat/completions`

**Getting a key:** Free at https://console.groq.com

---

## Safety Rails

Because this talks to real patients:

1. **Never send medical advice** — always escalate medical questions
2. **Never confirm without DB write** — the message and the state must match
3. **Always have a human fallback** — every flow can escalate
4. **Log everything** — every message stored in `messages` table for audit
5. **RGPD:** No health data in AI prompts beyond what's needed for scheduling
   - ❌ "Patient has diabetes, offer earlier slot"
   - ✅ "Patient prefers earlier slots" (behavioral, not medical)

---

## Resolved Decisions (2026-08-12)

1. **After-hours:** The agent **responds immediately**, any time of day. No quiet hours. (Patients replying late still get an answer.)

2. **Languages:** **European Portuguese and English.** The intent classifier and generator must handle both. Detect language from the patient's message and reply in the same language. (No Brazilian PT special-casing, but it will mostly work anyway.)

3. **Confirmation flow (Flow 5) = same cascade shape:** Day-before confirmation goes to **one patient at a time**, not a batch. If that patient says they're not coming, the agent immediately works the freed slot down the candidate list (same cascade as Flow 1) **until -2h before the appointment**. If nobody takes it by then, **accept the empty slot** — nobody is coming, and that's recorded (a lost slot still counts, for the number).

4. **Phone routing:** Every booking carries the phone number given **at booking time**. The conversation is tied to that booking's phone — no shared-phone ambiguity to resolve. The agent talks to whoever booked, on the number they left.

5. **Opt-out (RGPD):** **Build from day one.** Every outbound flow includes an opt-out line ("Responda STOP para não receber mais mensagens." / "Reply STOP to opt out."). A STOP reply sets the patient to no-contact and ends all flows.

6. **Frustration detection = both (hybrid):**
   - **Keyword/insult shortcut:** profanity or insults ("burro", "idiota", "stupid", etc.) → immediate FRUSTRATED, no AI call needed. If someone insults the bot, they're clearly frustrated.
   - **AI classification:** subtler frustration (repeated demands, "já disse isto três vezes", passive anger) caught by the intent classifier we already run.
   - Either path → escalate to human.

---

## Flow 5: Day-Before Confirmation (detail)

```
CRON (n8n, daily ~18:30): find tomorrow's booked slots
  │
  For each slot, one patient at a time:
  ├─ Agent: "Confirma a consulta amanhã às {time}? Responda SIM ou NÃO."
  │
  ├─ SIM (or no reply) → confirmed, done
  │     (silence = confirmed; we don't chase confirmations)
  │
  └─ NÃO → slot becomes free → run Flow 1 cascade on it:
        ├─ offer to candidate #1 → SIM: filled, STOP
        ├─                         NÃO: candidate #2 ...
        └─ keep going until -2h before the slot
              └─ nobody took it → accept empty slot, record as lost
```

Note the asymmetry: **silence on a confirmation = confirmed** (don't chase), but **silence on a cascade offer = move to next candidate** (the slot is already at risk, so keep working it).

---

## Language Handling

- **Detect** language from the patient's message (the intent classifier can return a `lang` field: `pt` or `en`).
- **Reply** in the detected language.
- **Default** to European Portuguese for the first (agent-initiated) message, since the clinic is Portuguese — unless the patient's record indicates English preference.
- Store detected language on the conversation so mid-flow switches stay consistent.

---

## Opt-Out Handling

- Every agent-initiated message ends with the opt-out line (localized).
- A reply matching STOP / PARAR / CANCELAR-ALL (distinct from cancelling one appointment):
  - Sets `patients.is_active = false` OR a dedicated `no_contact` flag (TBD in schema)
  - Ends all active conversations for that patient
  - Logs the opt-out for RGPD audit
- **Important:** "NÃO" to a single offer ≠ opt-out. Only explicit STOP words trigger no-contact.
