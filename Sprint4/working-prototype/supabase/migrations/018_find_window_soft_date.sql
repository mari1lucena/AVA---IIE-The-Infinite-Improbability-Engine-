-- 018: make find_availability_window's date a SOFT preference, not a hard filter.
--
-- When the patient asks for a time ("às 16h") in a follow-up that doesn't repeat
-- the day, the 8B can guess the wrong date and the hard date filter then returns
-- nothing -> the agent escalates even though a 16:00 slot exists on another day.
-- Now the requested day is only a ranking preference: slots at the requested TIME
-- on the requested day rank first, but the same time on the next available day
-- still surfaces. Time window stays a hard filter (the patient's actual ask).

create or replace function public.find_availability_window(
  p_conversation_id uuid,
  p_date date default null,   -- Lisbon-local date, preferred (soft) — null = no preference
  p_from time default null,   -- Lisbon-local lower bound (inclusive) — hard filter
  p_to   time default null,   -- Lisbon-local upper bound (inclusive) — hard filter
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

  -- A single point time ("15h": from=15:00, to=null) becomes a +/- 90 min window.
  if v_from is not null and v_to is null then
    v_to   := least(v_from + interval '90 minutes', time '23:59')::time;
    v_from := case when v_from > time '01:30'
                   then (v_from - interval '90 minutes')::time
                   else time '00:00' end;
  end if;

  select coalesce(json_agg(x order by x.pref, x.start_time), '[]'::json),
         array_agg(x.slot_id order by x.pref, x.start_time)
    into v_slots, v_ids
  from (
    select s.id as slot_id, s.start_time, s.end_time, s.doctor_name,
           case when p_date is not null
                     and (s.start_time at time zone 'Europe/Lisbon')::date = p_date
                then 0 else 1 end as pref
    from public.slots s
    where s.clinic_id = v_clinic
      and s.status = 'available'
      and s.start_time >  now() + interval '2 hours'
      and s.start_time <= now() + interval '21 days'
      and (v_from is null or (s.start_time at time zone 'Europe/Lisbon')::time >= v_from)
      and (v_to   is null or (s.start_time at time zone 'Europe/Lisbon')::time <= v_to)
    order by pref, s.start_time
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

revoke all on function public.find_availability_window(uuid,date,time,time,int) from public;
grant execute on function public.find_availability_window(uuid,date,time,time,int) to service_role;
