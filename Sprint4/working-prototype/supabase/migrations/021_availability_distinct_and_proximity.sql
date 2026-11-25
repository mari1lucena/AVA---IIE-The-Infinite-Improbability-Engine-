-- 021: fix multi-doctor availability presentation + off-list time handling.
--
-- With 3 doctors sharing an identical grid, both search RPCs returned "the N
-- earliest slots" = the SAME time once per doctor ("09:00 Sousa, 09:00 Silva,
-- 09:00 Lima") — no real choice of TIME. And a windowed point search ("por volta
-- das 16:00") returned the earliest slots in the widened window (14:45) instead
-- of the ones closest to the requested time.
--
-- Both functions now:
--   * DISTINCT ON (start_time) -> one doctor per time, so offers show a spread of
--     distinct TIMES instead of the same time repeated per doctor.
--   * find_availability_window orders by proximity to the requested point time
--     (when given), after the requested-day preference.

create or replace function public.find_availability(
  p_conversation_id uuid,
  p_limit int default 3
) returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_clinic uuid; v_slots json; v_ids uuid[];
begin
  select clinic_id into v_clinic from public.conversations where id = p_conversation_id;
  if v_clinic is null then return json_build_object('status','error','reason','conversation_not_found'); end if;

  with cand as (
    select distinct on (s.start_time) s.id as slot_id, s.start_time, s.end_time, s.doctor_name
    from public.slots s
    where s.clinic_id = v_clinic and s.status = 'available'
      and s.start_time >  now() + interval '2 hours'
      and s.start_time <= now() + interval '21 days'
    order by s.start_time, s.doctor_name
  ), ranked as (
    select * from cand order by start_time limit greatest(p_limit, 1)
  )
  select coalesce(json_agg(json_build_object('slot_id',slot_id,'start_time',start_time,'end_time',end_time,'doctor_name',doctor_name) order by start_time), '[]'::json),
         array_agg(slot_id order by start_time)
    into v_slots, v_ids from ranked;

  update public.conversations set offered_slot_ids = nullif(v_ids,'{}'), updated_at = now()
   where id = p_conversation_id;
  if v_ids is null or array_length(v_ids,1) is null then return json_build_object('status','none'); end if;
  return json_build_object('status','options','slots', v_slots);
end $$;

create or replace function public.find_availability_window(
  p_conversation_id uuid,
  p_date date default null,
  p_from time default null,
  p_to   time default null,
  p_limit int default 3
) returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  v_clinic uuid;
  v_from   time := p_from;
  v_to     time := p_to;
  v_center time := case when p_from is not null and p_to is null then p_from else null end;
  v_slots  json;
  v_ids    uuid[];
begin
  select clinic_id into v_clinic from public.conversations where id = p_conversation_id;
  if v_clinic is null then return json_build_object('status','error','reason','conversation_not_found'); end if;

  -- Point time ("15h") -> +/- 90 min window (v_center keeps the exact ask for ranking).
  if v_from is not null and v_to is null then
    v_to   := least(v_from + interval '90 minutes', time '23:59')::time;
    v_from := case when v_from > time '01:30' then (v_from - interval '90 minutes')::time else time '00:00' end;
  end if;

  with cand as (
    select distinct on (s.start_time) s.id as slot_id, s.start_time, s.end_time, s.doctor_name
    from public.slots s
    where s.clinic_id = v_clinic and s.status = 'available'
      and s.start_time >  now() + interval '2 hours'
      and s.start_time <= now() + interval '21 days'
      and (v_from is null or (s.start_time at time zone 'Europe/Lisbon')::time >= v_from)
      and (v_to   is null or (s.start_time at time zone 'Europe/Lisbon')::time <= v_to)
    order by s.start_time, s.doctor_name
  ), ranked as (
    select c.*,
      (case when p_date is not null and (c.start_time at time zone 'Europe/Lisbon')::date = p_date then 0 else 1 end) as pref,
      (case when v_center is not null
            then abs(extract(epoch from ((c.start_time at time zone 'Europe/Lisbon')::time - v_center)))
            else 0 end) as dist
    from cand c
    order by pref, dist, c.start_time
    limit greatest(p_limit, 1)
  )
  select coalesce(json_agg(json_build_object('slot_id',slot_id,'start_time',start_time,'end_time',end_time,'doctor_name',doctor_name) order by pref, dist, start_time), '[]'::json),
         array_agg(slot_id order by pref, dist, start_time)
    into v_slots, v_ids from ranked;

  update public.conversations set offered_slot_ids = nullif(v_ids,'{}'), updated_at = now()
   where id = p_conversation_id;
  if v_ids is null or array_length(v_ids,1) is null then return json_build_object('status','none'); end if;
  return json_build_object('status','options','slots', v_slots);
end $$;

revoke all on function public.find_availability(uuid,int) from public;
revoke all on function public.find_availability_window(uuid,date,time,time,int) from public;
grant execute on function public.find_availability(uuid,int) to service_role;
grant execute on function public.find_availability_window(uuid,date,time,time,int) to service_role;
