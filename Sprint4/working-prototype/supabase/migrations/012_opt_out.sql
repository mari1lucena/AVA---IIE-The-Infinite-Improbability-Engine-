-- 012: STOP / opt-out enforcement (RGPD). Deterministic — never LLM-decided.
-- patients.opted_out gates ALL proactive messaging (cascade, pull-forward,
-- confirmation). WF-A detects STOP/PARAR/CANCELAR before the classifier and calls
-- patient_opt_out; START/ATIVAR re-subscribes via patient_opt_in.

alter table public.patients
  add column if not exists opted_out    boolean     not null default false,
  add column if not exists opted_out_at timestamptz;

-- --------------------------------------------------------------------------
create or replace function public.patient_opt_out(p_conversation_id uuid)
returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_patient uuid;
begin
  select patient_id into v_patient from public.conversations where id = p_conversation_id;
  if v_patient is null then return json_build_object('status','error','reason','no_patient'); end if;

  update public.patients set opted_out = true, opted_out_at = now(), updated_at = now()
   where id = v_patient;

  -- Tidy any pending proactive offers so nothing lingers for an opted-out patient.
  update public.cascade_offers set status='declined', responded_at=now(), response_message='OPTED_OUT'
   where patient_id = v_patient and status='pending';
  update public.conversations
     set status='resolved', offered_slot_ids=null, resolved_at=now(),
         resolution_outcome='opted_out', updated_at=now()
   where patient_id = v_patient and status='active'
     and conversation_type in ('slot_cascade','pullforward');
  update public.conversations set status='resolved', resolved_at=now(), updated_at=now()
   where id = p_conversation_id;

  return json_build_object('status','opted_out');
end $$;

create or replace function public.patient_opt_in(p_conversation_id uuid)
returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_patient uuid;
begin
  select patient_id into v_patient from public.conversations where id = p_conversation_id;
  if v_patient is null then return json_build_object('status','error','reason','no_patient'); end if;
  update public.patients set opted_out = false, opted_out_at = null, updated_at = now()
   where id = v_patient;
  update public.conversations set status='resolved', resolved_at=now(), updated_at=now()
   where id = p_conversation_id;
  return json_build_object('status','opted_in');
end $$;

revoke all on function public.patient_opt_out(uuid) from public;
revoke all on function public.patient_opt_in(uuid)  from public;
grant execute on function public.patient_opt_out(uuid) to service_role;
grant execute on function public.patient_opt_in(uuid)  to service_role;

-- --------------------------------------------------------------------------
-- Enforcement: opted-out patients are never selected by a proactive flow.
-- cascade_offer_next: one extra guard on the ranked candidate.
create or replace function public.cascade_offer_next(p_slot_id uuid)
returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_slot        public.slots%rowtype;
  v_cutoff_h    integer;
  v_max         integer;
  v_cooldown    integer;
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
  if not found then return json_build_object('status','noop','reason','slot_not_found'); end if;
  if v_slot.status <> 'cancelled' then return json_build_object('status','noop','reason','slot_not_cancelled'); end if;

  select coalesce(cascade_cutoff_hours,2), coalesce(cascade_max_attempts,3), coalesce(offer_cooldown_minutes,180)
    into v_cutoff_h, v_max, v_cooldown from public.clinics where id = v_slot.clinic_id;

  if now() >= v_slot.start_time - make_interval(hours => v_cutoff_h) then return json_build_object('status','cutoff'); end if;
  select count(*) into v_offers from public.cascade_offers where slot_id = p_slot_id;
  if v_offers >= v_max then return json_build_object('status','exhausted'); end if;
  v_exclude := coalesce(v_slot.original_patient_id, v_slot.patient_id);

  select patient_id, candidate_slot_id, patient_name, cand_start, source
    into v_cand_patient, v_cand_slot, v_cand_name, v_cand_start, v_source
  from (
    select cand.patient_id, cand.id as candidate_slot_id, p.name as patient_name, cand.start_time as cand_start,
      case when cand.start_time::date = v_slot.start_time::date then 'same_day' else 'future' end as source,
      case when cand.start_time::date = v_slot.start_time::date then 1 else 2 end as tier,
      extract(epoch from cand.start_time) as sort_key
    from public.slots cand
    join public.patients p on p.id = cand.patient_id
    where cand.clinic_id = v_slot.clinic_id and cand.id <> v_slot.id
      and cand.status in ('booked','confirmed') and cand.patient_id is not null
      and cand.start_time > v_slot.start_time and cand.start_time <= now() + interval '14 days'
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
  where not exists (
    select 1 from public.conversations c where c.patient_id = ranked.patient_id and c.status='active'
      and (c.conversation_type in ('slot_cascade','pullforward') or c.offered_slot_ids is not null))
  and not exists (
    select 1 from public.conversations c where c.patient_id = ranked.patient_id
      and c.conversation_type in ('slot_cascade','pullforward')
      and c.created_at > now() - make_interval(mins => v_cooldown))
  and not exists (select 1 from public.patients pp where pp.id = ranked.patient_id and pp.opted_out)
  order by tier asc, sort_key asc
  limit 1;

  if v_cand_patient is null then return json_build_object('status','no_candidates'); end if;

  v_step := v_offers + 1;
  v_expires := v_slot.start_time - make_interval(hours => v_cutoff_h);
  insert into public.cascade_offers (clinic_id, slot_id, patient_id, candidate_slot_id, expires_at, status, cascade_step)
  values (v_slot.clinic_id, v_slot.id, v_cand_patient, v_cand_slot, v_expires, 'pending', v_step) returning id into v_offer;
  insert into public.conversations (clinic_id, patient_id, conversation_type, related_slot_id, related_cascade_offer_id, status)
  values (v_slot.clinic_id, v_cand_patient, 'slot_cascade', v_slot.id, v_offer, 'active') returning id into v_conv;

  return json_build_object(
    'status','offer','conversation_id',v_conv,'offer_id',v_offer,'cascade_step',v_step,'source',v_source,
    'patient',json_build_object('name',v_cand_name),
    'freed_slot',json_build_object('id',v_slot.id,'start_time',v_slot.start_time,'end_time',v_slot.end_time,'doctor_name',v_slot.doctor_name),
    'candidate_slot',case when v_cand_start is not null then json_build_object('start_time',v_cand_start) else null end);
end;
$function$;

-- pullforward_offer_next: opt-out guard on the candidate.
create or replace function public.pullforward_offer_next(p_clinic_id uuid default null, p_target_date date default null)
returns setof json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  v_date date := coalesce(p_target_date, current_date + 1);
  r record; v_conv uuid;
  v_used_patients uuid[] := '{}'; v_used_slots uuid[] := '{}';
begin
  for r in
    select cur.id as current_slot_id, cur.patient_id, cur.clinic_id, cur.start_time as cur_start,
      p.name as patient_name, av.id as earlier_slot_id, av.start_time as earlier_start, av.doctor_name as earlier_doctor
    from public.slots cur
    join public.patients p on p.id = cur.patient_id
    join public.clinics  cl on cl.id = cur.clinic_id
    join public.slots av on av.clinic_id = cur.clinic_id and av.status='available'
      and av.start_time::date = cur.start_time::date
      and av.start_time <= cur.start_time - interval '30 minutes'
      and av.start_time  > now() + interval '2 hours'
    where cur.status in ('booked','confirmed') and cur.start_time::date = v_date
      and p.is_active and p.accepts_short_notice and coalesce(p.opted_out,false) = false
      and (p_clinic_id is null or cur.clinic_id = p_clinic_id)
      and not exists (select 1 from public.conversations c where c.related_slot_id = cur.id and c.conversation_type='pullforward')
      and not exists (select 1 from public.conversations c where c.patient_id = cur.patient_id and c.status='active'
            and (c.conversation_type in ('slot_cascade','pullforward') or c.offered_slot_ids is not null))
      and not exists (select 1 from public.conversations c where c.patient_id = cur.patient_id
            and c.conversation_type in ('slot_cascade','pullforward')
            and c.created_at > now() - make_interval(mins => coalesce(cl.offer_cooldown_minutes,180)))
    order by av.start_time, cur.start_time
  loop
    if r.patient_id = any(v_used_patients) or r.earlier_slot_id = any(v_used_slots) then continue; end if;
    v_used_patients := array_append(v_used_patients, r.patient_id);
    v_used_slots := array_append(v_used_slots, r.earlier_slot_id);
    insert into public.conversations (clinic_id, patient_id, conversation_type, related_slot_id, status, offered_slot_ids)
    values (r.clinic_id, r.patient_id, 'pullforward', r.current_slot_id, 'active', array[r.earlier_slot_id]) returning id into v_conv;
    return next json_build_object('conversation_id', v_conv, 'patient', json_build_object('name', r.patient_name),
      'current_slot', json_build_object('start_time', r.cur_start),
      'earlier_slot', json_build_object('slot_id', r.earlier_slot_id, 'start_time', r.earlier_start, 'doctor_name', r.earlier_doctor));
  end loop;
end;
$$;

-- confirmations_start: skip opted-out patients.
create or replace function public.confirmations_start(p_clinic_id uuid default null, p_target_date date default null)
returns setof json
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_date date := coalesce(p_target_date, (current_date + 1)); r record; v_conv uuid;
begin
  for r in
    select s.id as slot_id, s.clinic_id, s.start_time, s.doctor_name, s.patient_id, p.name as patient_name
    from public.slots s
    join public.patients p on p.id = s.patient_id
    where s.status='booked' and s.start_time::date = v_date and p.is_active
      and coalesce(p.opted_out,false) = false
      and (p_clinic_id is null or s.clinic_id = p_clinic_id)
      and not exists (select 1 from public.conversations c where c.related_slot_id = s.id
            and c.conversation_type='confirmation' and c.status='active')
    order by s.start_time
  loop
    insert into public.conversations (clinic_id, patient_id, conversation_type, related_slot_id, status)
    values (r.clinic_id, r.patient_id, 'confirmation', r.slot_id, 'active') returning id into v_conv;
    return next json_build_object('conversation_id', v_conv, 'slot_id', r.slot_id,
      'patient', json_build_object('name', r.patient_name),
      'slot', json_build_object('start_time', r.start_time, 'doctor_name', r.doctor_name));
  end loop;
end;
$function$;
