# n8n workflows — II ∞ agent

The AI receptionist runs in **n8n (n8n.cloud)**. Postgres emits events, n8n
reacts, calls Groq for intent + text, and writes back to Supabase with the
**service_role** key (bypasses RLS). See `../docs/AGENT_DESIGN.md` for the flows.

```
patient texts (/sms)                 slot cancelled                    daily 18:30
   │ mock_sms_inbound                    │ status → 'cancelled'             │ n8n cron
   ▼                                     ▼                                  ▼
messages INSERT (patient)            slots UPDATE                    confirmations_start()
   │ trg_notify_n8n_inbound              │ trg_notify_n8n_slot_cancelled     │ one conv / slot
   │ net.http_post ───► WF-A       net.http_post ───► WF-B          fan out ───► WF-C
        (reply handler)               (slot cascade)                (day-before confirm)
              │                          │                                  │
       route on intent +          offer freed slot to           ask each patient
       conversation_type          best candidate (1 at          "confirma? SIM/NÃO"
              │                    a time), chain moves               │
              └────────► agent_send_message() / agent_escalate() ◄─────┘
                                (service_role)
```

All three DB triggers exist (migration `007_n8n_outbound_webhooks`) and are a
**no-op until the webhook URLs are configured** in `private.app_config` —
nothing fires until you paste the Production URLs back (step 4).

---

## The DB ↔ agent contract (live, tested)

n8n calls these over Supabase REST: `POST {SUPABASE_URL}/rest/v1/rpc/<fn>` with
the **service_role** key (headers `apikey` + `Authorization: Bearer`, both set
for you by the predefined *Supabase API* credential).

### Shared (all workflows)

| RPC | Body | Returns | Purpose |
|-----|------|---------|---------|
| `agent_context` | `{ "p_conversation_id": "<uuid>" }` | json: conversation (incl. `conversation_type`), patient, clinic (`clinic_name`), related_slot, `messages[]` | Everything the prompt needs |
| `agent_send_message` | `{ "p_conversation_id": "<uuid>", "p_body": "<text>" }` | message uuid | Post an agent reply (won't re-trigger n8n) |
| `agent_escalate` | `{ "p_conversation_id": "<uuid>", "p_category": "...", "p_reason": "...", "p_priority": "normal" }` | escalation uuid | Hand off to a human |

### Cascade + confirmation (migration `008`)

| RPC | Body | Returns | Called by |
|-----|------|---------|-----------|
| `cascade_offer_next` | `{ "p_slot_id": "<uuid>" }` | envelope `{ status, conversation_id, patient{name}, freed_slot{…}, candidate_slot }` — `status='offer'` means text someone; `noop`/`cutoff`/`exhausted`/`no_candidates` end the run | WF-B |
| `cascade_respond_accept` | `{ "p_conversation_id": "<uuid>" }` | `{ status:'accepted', filled_slot_id, vacated_slot_id }` (or `stale`) | WF-A |
| `cascade_respond_dec‍line` | `{ "p_conversation_id": "<uuid>" }` | `{ status:'dec‍lined', slot_id }` — WF-A re-posts `slot_id` to WF-B to advance | WF-A |
| `cascade_expire_advance` | `{ "p_clinic_id": null }` | setof `{ slot_id, clinic_id, start_time }` still worth working | (cron sweep, optional) |
| `confirmations_start` | `{}` (or `{ "p_clinic_id", "p_target_date" }`) | setof `{ conversation_id, slot_id, patient{name}, slot{start_time,doctor_name} }`, one per still-booked slot tomorrow | WF-C |
| `confirmation_confirm` | `{ "p_conversation_id": "<uuid>" }` | `{ status:'confirmed', slot_id }` | WF-A |
| `confirmation_dec‍line` | `{ "p_conversation_id": "<uuid>" }` | `{ status:'dec‍lined', slot_id }` — slot → `cancelled` → trigger auto-starts a cascade | WF-A |

Escalation categories (from `AGENT_DESIGN.md`): `booking_request`,
`insurance_issue`, `complaint`, `conversation_takeover`.

### Event-driven chaining (why n8n never loops)

The freed slot is worked **one pending offer at a time**. The DB decides what
happens next by flipping slot status, and the single `slot_cancelled` trigger
picks it up:

- **Cascade accept** → freed slot becomes `confirmed` (no re-fire). If the
  accepter was moved up from a later slot, that old slot becomes `cancelled` →
  trigger → WF-B → a *fresh* cascade for the now-empty slot. Chains for free.
- **Cascade dec‍line** → slot stays `cancelled` (no status change, **no trigger**),
  so WF-A actively re-posts the `slot_id` to WF-B's webhook to offer the next
  candidate. This is the one place n8n re-invokes n8n.
- **Confirmation dec‍line** → slot becomes `cancelled` → trigger → WF-B. Automatic.
- **Confirmation confirm** → slot becomes `confirmed`. Done.

### Webhook payloads (what the DB / WF-A POST to n8n)

Inbound reply → WF-A:
```json
{ "type": "inbound_reply", "message_id": "...", "conversation_id": "...",
  "body": "...", "channel": "mock", "sent_at": "..." }
```
Slot cancelled → WF-B (from the DB trigger, or re-posted by WF-A on a cascade
dec‍line):
```json
{ "type": "slot_cancelled", "slot_id": "...", "clinic_id": "...", "start_time": "..." }
```
Every request carries header `x-webhook-secret` — each workflow verifies it
matches `private.app_config.n8n_webhook_secret` (env `II_WEBHOOK_SECRET`).

---

## Workflows

| File | Trigger | Does | Status |
|------|---------|------|--------|
| `01-inbound-reply-handler.json` (WF-A) | patient message → webhook | classify intent (8B) → route on `conversation_type`: ACCEPT/DEC‍LINE hit the slot RPCs, QUESTION/FRUSTRATED/INSURANCE escalate, else generic AI reply (70B) | ✅ validated |
| `02-slot-cascade.json` (WF-B) | slot cancelled → webhook | `cascade_offer_next` picks the best candidate → generate + send the offer (70B) | ✅ validated |
| `03-day-before-confirmation.json` (WF-C) | n8n cron 18:30 | `confirmations_start` opens one conversation per still-booked slot tomorrow → fan out → send "confirma? SIM/NÃO" (70B) | ✅ validated |

All three pass offline `validate_workflow` (0 errors). They are **scaffolds
against the live schema** — import, attach credentials, and confirm each node
against your exact n8n version before activating.

---

## Setup (local n8n prototype)

The database is Supabase **cloud**, so it cannot call `http://localhost:5678` on
your laptop directly. For the DB triggers to reach local n8n, run n8n with a
public dev tunnel and paste the **tunnel Production webhook URLs** into
`private.app_config`.

1. **Start local n8n with a tunnel** and Europe/Lisbon timezone:
   ```bash
   export GENERIC_TIMEZONE=Europe/Lisbon
   n8n start --tunnel
   ```
   Alternative: use `ngrok` / `cloudflared`, but the URL in Supabase must be the
   public tunnel URL, not `localhost`.
2. **Import** all three JSON files (Workflows → Import from File).
3. **Create two credentials:**
   - **Supabase API** — Host = `https://YOUR_PROJECT_REF.supabase.co`,
     Service Role Secret = *(Supabase dashboard → Project Settings → API →
     `service_role`)*. The HTTP nodes use this predefined credential so both
     `apikey` and `Authorization` headers are set for you.
   - **Groq** (Header Auth) — Name `Authorization`, Value `Bearer <groq_key>`
     from https://console.groq.com. Models: `llama-3.1-8b-instant` (classify),
     `llama-3.3-70b-versatile` (generate).
4. **Set local n8n env vars** before starting n8n (or in your process manager):
   ```bash
   export II_WEBHOOK_SECRET='<private.app_config.n8n_webhook_secret>'
   export II_CASCADE_WEBHOOK_URL='http://localhost:5678/webhook/ii-slot-cascade'
   ```
   `II_CASCADE_WEBHOOK_URL` is only used by WF-A to re-post to WF-B after a
   cascade dec‍line. Because that call is n8n → n8n on the same machine,
   `localhost` is fine here. Supabase → n8n still needs the tunnel URL.
5. **Activate** the workflows, copy the tunnel **Production webhook URLs** for:
   - WF-A `/webhook/ii-inbound-reply`
   - WF-B `/webhook/ii-slot-cascade`

   Send me those two public URLs and I flip the DB live via MCP:
   ```sql
   update private.app_config set value = '<public WF-A tunnel URL>' where key = 'n8n_inbound_webhook_url';
   update private.app_config set value = '<public WF-B tunnel URL>' where key = 'n8n_cascade_webhook_url';
   ```

Then: open `/sms`, text as a patient → Supabase cloud pings your local n8n via
the tunnel → the agent replies → it lands back in the `/sms` thread and the
staff `/conversations` console. Cancel a booked slot in the DB → Supabase pings
WF-B via the tunnel and texts the next patient. WF-C runs locally at 18:30 (or
trigger it manually with **Execute Workflow**).

For a later hosted deployment, use the same workflows; just change the webhook
URLs and set `II_CASCADE_WEBHOOK_URL` to the hosted WF-B Production URL.

---

## The two Groq prompts

**Intent classifier** (system) — model `llama-3.1-8b-instant`, temperature 0,
JSON mode:
```
Classify the patient reply into ONE category and detect the language.
Categories: ACCEPT, DEC‍LINE, QUESTION, FRUSTRATED, INSURANCE, UNCLEAR.
Rules: SIM/yes/ok → ACCEPT. NÃO/no → DEC‍LINE. profanity/insults → FRUSTRATED.
"seguro/subsistema/ADSE/pagamento/preço" → INSURANCE. A message that starts a
NEW request (not a reply) → QUESTION. Return strict JSON:
{"category":"...","lang":"pt|en"}. No prose.
```
(Opt-out STOP/PARAR/CANCELAR handling is a TODO — needs a no-contact RPC before
it can be wired in front of the classifier.)

**Response generator** (system) — model `llama-3.3-70b-versatile`, temp ~0.3:
```
You are a receptionist at {clinic_name} in Portugal handling a {conversation_type}
conversation with {patient_name}.
RULES: formal European Portuguese ("você"), or English if the patient wrote in
English. Never introduce yourself. Under 160 characters when possible. Never
blame the patient. Explain the "why". Do NOT answer insurance/money/medical
questions — that path escalates instead. End agent-initiated messages with the
opt-out line ("Responda STOP para não receber mais mensagens.").
CONTEXT: {related_slot / flow context}
CONVERSATION: {messages}
Reply with ONLY the message text.
```
WF-A's cascade/confirmation acknowledgements ("Perfeito, está confirmada." etc.)
are **deterministic strings** built in the *After RPC* Code node — no Groq call,
so they can't hallucinate a wrong outcome.
