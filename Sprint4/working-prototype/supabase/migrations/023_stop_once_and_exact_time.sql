-- 023a: append the RGPD opt-out line only on the FIRST agent message of a
-- conversation (and never on a message that already mentions STOP/START, e.g. an
-- opt-out confirmation). Stops "Responda STOP" repeating every message.
create or replace function public.agent_send_message(p_conversation_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_id uuid;
  v_body text;
  v_has_prior boolean;
begin
  if p_body is null or btrim(p_body) = '' then
    raise exception 'empty_body';
  end if;
  v_body := btrim(p_body);

  select exists(
    select 1 from public.messages m
     where m.conversation_id = p_conversation_id and m.sender_type = 'agent'
  ) into v_has_prior;

  if not v_has_prior and v_body !~* '\ystop\y' and v_body !~* '\ystart\y' then
    v_body := v_body || ' Responda STOP para não receber mais mensagens.';
  end if;

  insert into public.messages (conversation_id, sender_type, body, channel)
  values (p_conversation_id, 'agent', v_body, 'mock')
  returning id into v_id;

  update public.conversations
     set message_count = coalesce(message_count, 0) + 1,
         last_message_at = now(), updated_at = now()
   where id = p_conversation_id;
  return v_id;
end;
$function$;

-- 023b: a POINT time request ("às 17h") returns a SINGLE vaga — the exact time if
-- free, otherwise the closest — plus `requested` (HH:MM) and `exact` (bool).
-- Day/period searches keep the spread-across-day behaviour from migration 022.
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
  v_exact  boolean;
begin
  select clinic_id into v_clinic from public.conversations where id = p_conversation_id;
  if v_clinic is null then return json_build_object('status','error','reason','conversation_not_found'); end if;

  if v_from is not null and v_to is null then
    v_to   := least(v_from + interval '90 minutes', time '23:59')::time;
    v_from := case when v_from > time '01:30' then (v_from - interval '90 minutes')::time else time '00:00' end;
  end if;

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
    with avail as (
      select s.id as slot_id, s.start_time, s.doctor_name,
             (s.start_time at time zone 'Europe/Lisbon')::time as lt,
             row_number() over (partition by s.start_time order by s.doctor_name) as doc_rank
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
      select a.slot_id, a.start_time, a.doctor_name, a.lt
      from sel join avail a on a.start_time = sel.start_time and a.doc_rank = 1
      where sel.idx = 1
    )
    select coalesce(json_agg(json_build_object('slot_id',slot_id,'start_time',start_time,'doctor_name',doctor_name)), '[]'::json),
           array_agg(slot_id), bool_or(lt = v_center)
      into v_slots, v_ids, v_exact from final;

    update public.conversations set offered_slot_ids = nullif(v_ids,'{}'), updated_at = now()
     where id = p_conversation_id;
    if v_ids is null or array_length(v_ids,1) is null then return json_build_object('status','none'); end if;
    return json_build_object('status','options','slots', v_slots,
                             'requested', to_char(v_center,'HH24:MI'), 'exact', coalesce(v_exact,false));
  else
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
    prim as (select distinct on (bucket) start_time, lt from times order by bucket, lt),
    rest as (
      select t.start_time, t.lt,
             (select min(abs(extract(epoch from (t.lt - p.lt)))) from prim p) as mind
      from times t where t.start_time not in (select start_time from prim)
    ),
    fill as (
      select start_time, lt from rest order by mind desc nulls last, lt
      limit greatest(greatest(p_limit,1) - (select count(*) from prim), 0)
    ),
    chosen as (select start_time, lt from prim union all select start_time, lt from fill),
    sel as (select start_time, lt, row_number() over (order by lt) as idx from chosen),
    final as (
      select sel.idx, a.slot_id, a.start_time, a.doctor_name
      from sel join avail a on a.start_time = sel.start_time and a.doc_rank = ((sel.idx - 1) % a.doc_count) + 1
      where sel.idx <= greatest(p_limit,1)
    )
    select coalesce(json_agg(json_build_object('slot_id',slot_id,'start_time',start_time,'doctor_name',doctor_name) order by idx), '[]'::json),
           array_agg(slot_id order by idx)
      into v_slots, v_ids from final;

    update public.conversations set offered_slot_ids = nullif(v_ids,'{}'), updated_at = now()
     where id = p_conversation_id;
    if v_ids is null or array_length(v_ids,1) is null then return json_build_object('status','none'); end if;
    return json_build_object('status','options','slots', v_slots);
  end if;
end $$;

revoke all on function public.find_availability_window(uuid,date,time,time,int) from public;
grant execute on function public.find_availability_window(uuid,date,time,time,int) to service_role;
