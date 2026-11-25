-- 010: Phase-2 "pull forward" — proactively offer an earlier open slot to a
-- patient booked (or confirmed) later the same day. Runs after the day-before
-- confirmation round (WF-D, delayed by PHASE2_DELAY_SECONDS). Reuses the booking
-- machinery: it sets conversations.offered_slot_ids so a reply routes to WF-A's
-- booking-choice branch (which calls book_slot -> moves the patient, frees the
-- old slot -> cascade). One offer per appointment, patients who opted out of
-- short notice are skipped.

-- pullforward_offer_next: one row per eligible (patient -> earlier open slot) pair.
create or replace function public.pullforward_offer_next(
  p_clinic_id uuid default null,
  p_target_date date default null
) returns setof json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  v_date date := coalesce(p_target_date, current_date + 1);
  r record;
  v_conv uuid;
  v_used_patients uuid[] := '{}';
  v_used_slots    uuid[] := '{}';
begin
  -- Consider every (later appointment -> earlier open slot) pair, then greedily
  -- assign so each open slot and each patient is used at most once (earliest
  -- open slots first, to the earliest-booked eligible patient).
  for r in
    select
      cur.id          as current_slot_id,
      cur.patient_id,
      cur.clinic_id,
      cur.start_time  as cur_start,
      p.name          as patient_name,
      av.id           as earlier_slot_id,
      av.start_time   as earlier_start,
      av.doctor_name  as earlier_doctor
    from public.slots cur
    join public.patients p on p.id = cur.patient_id
    join public.slots av
      on av.clinic_id = cur.clinic_id
     and av.status = 'available'
     and av.start_time::date = cur.start_time::date
     and av.start_time <= cur.start_time - interval '30 minutes'
     and av.start_time  > now() + interval '2 hours'
    where cur.status in ('booked','confirmed')
      and cur.start_time::date = v_date
      and p.is_active
      and p.accepts_short_notice
      and (p_clinic_id is null or cur.clinic_id = p_clinic_id)
      and not exists (
        select 1 from public.conversations c
        where c.related_slot_id = cur.id and c.conversation_type = 'pullforward'
      )
    order by av.start_time, cur.start_time
  loop
    if r.patient_id = any(v_used_patients) or r.earlier_slot_id = any(v_used_slots) then
      continue;
    end if;
    v_used_patients := array_append(v_used_patients, r.patient_id);
    v_used_slots    := array_append(v_used_slots, r.earlier_slot_id);
    insert into public.conversations (
      clinic_id, patient_id, conversation_type, related_slot_id, status, offered_slot_ids
    ) values (
      r.clinic_id, r.patient_id, 'pullforward', r.current_slot_id, 'active', array[r.earlier_slot_id]
    ) returning id into v_conv;

    return next json_build_object(
      'conversation_id', v_conv,
      'patient', json_build_object('name', r.patient_name),
      'current_slot', json_build_object('start_time', r.cur_start),
      'earlier_slot', json_build_object(
        'slot_id', r.earlier_slot_id, 'start_time', r.earlier_start, 'doctor_name', r.earlier_doctor
      )
    );
  end loop;
end;
$$;

-- booking_decline: patient said "no thanks" to a booking/pull-forward offer.
-- Clear the pending choice and resolve the conversation, keeping their slot.
create or replace function public.booking_decline(p_conversation_id uuid)
returns json
language sql security definer set search_path to 'public','pg_temp'
as $$
  update public.conversations
     set offered_slot_ids = null, status = 'resolved', resolved_at = now(),
         resolution_outcome = 'kept_current', updated_at = now()
   where id = p_conversation_id
  returning json_build_object('status','kept');
$$;

revoke all on function public.pullforward_offer_next(uuid,date) from public;
revoke all on function public.booking_decline(uuid)            from public;
grant execute on function public.pullforward_offer_next(uuid,date) to service_role;
grant execute on function public.booking_decline(uuid)            to service_role;
