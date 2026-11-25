-- 009: Agent-driven rescheduling
-- Two new RPCs let the assist branch of WF-A handle a reschedule end-to-end
-- instead of escalating to a human:
--   find_availability(conversation, limit) -> next open slots; stamps the offered
--       ids on the conversation so the patient's next reply can be matched to a choice.
--   book_slot(conversation, slot)          -> "move" the patient: free their nearest
--       existing upcoming appointment (which auto-starts a cascade for it) and book
--       the chosen slot; resolves the conversation.
-- Plus booking_offer_clear() to drop the pending-choice state, and an agent_context
-- extension exposing offered_slots so the agent can match a reply to an option.

-- State: which slots we last offered this conversation (empty/null = not awaiting a choice).
alter table public.conversations
  add column if not exists offered_slot_ids uuid[];

-- --------------------------------------------------------------------------
create or replace function public.find_availability(
  p_conversation_id uuid,
  p_limit int default 3
) returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  v_clinic uuid;
  v_slots json;
  v_ids   uuid[];
begin
  select clinic_id into v_clinic from public.conversations where id = p_conversation_id;
  if v_clinic is null then
    return json_build_object('status','error','reason','conversation_not_found');
  end if;

  select coalesce(json_agg(x order by x.start_time), '[]'::json),
         array_agg(x.slot_id order by x.start_time)
    into v_slots, v_ids
  from (
    select s.id as slot_id, s.start_time, s.end_time, s.doctor_name
    from public.slots s
    where s.clinic_id = v_clinic
      and s.status = 'available'
      and s.start_time >  now() + interval '2 hours'
      and s.start_time <= now() + interval '21 days'
    order by s.start_time
    limit greatest(p_limit, 1)
  ) x;

  update public.conversations
     set offered_slot_ids = nullif(v_ids, '{}'), updated_at = now()
   where id = p_conversation_id;

  if v_ids is null or array_length(v_ids, 1) is null then
    return json_build_object('status','none');
  end if;
  return json_build_object('status','options','slots', v_slots);
end;
$$;

-- --------------------------------------------------------------------------
create or replace function public.book_slot(
  p_conversation_id uuid,
  p_slot_id uuid
) returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  v_patient uuid;
  v_clinic  uuid;
  v_slot    public.slots%rowtype;
  v_vacated uuid;
begin
  select patient_id, clinic_id into v_patient, v_clinic
    from public.conversations where id = p_conversation_id;
  if v_patient is null then
    return json_build_object('status','error','reason','no_patient');
  end if;

  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found or v_slot.clinic_id <> v_clinic then
    return json_build_object('status','unavailable','reason','not_found');
  end if;
  if v_slot.status <> 'available' then
    return json_build_object('status','unavailable','reason','taken');
  end if;

  -- Move: free the patient's nearest OTHER upcoming appointment (if any).
  -- Vacating it flips status to 'cancelled', which the DB trigger turns into a
  -- fresh cascade for that slot -- rescheduling composes with the wedge.
  select id into v_vacated
    from public.slots
   where clinic_id = v_clinic and patient_id = v_patient and id <> p_slot_id
     and status in ('booked','confirmed','pending_confirmation','offered')
     and start_time > now()
   order by start_time
   limit 1;

  if v_vacated is not null then
    update public.slots
       set original_patient_id = coalesce(original_patient_id, patient_id),
           patient_id = null, status = 'cancelled',
           cancelled_at = now(), cancellation_reason = 'rebooked_via_agent',
           updated_at = now()
     where id = v_vacated;
  end if;

  update public.slots
     set patient_id = v_patient, status = 'booked', booked_at = now(), updated_at = now()
   where id = p_slot_id;

  update public.conversations
     set offered_slot_ids = null, status = 'resolved', resolved_at = now(),
         resolution_outcome = 'rebooked', updated_at = now()
   where id = p_conversation_id;

  return json_build_object(
    'status','booked', 'slot_id', p_slot_id,
    'start_time', v_slot.start_time, 'doctor_name', v_slot.doctor_name,
    'vacated_slot_id', v_vacated
  );
end;
$$;

-- --------------------------------------------------------------------------
create or replace function public.booking_offer_clear(p_conversation_id uuid)
returns void
language sql security definer set search_path to 'public','pg_temp'
as $$
  update public.conversations set offered_slot_ids = null, updated_at = now()
   where id = p_conversation_id;
$$;

-- --------------------------------------------------------------------------
-- Extend agent_context with the pending booking options so WF-A can (a) detect
-- that a reply is a booking choice and (b) match it to a concrete slot.
create or replace function public.agent_context(p_conversation_id uuid)
returns json
language sql security definer set search_path to 'public','pg_temp'
as $$
  select json_build_object(
    'conversation_id', c.id,
    'status', c.status,
    'conversation_type', c.conversation_type,
    'clinic_name', cl.name,
    'clinic_slug', cl.slug,
    'patient', json_build_object(
      'name', p.name, 'phone', p.phone, 'is_active', p.is_active
    ),
    'related_slot', case when s.id is not null then json_build_object(
      'id', s.id, 'start_time', s.start_time, 'end_time', s.end_time,
      'status', s.status, 'doctor_name', s.doctor_name
    ) else null end,
    'offered_slot_ids', c.offered_slot_ids,
    'offered_slots', coalesce((
      select json_agg(json_build_object(
        'slot_id', s2.id, 'start_time', s2.start_time, 'doctor_name', s2.doctor_name
      ) order by s2.start_time)
      from public.slots s2 where s2.id = any(c.offered_slot_ids)
    ), '[]'::json),
    'message_count', c.message_count,
    'messages', coalesce((
      select json_agg(json_build_object(
        'id', m.id, 'sender_type', m.sender_type, 'body', m.body, 'sent_at', m.sent_at
      ) order by m.sent_at)
      from public.messages m where m.conversation_id = c.id
    ), '[]'::json)
  )
  from public.conversations c
  join public.patients p on p.id = c.patient_id
  join public.clinics  cl on cl.id = c.clinic_id
  left join public.slots s on s.id = c.related_slot_id
  where c.id = p_conversation_id;
$$;

-- Grants: service_role only (n8n uses the service_role key), mirroring migration 008.
revoke all on function public.find_availability(uuid,int)   from public;
revoke all on function public.book_slot(uuid,uuid)          from public;
revoke all on function public.booking_offer_clear(uuid)     from public;
grant execute on function public.find_availability(uuid,int) to service_role;
grant execute on function public.book_slot(uuid,uuid)        to service_role;
grant execute on function public.booking_offer_clear(uuid)   to service_role;
