# AVA — Patient Scoring + Emergency Fill — Design Notes (DRAFT)

> Status: **discussion / note-taking only — nothing implemented yet.**
> Started 2026-09-03. Two feature ideas from the user, captured here before any build.

---

## Feature 1 — Patient scoring system

**Idea (user's words):** a score per patient combining:
- where they live → travel time to the clinic
- how many times they've been offered a slot
- their availability
- their response rate (this specific person)

**Intended use (assumed, TO CONFIRM):** rank cascade / pull-forward / emergency candidates so we
offer freed slots to the person *most likely to say yes and actually make it*, instead of the
current geometric rule.

### How this collides with what already exists (important)

Today candidate ordering is NOT ML/score based — it's deterministic geometry:
- `cascade_offer_next` (migration `030`/`031`): same-day tier = **furthest-away** patient first
  (freed 10:00 → offer to the 16:00 patient, a big win beats "come 30 min earlier"); future tier =
  **nearest-first** (walk outward day by day). Controlled by `clinics.cascade_prefer_furthest`.
- Offer hygiene (`011`): one pending offer per patient, `offer_cooldown_minutes` (currently 2880 =
  2 days for clinica-sousa) before re-asking.
- `clinics.cascade_max_attempts = NULL` (unlimited) + `cascade_horizon_days = 90`.

**So a score would either (a) replace this ordering, (b) become a tie-breaker within a tier, or
(c) become a *filter* (skip low-probability people).** This is the single biggest design decision.

### Data we already have vs. need to build

| Score input | Have it? | Notes |
|---|---|---|
| Times offered | ❌ derivable | Count `cascade_offers` / `conversations` per patient — need to aggregate, maybe denormalize a counter. |
| Response rate | ❌ | Need offers-sent vs. offers-answered history per patient. Not tracked as a rate today. |
| Availability | ⚠️ partial | We have `patients.short_notice`(?) flag + accepted-time history buried in slots/conversations. No structured "prefers mornings / can't do Fridays". |
| Travel time / where they live | ❌ | **`patients` has no address/location field today** (name, phone, active, opt-out, primary_doctor_id). Needs new column(s) + a distance source. |

### Open questions — scoring
1. **What does the score DECIDE?** Ordering within a tier (tie-break), full re-ordering across tiers,
   a hard filter, or just a staff-facing number on `/patients`?
2. **Travel time** — do we store a patient address and geocode + call a distance API (Google
   Distance Matrix)? Or a coarser proxy (postal code zone, or a manual "distance band"
   near/medium/far the receptionist sets)? API = cost + RGPD (storing home address).
3. Is travel time meant to **penalize far patients** (less likely to make a last-minute slot) or is
   it informational? For the *emergency* 1-hour case it's clearly a hard constraint (can they
   physically get there in time?). For normal cascade it's softer.
4. **Response rate cold-start** — brand-new patients have no history. Default to neutral/high so they
   still get offered, or treat unknown as low?
5. Should "times offered" *lower* the score (don't spam the same person) — i.e. is this really the
   same intent as the existing `offer_cooldown_minutes`, or an additional fairness signal?
6. Score recomputed on the fly at offer time, or stored/denormalized and updated by triggers?

---

## Feature 2 — Emergency fill (last hour)

**Idea (user's words):** if a slot is still unfilled with **1 hour left** before the appointment,
enter an "emergency" mode:
- ask **3 people at a time** (parallel), each with a **10-minute timer** to answer
- if someone answers **after 11 min** → "offer expired, you're still at [your old time]"

### How this collides with what already exists (important)

- **Cascade cutoff is −2h.** Today, once you're inside 2 hours before a freed slot, the cascade
  gate returns `'cutoff'` and **nobody is asked** — the slot is recorded as lost. Emergency mode is
  explicitly a NEW, more aggressive window *inside* that cutoff (2h → 1h → appointment). Need to
  decide the exact window: does emergency run from −1h to −0h? And does it also cover slots that
  were freed earlier but never filled?
- **One-offer-at-a-time is a core invariant.** `cascade_offer_next` offers exactly ONE candidate and
  offer hygiene forbids two live offers to one person. Emergency's "3 at a time" **breaks this on
  purpose** and creates the classic race: what if 2 or 3 of them accept? First-write-wins +
  auto "expired, you keep your old slot" for the losers? That needs real concurrency handling
  (row locking on the target slot).
- The people being asked are **existing later-booked patients being pulled forward** (they have an
  "old time" to keep) — so this is emergency *pull-forward*, not waiting-list backfill. Or is it
  BOTH (also blast the waiting list, who have no old time)?

### Open questions — emergency
1. **Trigger source:** who watches the clock? A cron every minute scanning for unfilled slots
   inside the emergency window? (We have WF-C cron + pg_net triggers; no per-minute sweeper yet.)
2. **Which slots qualify?** Only slots freed by a cancellation and still empty? Any `available`
   grid vaga at −1h (there are ~450 of those — that would blast people for routine empty slots)?
   Presumably only slots that were a *real* booking that got cancelled/no-showed. TO CONFIRM.
3. **The 3 candidates** — chosen how? This is where Feature 1's score would plug in (top-3 by
   score, filtered to those who can physically arrive within the hour = travel-time hard gate).
4. **Race on accept:** 3 asked, timer running. Person A accepts at min 4 → slot booked, A's old
   slot freed (→ cascades). What message do B and C get, and when — immediately ("já foi
   preenchida, mantém a sua consulta"), or only if/when they reply?
5. **The 10-min timer + "after 11 min = expired":** is the offer hard-expired at exactly 10:00 so a
   reply at 10:30 is refused? What if NONE of the 3 answer in 10 min — ask the next 3? Keep going
   until −0h? Then record lost?
6. **Physical feasibility:** offering a slot 40 min away to someone 55 min from the clinic with 50
   min left is pointless — travel time should hard-gate the emergency candidate list. (Ties Feature
   1's travel data directly to Feature 2.)
7. **Opt-out / cooldown during emergency:** does the 2-day `offer_cooldown_minutes` still apply, or
   does emergency override it (it's urgent)? STOP/opt-out must ALWAYS be respected regardless.
8. **Who is "you're still at [old time]"** — confirms we're only pulling forward already-booked
   patients. Waiting-list / new patients (no old appointment) would need different copy.

---

## DECISIONS — round 1 (2026-09-03)

**Scoring**
- Score = **predicted probability this patient accepts an offer**, expressed **0–100**. Used to
  **rank candidates** (most-likely-to-accept first).
- **Address** captured **at booking time** (ask the patient), OR imported from the clinic's
  incumbent platform if it already holds it. → new `patients.address` (+ geocode/travel data).
- **Response rate** counts *all* messages that expected a reply (confirmations included): replying
  at all raises it. So "did they answer us" is a distinct signal from "did they accept".
- **Accept/decline** moves the score: a **decline lowers** it, an accept keeps/raises it.
- Travel time **hard-gates** emergency candidates (can they physically arrive in time). (Its role in
  the *normal* cascade score still TBD — see round-2 Q.)

**Emergency**
- Triggers **only for a slot that was a real booking and got cancelled** and is still empty inside
  the emergency window. Never for routine `available` grid vagas.
- Pool = **already-booked later patients only** (each has an "old time" to fall back to).
- Ask **3 at a time**, **10-min timer**; a reply after the window = "offer expired, você mantém a
  sua consulta às [old time]".
- On the **first accept**, the other two are told **immediately** ("já foi preenchida, mantém a sua
  consulta").
- Keep firing batches of 3 until ~**31 min before** the appointment (10-min window → an accept can
  still land ~21 min out). **[WIP — exact cutoff still open, and must reconcile with travel gate:
  no point offering to someone who can't arrive by the appointment.]**
- Candidates picked by **score (top-3 most likely to accept)**, filtered by the **travel hard-gate**.

## Cross-cutting
- **RGPD:** storing home address / travel time is new personal data → consent + the `docs` privacy
  posture. Worth a line in the RGPD open-decisions table.
- **Multi-offer concurrency** is the hardest engineering piece (emergency), and it contradicts a
  currently-relied-on invariant — needs `select ... for update` slot locking so two accepts can't
  double-book.
- Both features likely want a new `patients.address`/`patients.travel_minutes` and an
  `offer_outcomes`/history rollup for response rate.
