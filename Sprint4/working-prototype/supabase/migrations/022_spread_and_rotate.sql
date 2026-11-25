-- 022: spread the offered times across the day + rotate doctors.
--
-- Instead of 3 successive times all with the same doctor, offers now show one
-- vaga per PART of the day — manhã (<13:00), depois de almoço (13:00–16:00),
-- tarde (>=16:00) — picking the earliest in each part. If a part has no vaga
-- (e.g. an "à tarde" search), the gap is filled with the most-spaced remaining
-- time so the options always have distance between them. Doctors are rotated
-- across the chosen times (idx 1→1st doctor, idx 2→2nd, …) so the 3 clinicians
-- appear varied instead of always the alphabetically-first one.
--
-- A point request ("por volta das 16h") keeps proximity ordering (closest to the
-- asked hour), also with doctor rotation. Everything is scoped to a single target
-- day: the requested day if it has vagas in-window, otherwise the soonest day.

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
  v_target date;
  v_slots  json;
  v_ids    uuid[];
begin
  select clinic_id into v_clinic from public.conversations where id = p_conversation_id;
  if v_clinic is null then return json_build_object('status','error','reason','conversation_not_found'); end if;

  -- point time -> +/- 90 min window (v_center keeps the exact ask for ranking)
  if v_from is not null and v_to is null then
    v_to   := least(v_from + interval '90 minutes', time '23:59')::time;
    v_from := case when v_from > time '01:30' then (v_from - interval '90 minutes')::time else time '00:00' end;
  end if;

  -- Target day: preferred day if it has candidates in-window, else the soonest.
  select ld into v_target from (
    select (s.start_time at time zone 'Europe/Lisbon')::date as ld, min(s.start_time) as ms
    from public.slots s
    where s.clinic_id = v_clinic and s.status = 'available'
      and s.start_time >  now() + interval '2 hours'
      and s.start_time <= now() + interval '21 days'
      and (v_from is null or (s.start_time at time zone 'Europe/Lisbon')::time >= v_from)
      and (v_to   is null or (s.start_time at time zone 'Europe/Lisbon')::time <= v_to)
    group by 1
  ) d
  order by (case when p_date is not null and d.ld = p_date then 0 else 1 end), d.ms
  limit 1;

  if v_target is null then
    update public.conversations set offered_slot_ids = null, updated_at = now() where id = p_conversation_id;
    return json_build_object('status','none');
  end if;

  if v_center is not null then
    -- POINT: distinct times closest to the requested hour, doctors rotated.
    with avail as (
      select s.id as slot_id, s.start_time, s.doctor_name,
             (s.start_time at time zone 'Europe/Lisbon')::time as lt,
             row_number() over (partition by s.start_time order by s.doctor_name) as doc_rank,
             count(*)     over (partition by s.start_time) as doc_count
      from public.slots s
      where s.clinic_id = v_clinic and s.status = 'available'
        and (s.start_time at time zone 'Europe/Lisbon')::date = v_target
        and s.start_time > now() + interval '2 hours'
        and (v_from is null or (s.start_time at time zone 'Europe/Lisbon')::time >= v_from)
        and (v_to   is null or (s.start_time at time zone 'Europe/Lisbon')::time <= v_to)
    ),
    times as (select distinct start_time, lt from avail),
    sel as (
      select start_time, lt,
             row_number() over (order by abs(extract(epoch from (lt - v_center))), start_time) as idx
      from times
    ),
    final as (
      select sel.idx, a.slot_id, a.start_time, a.doctor_name
      from sel
      join avail a on a.start_time = sel.start_time and a.doc_rank = ((sel.idx - 1) % a.doc_count) + 1
      where sel.idx <= greatest(p_limit,1)
    )
    select coalesce(json_agg(json_build_object('slot_id',slot_id,'start_time',start_time,'doctor_name',doctor_name) order by idx), '[]'::json),
           array_agg(slot_id order by idx)
      into v_slots, v_ids from final;
  else
    -- DAY / PERIOD: one per part of day, gaps filled by max spacing, doctors rotated.
    with avail as (
      select s.id as slot_id, s.start_time, s.doctor_name,
             (s.start_time at time zone 'Europe/Lisbon')::time as lt,
             row_number() over (partition by s.start_time order by s.doctor_name) as doc_rank,
             count(*)     over (partition by s.start_time) as doc_count
      from public.slots s
      where s.clinic_id = v_clinic and s.status = 'available'
        and (s.start_time at time zone 'Europe/Lisbon')::date = v_target
        and s.start_time > now() + interval '2 hours'
        and (v_from is null or (s.start_time at time zone 'Europe/Lisbon')::time >= v_from)
        and (v_to   is null or (s.start_time at time zone 'Europe/Lisbon')::time <= v_to)
    ),
    times as (
      select start_time, lt,
             case when lt < time '13:00' then 1 when lt < time '16:00' then 2 else 3 end as bucket
      from (select distinct start_time, lt from avail) d
    ),
    prim as (
      select distinct on (bucket) start_time, lt from times order by bucket, lt
    ),
    rest as (
      select t.start_time, t.lt,
             (select min(abs(extract(epoch from (t.lt - p.lt)))) from prim p) as mind
      from times t
      where t.start_time not in (select start_time from prim)
    ),
    fill as (
      select start_time, lt from rest
      order by mind desc nulls last, lt
      limit greatest(greatest(p_limit,1) - (select count(*) from prim), 0)
    ),
    chosen as (
      select start_time, lt from prim
      union all
      select start_time, lt from fill
    ),
    sel as (
      select start_time, lt, row_number() over (order by lt) as idx from chosen
    ),
    final as (
      select sel.idx, a.slot_id, a.start_time, a.doctor_name
      from sel
      join avail a on a.start_time = sel.start_time and a.doc_rank = ((sel.idx - 1) % a.doc_count) + 1
      where sel.idx <= greatest(p_limit,1)
    )
    select coalesce(json_agg(json_build_object('slot_id',slot_id,'start_time',start_time,'doctor_name',doctor_name) order by idx), '[]'::json),
           array_agg(slot_id order by idx)
      into v_slots, v_ids from final;
  end if;

  update public.conversations set offered_slot_ids = nullif(v_ids,'{}'), updated_at = now()
   where id = p_conversation_id;
  if v_ids is null or array_length(v_ids,1) is null then return json_build_object('status','none'); end if;
  return json_build_object('status','options','slots', v_slots);
end $$;

revoke all on function public.find_availability_window(uuid,date,time,time,int) from public;
grant execute on function public.find_availability_window(uuid,date,time,time,int) to service_role;
