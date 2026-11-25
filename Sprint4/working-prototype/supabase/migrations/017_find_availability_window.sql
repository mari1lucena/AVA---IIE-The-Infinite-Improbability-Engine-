-- 017: targeted availability search for an off-list time request.
--
-- When the agent offers the next 3 open slots and the patient asks for a time
-- that wasn't offered ("pode ser às 15h?", "tem algo quinta de manhã?"),
-- WF-A's Route match now emits action='retime' with the requested Lisbon-local
-- date/time window. This RPC searches available slots inside that window and,
-- like find_availability, stamps conversations.offered_slot_ids with the matches
-- so a "sim" confirms one. Empty result -> WF-A tells the patient honestly and
-- escalates to a human (booking_request).
--
-- All filtering is done in Europe/Lisbon local time (slots.start_time is UTC),
-- so the LLM only ever deals in the local times the patient actually stated.

create or replace function public.find_availability_window(
  p_conversation_id uuid,
  p_date date default null,   -- Lisbon-local date, null = any day within horizon
  p_from time default null,   -- Lisbon-local lower bound (inclusive)
  p_to   time default null,   -- Lisbon-local upper bound (inclusive)
  p_limit int default 3
) returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  v_clinic uuid;
  v_from time := p_from;
  v_to   time := p_to;
  v_slots json;
  v_ids   uuid[];
begin
  select clinic_id into v_clinic from public.conversations where id = p_conversation_id;
  if v_clinic is null then
    return json_build_object('status','error','reason','conversation_not_found');
  end if;

  -- A single point time (e.g. "15h": from=15:00, to=null) becomes a +/- 90 min
  -- window so a 15:30 slot still counts as "around 15h". Clinic hours are daytime,
  -- so the guarded arithmetic below never needs to wrap past midnight.
  if v_from is not null and v_to is null then
    v_to   := least(v_from + interval '90 minutes', time '23:59')::time;
    v_from := case when v_from > time '01:30'
                   then (v_from - interval '90 minutes')::time
                   else time '00:00' end;
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
      and (p_date is null or (s.start_time at time zone 'Europe/Lisbon')::date = p_date)
      and (v_from  is null or (s.start_time at time zone 'Europe/Lisbon')::time >= v_from)
      and (v_to    is null or (s.start_time at time zone 'Europe/Lisbon')::time <= v_to)
    order by s.start_time
    limit greatest(p_limit, 1)
  ) x;

  -- Overwrite the pending offer with the matches (or clear it when none), so the
  -- next reply routes cleanly (a "sim" confirms; an escalation won't re-loop).
  update public.conversations
     set offered_slot_ids = nullif(v_ids, '{}'), updated_at = now()
   where id = p_conversation_id;

  if v_ids is null or array_length(v_ids, 1) is null then
    return json_build_object('status','none');
  end if;
  return json_build_object('status','options','slots', v_slots);
end;
$$;

revoke all on function public.find_availability_window(uuid,date,time,time,int) from public;
grant execute on function public.find_availability_window(uuid,date,time,time,int) to service_role;
