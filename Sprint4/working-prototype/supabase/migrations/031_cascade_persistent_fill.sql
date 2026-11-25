-- 031_cascade_persistent_fill.sql
-- "Really fill that slot." Three cascade policy changes + one data change:
--   1. Unlimited attempts: clinics.cascade_max_attempts = NULL means no cap (keep asking
--      candidate after candidate until someone accepts or no candidate remains).
--   2. 3-month horizon: new clinics.cascade_horizon_days (default 90) replaces the hardcoded
--      14-day candidate window. Never pull someone booked further out than this.
--   3. Ordering: same-day = furthest-first (biggest same-day win); future days = nearest-first
--      (walk outward day by day -- a next-working-day patient can realistically come; a patient
--       three months out cannot drop everything on short notice).
-- Late cancellations (< cutoff, default 2h) are unchanged: the existing cutoff gate means the
-- freed slot is never offered -> it stays 'cancelled' (removed from the agenda), recorded as lost.
-- The offer cooldown is a data setting (clinics.offer_cooldown_minutes), raised to 2 days below.
alter table public.clinics
  add column if not exists cascade_horizon_days integer not null default 90;

create or replace function public.cascade_offer_next(p_slot_id uuid)
returns json language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_slot public.slots%rowtype; v_cutoff_h integer; v_max integer; v_cooldown integer;
  v_prefer_furthest boolean; v_horizon_days integer;
  v_offers integer; v_step integer; v_expires timestamptz; v_exclude uuid;
  v_cand_patient uuid; v_cand_slot uuid; v_cand_name text; v_cand_start timestamptz; v_source text;
  v_conv uuid; v_offer uuid;
begin
  select * into v_slot from public.slots where id = p_slot_id;
  if not found then return json_build_object('status','noop','reason','slot_not_found'); end if;
  if v_slot.status <> 'cancelled' then return json_build_object('status','noop','reason','slot_not_cancelled'); end if;
  select coalesce(cascade_cutoff_hours,2), cascade_max_attempts,
         coalesce(offer_cooldown_minutes,180), coalesce(cascade_prefer_furthest,true),
         coalesce(cascade_horizon_days,90)
    into v_cutoff_h, v_max, v_cooldown, v_prefer_furthest, v_horizon_days
    from public.clinics where id = v_slot.clinic_id;
  -- Hard stop: a slot within the cutoff (default 2h) is never offered -> lost, removed from agenda.
  if now() >= v_slot.start_time - make_interval(hours => v_cutoff_h) then return json_build_object('status','cutoff'); end if;
  -- Attempt cap: NULL means unlimited ("keep asking until filled or horizon exhausted").
  select count(*) into v_offers from public.cascade_offers where slot_id = p_slot_id;
  if v_max is not null and v_offers >= v_max then return json_build_object('status','exhausted'); end if;
  v_exclude := coalesce(v_slot.original_patient_id, v_slot.patient_id);
  select patient_id, candidate_slot_id, patient_name, cand_start, source
    into v_cand_patient, v_cand_slot, v_cand_name, v_cand_start, v_source
  from (
    select cand.patient_id, cand.id as candidate_slot_id, p.name as patient_name, cand.start_time as cand_start,
      case when cand.start_time::date = v_slot.start_time::date then 'same_day' else 'future' end as source,
      case when cand.start_time::date = v_slot.start_time::date then 1 else 2 end as tier,
      -- same-day: furthest-first (biggest same-day improvement); future: nearest-first (walk outward)
      case when cand.start_time::date = v_slot.start_time::date
           then (case when v_prefer_furthest then -1 else 1 end) * extract(epoch from cand.start_time)
           else extract(epoch from cand.start_time)
      end as sort_key
    from public.slots cand
    join public.patients p on p.id = cand.patient_id
    where cand.clinic_id = v_slot.clinic_id and cand.id <> v_slot.id
      and cand.status in ('booked','confirmed') and cand.patient_id is not null
      and cand.start_time > v_slot.start_time
      and cand.start_time <= now() + make_interval(days => v_horizon_days)
      and p.is_active and p.accepts_short_notice
      and cand.patient_id <> coalesce(v_exclude, '00000000-0000-0000-0000-000000000000'::uuid)
      and cand.patient_id not in (select patient_id from public.cascade_offers where slot_id = p_slot_id)
    union all
    select w.patient_id, null::uuid, p.name, null::timestamptz, 'waiting_list', 3,
      case w.urgency when 'urgent' then 0 when 'soon' then 1 else 2 end * 1e12 + extract(epoch from w.added_at)
    from public.waiting_list w
    join public.patients p on p.id = w.patient_id
    where w.clinic_id = v_slot.clinic_id and w.status='active' and p.is_active
      and w.patient_id <> coalesce(v_exclude, '00000000-0000-0000-0000-000000000000'::uuid)
      and w.patient_id not in (select patient_id from public.cascade_offers where slot_id = p_slot_id)
  ) ranked
  where not exists (select 1 from public.conversations c where c.patient_id = ranked.patient_id and c.status='active'
      and (c.conversation_type in ('slot_cascade','pullforward') or c.offered_slot_ids is not null))
  and not exists (select 1 from public.conversations c where c.patient_id = ranked.patient_id
      and c.conversation_type in ('slot_cascade','pullforward') and c.created_at > now() - make_interval(mins => v_cooldown))
  and not exists (select 1 from public.patients pp where pp.id = ranked.patient_id and pp.opted_out)
  order by tier asc, sort_key asc limit 1;
  if v_cand_patient is null then return json_build_object('status','no_candidates'); end if;
  v_step := v_offers + 1; v_expires := v_slot.start_time - make_interval(hours => v_cutoff_h);
  insert into public.cascade_offers (clinic_id, slot_id, patient_id, candidate_slot_id, expires_at, status, cascade_step)
  values (v_slot.clinic_id, v_slot.id, v_cand_patient, v_cand_slot, v_expires, 'pending', v_step) returning id into v_offer;
  insert into public.conversations (clinic_id, patient_id, conversation_type, related_slot_id, related_cascade_offer_id, status)
  values (v_slot.clinic_id, v_cand_patient, 'slot_cascade', v_slot.id, v_offer, 'active') returning id into v_conv;
  return json_build_object('status','offer','conversation_id',v_conv,'offer_id',v_offer,'cascade_step',v_step,'source',v_source,
    'patient',json_build_object('name',v_cand_name),
    'freed_slot',json_build_object('id',v_slot.id,'start_time',v_slot.start_time,'end_time',v_slot.end_time,'doctor_name',v_slot.doctor_name),
    'candidate_slot',case when v_cand_start is not null then json_build_object('start_time',v_cand_start) else null end);
end;
$function$;

revoke all on function public.cascade_offer_next(uuid) from public, anon, authenticated;
grant execute on function public.cascade_offer_next(uuid) to service_role;

-- Live clinic policy: unlimited attempts + 2-day cooldown + 90-day horizon.
update public.clinics
   set cascade_max_attempts   = null,
       offer_cooldown_minutes = 2880,
       cascade_horizon_days   = 90
 where slug = 'clinica-sousa';
