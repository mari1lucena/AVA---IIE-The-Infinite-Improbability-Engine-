-- 008_cascade_confirmation_rpcs.sql
-- Server-side logic for the slot-recovery cascade (WF-B / Flow 1) and the
-- day-before confirmation flow (WF-C / Flow 5). Follows the fat-RPC pattern:
-- all decisions live here (SECURITY DEFINER, service_role from n8n), n8n stays
-- thin -- it only generates the natural-language text and posts it.
--
-- Event-driven chaining: the freed slot is worked by making ONE pending offer at
-- a time. Filling a slot uses status 'confirmed' (no re-fire). Vacating a
-- moved-up patient's old slot sets status 'cancelled', which fires
-- trg_notify_n8n_slot_cancelled -> the cascade webhook -> WF-B again. So a chain
-- of moves happens automatically without n8n looping.
--
-- Applied + smoke-tested against YOUR_PROJECT_REF on 2026-08-13.

-- --------------------------------------------------------------------------
-- Schema: remember which slot a cascade candidate is being moved out of, so
-- accepting can vacate it deterministically (waiting-list candidates have none).
-- --------------------------------------------------------------------------
alter table public.cascade_offers
  add column if not exists candidate_slot_id uuid references public.slots(id);

-- --------------------------------------------------------------------------
-- cascade_offer_next(slot_id): make the next offer for a freed (cancelled) slot.
-- Called by WF-B on the slot_cancelled webhook, and re-invoked by WF-A to advance
-- after a decline/expiry. Returns a JSON envelope with a "status":
--   offer          -> a candidate was found; payload has everything to write the SMS
--   noop           -> slot is not cancelled anymore (already refilled)
--   cutoff         -> past the clinic's -Nh cutoff; stop (slot stays lost)
--   exhausted      -> hit cascade_max_attempts; stop
--   no_candidates  -> nobody eligible left; stop
-- --------------------------------------------------------------------------
create or replace function public.cascade_offer_next(p_slot_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_slot        public.slots%rowtype;
  v_cutoff_h    integer;
  v_max         integer;
  v_offers      integer;
  v_step        integer;
  v_expires     timestamptz;
  v_exclude     uuid;
  v_cand_patient uuid;
  v_cand_slot   uuid;
  v_cand_name   text;
  v_cand_start  timestamptz;
  v_source      text;
  v_conv        uuid;
  v_offer       uuid;
begin
  select * into v_slot from public.slots where id = p_slot_id;
  if not found then
    return json_build_object('status', 'noop', 'reason', 'slot_not_found');
  end if;

  -- Only work slots that are actually free.
  if v_slot.status <> 'cancelled' then
    return json_build_object('status', 'noop', 'reason', 'slot_not_cancelled');
  end if;

  select coalesce(cascade_cutoff_hours, 2), coalesce(cascade_max_attempts, 3)
    into v_cutoff_h, v_max
    from public.clinics where id = v_slot.clinic_id;

  -- Practical booking limit: stop once we're within the cutoff window.
  if now() >= v_slot.start_time - make_interval(hours => v_cutoff_h) then
    return json_build_object('status', 'cutoff');
  end if;

  select count(*) into v_offers from public.cascade_offers where slot_id = p_slot_id;
  if v_offers >= v_max then
    return json_build_object('status', 'exhausted');
  end if;

  -- Never offer the freed slot to the person who just gave it up.
  v_exclude := coalesce(v_slot.original_patient_id, v_slot.patient_id);

  -- Pick the single best candidate.
  --   tier 1: booked/confirmed slot later the SAME day  (soonest first)
  --   tier 2: booked/confirmed slot later, within 14 days (soonest first)
  --   tier 3: active waiting-list entry (urgency, then FIFO)
  -- Exclude: inactive patients, the original patient, and anyone already offered
  -- this slot in a previous cascade step.
  select patient_id, candidate_slot_id, patient_name, cand_start, source
    into v_cand_patient, v_cand_slot, v_cand_name, v_cand_start, v_source
  from (
    -- tiers 1 & 2: existing later bookings
    select
      cand.patient_id,
      cand.id                    as candidate_slot_id,
      p.name                     as patient_name,
      cand.start_time            as cand_start,
      case when cand.start_time::date = v_slot.start_time::date
           then 'same_day' else 'future' end as source,
      case when cand.start_time::date = v_slot.start_time::date then 1 else 2 end as tier,
      extract(epoch from cand.start_time) as sort_key
    from public.slots cand
    join public.patients p on p.id = cand.patient_id
    where cand.clinic_id = v_slot.clinic_id
      and cand.id <> v_slot.id
      and cand.status in ('booked', 'confirmed')
      and cand.patient_id is not null
      and cand.start_time > v_slot.start_time
      and cand.start_time <= now() + interval '14 days'
      and p.is_active
      and p.accepts_short_notice
      and cand.patient_id <> coalesce(v_exclude, '00000000-0000-0000-0000-000000000000'::uuid)
      and cand.patient_id not in (select patient_id from public.cascade_offers where slot_id = p_slot_id)

    union all

    -- tier 3: waiting list
    select
      w.patient_id,
      null::uuid                 as candidate_slot_id,
      p.name                     as patient_name,
      null::timestamptz          as cand_start,
      'waiting_list'             as source,
      3                          as tier,
      case w.urgency when 'urgent' then 0 when 'soon' then 1 else 2 end * 1e12
        + extract(epoch from w.added_at) as sort_key
    from public.waiting_list w
    join public.patients p on p.id = w.patient_id
    where w.clinic_id = v_slot.clinic_id
      and w.status = 'active'
      and p.is_active
      and w.patient_id <> coalesce(v_exclude, '00000000-0000-0000-0000-000000000000'::uuid)
      and w.patient_id not in (select patient_id from public.cascade_offers where slot_id = p_slot_id)
  ) ranked
  order by tier asc, sort_key asc
  limit 1;

  if v_cand_patient is null then
    return json_build_object('status', 'no_candidates');
  end if;

  v_step    := v_offers + 1;
  v_expires := v_slot.start_time - make_interval(hours => v_cutoff_h);

  insert into public.cascade_offers (
    clinic_id, slot_id, patient_id, candidate_slot_id,
    expires_at, status, cascade_step
  ) values (
    v_slot.clinic_id, v_slot.id, v_cand_patient, v_cand_slot,
    v_expires, 'pending', v_step
  ) returning id into v_offer;

  insert into public.conversations (
    clinic_id, patient_id, conversation_type,
    related_slot_id, related_cascade_offer_id, status
  ) values (
    v_slot.clinic_id, v_cand_patient, 'slot_cascade',
    v_slot.id, v_offer, 'active'
  ) returning id into v_conv;

  return json_build_object(
    'status',          'offer',
    'conversation_id', v_conv,
    'offer_id',        v_offer,
    'cascade_step',    v_step,
    'source',          v_source,
    'patient',         json_build_object('name', v_cand_name),
    'freed_slot',      json_build_object(
                         'id', v_slot.id,
                         'start_time', v_slot.start_time,
                         'end_time', v_slot.end_time,
                         'doctor_name', v_slot.doctor_name
                       ),
    'candidate_slot',  case when v_cand_start is not null
                         then json_build_object('start_time', v_cand_start)
                         else null end
  );
end;
$$;

-- --------------------------------------------------------------------------
-- cascade_respond_accept(conversation_id): the candidate said SIM.
-- Fill the freed slot with them; vacate their old slot (-> 'cancelled' -> the
-- trigger auto-starts a fresh cascade for that now-empty slot). Idempotent:
-- a second call on an already-resolved offer returns status 'stale'.
-- --------------------------------------------------------------------------
create or replace function public.cascade_respond_accept(p_conversation_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_conv    public.conversations%rowtype;
  v_offer   public.cascade_offers%rowtype;
  v_freed   uuid;
  v_vacated uuid;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;

  select * into v_offer from public.cascade_offers where id = v_conv.related_cascade_offer_id;
  if not found then raise exception 'offer_not_found'; end if;

  if v_offer.status <> 'pending' then
    return json_build_object('status', 'stale', 'offer_status', v_offer.status);
  end if;

  v_freed   := v_offer.slot_id;
  v_vacated := v_offer.candidate_slot_id;

  update public.cascade_offers
     set status = 'accepted', responded_at = now(), response_message = 'ACCEPT'
   where id = v_offer.id;

  -- Give the freed slot to the candidate (status 'confirmed' -> no re-fire).
  update public.slots
     set patient_id   = v_offer.patient_id,
         status       = 'confirmed',
         confirmed_at = now(),
         cancelled_at = null,
         cancellation_reason = null,
         refilled_from = coalesce(refilled_from, 'cascade'),
         cascade_level = coalesce(cascade_level, 0) + 1
   where id = v_freed;

  -- Vacate their previous slot, if any -> 'cancelled' auto-chains the cascade.
  if v_vacated is not null then
    update public.slots
       set original_patient_id  = coalesce(original_patient_id, patient_id),
           patient_id           = null,
           status               = 'cancelled',
           cancelled_at         = now(),
           cancellation_reason  = 'cascade_vacated'
     where id = v_vacated
       and status in ('booked', 'confirmed');
  else
    -- waiting-list candidate: mark them booked.
    update public.waiting_list
       set status = 'booked', booked_at = now()
     where clinic_id = v_conv.clinic_id
       and patient_id = v_offer.patient_id
       and status = 'active';
  end if;

  update public.conversations
     set status = 'resolved', resolved_at = now(),
         resolution_outcome = 'slot_filled', updated_at = now()
   where id = p_conversation_id;

  return json_build_object(
    'status', 'accepted',
    'filled_slot_id', v_freed,
    'vacated_slot_id', v_vacated
  );
end;
$$;

-- --------------------------------------------------------------------------
-- cascade_respond_decline(conversation_id): the candidate said NAO.
-- The freed slot is still cancelled; return its id so WF-A re-posts to WF-B to
-- offer the NEXT candidate.
-- --------------------------------------------------------------------------
create or replace function public.cascade_respond_decline(p_conversation_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_conv  public.conversations%rowtype;
  v_offer public.cascade_offers%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;

  select * into v_offer from public.cascade_offers where id = v_conv.related_cascade_offer_id;
  if not found then raise exception 'offer_not_found'; end if;

  if v_offer.status = 'pending' then
    update public.cascade_offers
       set status = 'declined', responded_at = now(), response_message = 'DECLINE'
     where id = v_offer.id;
  end if;

  update public.conversations
     set status = 'resolved', resolved_at = now(),
         resolution_outcome = 'declined', updated_at = now()
   where id = p_conversation_id;

  return json_build_object('status', 'declined', 'slot_id', v_offer.slot_id);
end;
$$;

-- --------------------------------------------------------------------------
-- cascade_expire_advance(clinic_id?): cron sweep. Expire pending offers past
-- their expires_at, and return the distinct slot_ids still worth working (still
-- cancelled and before cutoff) so the sweeper re-posts them to WF-B.
-- --------------------------------------------------------------------------
create or replace function public.cascade_expire_advance(p_clinic_id uuid default null)
returns setof json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- resolve conversations tied to now-expiring offers
  update public.conversations c
     set status = 'resolved', resolved_at = now(),
         resolution_outcome = 'offer_expired', updated_at = now()
   from public.cascade_offers o
   where c.related_cascade_offer_id = o.id
     and o.status = 'pending'
     and o.expires_at <= now()
     and (p_clinic_id is null or o.clinic_id = p_clinic_id);

  update public.cascade_offers o
     set status = 'expired', responded_at = now()
   where o.status = 'pending'
     and o.expires_at <= now()
     and (p_clinic_id is null or o.clinic_id = p_clinic_id);

  -- slots still free and still before cutoff -> advance them
  return query
    select json_build_object('slot_id', s.id, 'clinic_id', s.clinic_id, 'start_time', s.start_time)
    from public.slots s
    join public.clinics cl on cl.id = s.clinic_id
    where s.status = 'cancelled'
      and now() < s.start_time - make_interval(hours => coalesce(cl.cascade_cutoff_hours, 2))
      and (p_clinic_id is null or s.clinic_id = p_clinic_id)
      and exists (select 1 from public.cascade_offers o
                  where o.slot_id = s.id and o.status = 'expired');
end;
$$;

-- --------------------------------------------------------------------------
-- confirmations_start(clinic_id?, target_date?): open one confirmation
-- conversation per still-booked slot on the target day (default tomorrow). WF-C
-- loops the result and sends "Confirma? SIM/NAO". Skips slots that already have
-- an active confirmation conversation (safe to re-run).
-- --------------------------------------------------------------------------
create or replace function public.confirmations_start(
  p_clinic_id uuid default null,
  p_target_date date default null
)
returns setof json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_date date := coalesce(p_target_date, (current_date + 1));
  r      record;
  v_conv uuid;
begin
  for r in
    select s.id as slot_id, s.clinic_id, s.start_time, s.doctor_name,
           s.patient_id, p.name as patient_name
    from public.slots s
    join public.patients p on p.id = s.patient_id
    where s.status = 'booked'
      and s.start_time::date = v_date
      and p.is_active
      and (p_clinic_id is null or s.clinic_id = p_clinic_id)
      and not exists (
        select 1 from public.conversations c
        where c.related_slot_id = s.id
          and c.conversation_type = 'confirmation'
          and c.status = 'active'
      )
    order by s.start_time
  loop
    insert into public.conversations (
      clinic_id, patient_id, conversation_type, related_slot_id, status
    ) values (
      r.clinic_id, r.patient_id, 'confirmation', r.slot_id, 'active'
    ) returning id into v_conv;

    return next json_build_object(
      'conversation_id', v_conv,
      'slot_id', r.slot_id,
      'patient', json_build_object('name', r.patient_name),
      'slot', json_build_object('start_time', r.start_time, 'doctor_name', r.doctor_name)
    );
  end loop;
end;
$$;

-- --------------------------------------------------------------------------
-- confirmation_confirm(conversation_id): patient said SIM (or we treat silence
-- as confirmed elsewhere). Mark the slot confirmed.
-- --------------------------------------------------------------------------
create or replace function public.confirmation_confirm(p_conversation_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_conv public.conversations%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;

  update public.slots
     set status = 'confirmed', confirmed_at = now()
   where id = v_conv.related_slot_id
     and status = 'booked';

  update public.conversations
     set status = 'resolved', resolved_at = now(),
         resolution_outcome = 'confirmed', updated_at = now()
   where id = p_conversation_id;

  return json_build_object('status', 'confirmed', 'slot_id', v_conv.related_slot_id);
end;
$$;

-- --------------------------------------------------------------------------
-- confirmation_decline(conversation_id): patient said NAO. Free the slot ->
-- status 'cancelled' fires the trigger -> cascade starts automatically.
-- --------------------------------------------------------------------------
create or replace function public.confirmation_decline(p_conversation_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_conv public.conversations%rowtype;
  v_slot uuid;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  v_slot := v_conv.related_slot_id;

  update public.slots
     set original_patient_id = coalesce(original_patient_id, patient_id),
         patient_id          = null,
         status              = 'cancelled',
         cancelled_at        = now(),
         cancellation_reason = 'patient_declined_confirmation'
   where id = v_slot
     and status in ('booked', 'confirmed');

  update public.conversations
     set status = 'resolved', resolved_at = now(),
         resolution_outcome = 'declined_will_cascade', updated_at = now()
   where id = p_conversation_id;

  return json_build_object('status', 'declined', 'slot_id', v_slot);
end;
$$;

-- Expose to the service_role (n8n) and keep them off anon/authenticated.
revoke all on function
  public.cascade_offer_next(uuid),
  public.cascade_respond_accept(uuid),
  public.cascade_respond_decline(uuid),
  public.cascade_expire_advance(uuid),
  public.confirmations_start(uuid, date),
  public.confirmation_confirm(uuid),
  public.confirmation_decline(uuid)
from public, anon, authenticated;

grant execute on function
  public.cascade_offer_next(uuid),
  public.cascade_respond_accept(uuid),
  public.cascade_respond_decline(uuid),
  public.cascade_expire_advance(uuid),
  public.confirmations_start(uuid, date),
  public.confirmation_confirm(uuid),
  public.confirmation_decline(uuid)
to service_role;
