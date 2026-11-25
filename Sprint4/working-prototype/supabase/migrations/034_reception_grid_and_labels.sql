-- 034_reception_grid_and_labels.sql
-- Two corrections to the reception command box (033):
--
-- (1) GRID-RESPECTING BOOKINGS. Previously an exact time with no matching slot
--     (e.g. "15:00" when the clinic grid only offers 15:15 / 15:45) created an
--     off-grid slot. Wrong: reception should book into the clinic's REAL agenda.
--     Now reception_target_status never returns a "create" instruction — an
--     exact free slot books; otherwise it returns the nearest available slots.
--     Single ops offer them for the receptionist to pick (UI chips → re-plan);
--     recurring auto-snaps each occurrence to the nearest available slot that
--     day. reception_apply only ever fills an existing `available` slot.
--
-- (2) WEEKDAY IN NOTIFICATIONS. The patient SMS now names the day of the week
--     ("quarta-feira, 09/09/2026 às 16:00"), not just the date, via the new
--     reception_lisbon_label helper. Plan actions carry to_label / from_label.

-- PT weekday + date + time label.
create or replace function public.reception_lisbon_label(p_ts timestamptz)
returns text
language sql
stable
as $$
  select (array['segunda-feira','terça-feira','quarta-feira','quinta-feira',
                 'sexta-feira','sábado','domingo'])
           [extract(isodow from (p_ts at time zone 'Europe/Lisbon'))::int]
       || ', ' || to_char(p_ts at time zone 'Europe/Lisbon','DD/MM/YYYY')
       || ' às ' || to_char(p_ts at time zone 'Europe/Lisbon','HH24:MI');
$$;

-- Resolve a requested time against the real agenda grid (no off-grid creation).
--   exact available slot       -> {status:'ok', slot_id, exact:true, to_lisbon, to_label}
--   p_snap + nearest available -> {status:'ok', slot_id, exact:false, to_lisbon, to_label}
--   otherwise (interactive)    -> {status:'no_slot', alternatives:[{slot_id,time,to_lisbon}]}
--   nothing available that day -> {status:'no_slot', alternatives:[]}
drop function if exists public.reception_target_status(uuid, uuid, timestamptz, uuid);
create or replace function public.reception_target_status(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_start timestamptz,
  p_exclude_patient uuid default null,
  p_snap boolean default false
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id    uuid;
  v_start timestamptz;
  v_alts  jsonb;
begin
  select id, start_time into v_id, v_start
    from public.slots
   where clinic_id = p_clinic_id
     and status = 'available'
     and start_time = p_start
     and (p_doctor_id is null or doctor_id = p_doctor_id)
   order by (doctor_id = p_doctor_id) desc
   limit 1;
  if v_id is not null then
    return jsonb_build_object('status','ok','slot_id',v_id,'exact',true,
      'to_lisbon', to_char(v_start at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI'),
      'to_label', public.reception_lisbon_label(v_start));
  end if;

  if p_snap then
    select id, start_time into v_id, v_start
      from public.slots
     where clinic_id = p_clinic_id and status = 'available'
       and (p_doctor_id is null or doctor_id = p_doctor_id)
       and (start_time at time zone 'Europe/Lisbon')::date
           = (p_start at time zone 'Europe/Lisbon')::date
       and start_time > now()
     order by abs(extract(epoch from (start_time - p_start))) asc
     limit 1;
    if v_id is null then
      return jsonb_build_object('status','no_slot','alternatives','[]'::jsonb);
    end if;
    return jsonb_build_object('status','ok','slot_id',v_id,'exact',false,
      'to_lisbon', to_char(v_start at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI'),
      'to_label', public.reception_lisbon_label(v_start));
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('slot_id', slot_id, 'time', t, 'to_lisbon', tl)
              order by dist),
    '[]'::jsonb)
    into v_alts
    from (
      select id as slot_id,
             to_char(start_time at time zone 'Europe/Lisbon','HH24:MI') as t,
             to_char(start_time at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI') as tl,
             abs(extract(epoch from (start_time - p_start))) as dist
        from public.slots
       where clinic_id = p_clinic_id and status = 'available'
         and (p_doctor_id is null or doctor_id = p_doctor_id)
         and (start_time at time zone 'Europe/Lisbon')::date
             = (p_start at time zone 'Europe/Lisbon')::date
         and start_time > now()
       order by dist asc
       limit 3
    ) s;
  return jsonb_build_object('status','no_slot','alternatives', v_alts);
end;
$$;

revoke all on function public.reception_lisbon_label(timestamptz) from public, anon, authenticated;
revoke all on function public.reception_target_status(uuid, uuid, timestamptz, uuid, boolean) from public, anon, authenticated;

create or replace function public.reception_plan(
  p_clinic_id uuid,
  p_command jsonb,
  p_patient_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_op        text := lower(coalesce(p_command->>'op',''));
  v_name      text := p_command->>'patient_name';
  v_doc_q     text := nullif(trim(coalesce(p_command->>'doctor_name','')), '');
  v_date      text := nullif(p_command->>'date','');
  v_time      text := nullif(p_command->>'time','');
  v_patient   uuid := p_patient_id;
  v_pname     text;
  v_opted     boolean;
  v_primary   uuid;
  v_cands     jsonb;
  v_ncands    int;
  v_doc_id    uuid;
  v_doc_name  text;
  v_doc_auto  boolean := false;
  v_cur_slot  public.slots%rowtype;
  v_start     timestamptz;
  v_tgt       jsonb;
  v_ok        boolean;
  v_actions   jsonb := '[]'::jsonb;
  v_ok_n      int := 0;
  v_conf_n    int := 0;
  v_rec       jsonb;
  v_d         date;
  v_wd        int;
begin
  if v_op not in ('reschedule','book','cancel','recurring') then
    return jsonb_build_object('ok', false, 'problem', 'unknown_op', 'op', v_op);
  end if;

  if v_patient is null then
    if coalesce(v_name,'') = '' then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'no_patient_name');
    end if;
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'phone', phone) order by name),
           count(*)
      into v_cands, v_ncands
      from public.patients
     where clinic_id = p_clinic_id and is_active
       and public.reception_norm(name) like '%' || public.reception_norm(v_name) || '%';
    if coalesce(v_ncands,0) = 0 then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'patient_not_found', 'query', v_name);
    elsif v_ncands > 1 then
      select id into v_patient from public.patients
       where clinic_id = p_clinic_id and is_active
         and public.reception_norm(name) = public.reception_norm(v_name)
       limit 1;
      if v_patient is null then
        return jsonb_build_object('ok', false, 'op', v_op,
          'problem', 'ambiguous_patient', 'query', v_name, 'candidates', v_cands);
      end if;
    else
      v_patient := (v_cands->0->>'id')::uuid;
    end if;
  end if;

  select name, opted_out, primary_doctor_id
    into v_pname, v_opted, v_primary
    from public.patients where id = v_patient and clinic_id = p_clinic_id;
  if v_pname is null then
    return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'patient_not_found');
  end if;

  if v_doc_q is not null then
    select id, name into v_doc_id, v_doc_name
      from public.doctors
     where clinic_id = p_clinic_id and is_active
       and public.reception_norm(name) like '%' || public.reception_norm(v_doc_q) || '%'
     order by name limit 1;
    if v_doc_id is null then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'doctor_not_found', 'query', v_doc_q);
    end if;
  end if;

  select * into v_cur_slot
    from public.slots
   where clinic_id = p_clinic_id and patient_id = v_patient
     and status in ('booked','confirmed','pending_confirmation','offered')
     and start_time > now()
   order by start_time limit 1;

  if v_op = 'cancel' then
    if v_cur_slot.id is null then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'no_current_appt',
        'patient', jsonb_build_object('id', v_patient, 'name', v_pname));
    end if;
    v_actions := jsonb_build_array(jsonb_build_object(
      'kind', 'cancel', 'status', 'ok',
      'patient_id', v_patient,
      'vacate_slot_id', v_cur_slot.id,
      'from_lisbon', to_char(v_cur_slot.start_time at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI'),
      'from_label', public.reception_lisbon_label(v_cur_slot.start_time),
      'doctor_name', v_cur_slot.doctor_name
    ));
    v_ok_n := 1;

  elsif v_op = 'reschedule' then
    if v_date is null or v_time is null then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'missing_datetime',
        'patient', jsonb_build_object('id', v_patient, 'name', v_pname));
    end if;
    if v_cur_slot.id is null then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'no_current_appt',
        'patient', jsonb_build_object('id', v_patient, 'name', v_pname));
    end if;
    if v_doc_id is null then
      v_doc_id := v_cur_slot.doctor_id;
      v_doc_name := v_cur_slot.doctor_name;
    end if;
    v_start := (v_date || ' ' || v_time)::timestamp at time zone 'Europe/Lisbon';
    if v_start <= now() then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'target_in_past',
        'patient', jsonb_build_object('id', v_patient, 'name', v_pname));
    end if;
    v_tgt := public.reception_target_status(p_clinic_id, v_doc_id, v_start, v_patient, false);
    v_ok := (v_tgt->>'status') = 'ok';
    v_actions := jsonb_build_array(jsonb_build_object(
      'kind', 'reschedule',
      'status', v_tgt->>'status',
      'patient_id', v_patient,
      'doctor_id', v_doc_id,
      'doctor_name', v_doc_name,
      'to_lisbon', coalesce(v_tgt->>'to_lisbon', to_char(v_start at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI')),
      'to_label', coalesce(v_tgt->>'to_label', public.reception_lisbon_label(v_start)),
      'from_lisbon', to_char(v_cur_slot.start_time at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI'),
      'from_label', public.reception_lisbon_label(v_cur_slot.start_time),
      'target_slot_id', v_tgt->>'slot_id',
      'vacate_slot_id', v_cur_slot.id,
      'alternatives', coalesce(v_tgt->'alternatives','[]'::jsonb)
    ));
    if v_ok then v_ok_n := 1; else v_conf_n := 1; end if;

  elsif v_op = 'book' then
    if v_date is null or v_time is null then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'missing_datetime',
        'patient', jsonb_build_object('id', v_patient, 'name', v_pname));
    end if;
    if v_doc_id is null then
      v_doc_id := v_primary;
      if v_doc_id is not null then
        select name into v_doc_name from public.doctors where id = v_doc_id;
      else
        select id, name into v_doc_id, v_doc_name from public.doctors
         where clinic_id = p_clinic_id and is_active order by name limit 1;
        v_doc_auto := true;
      end if;
    end if;
    v_start := (v_date || ' ' || v_time)::timestamp at time zone 'Europe/Lisbon';
    if v_start <= now() then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'target_in_past',
        'patient', jsonb_build_object('id', v_patient, 'name', v_pname));
    end if;
    v_tgt := public.reception_target_status(p_clinic_id, v_doc_id, v_start, v_patient, false);
    v_ok := (v_tgt->>'status') = 'ok';
    v_actions := jsonb_build_array(jsonb_build_object(
      'kind', 'book',
      'status', v_tgt->>'status',
      'patient_id', v_patient,
      'doctor_id', v_doc_id,
      'doctor_name', v_doc_name,
      'doctor_auto', v_doc_auto,
      'to_lisbon', coalesce(v_tgt->>'to_lisbon', to_char(v_start at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI')),
      'to_label', coalesce(v_tgt->>'to_label', public.reception_lisbon_label(v_start)),
      'target_slot_id', v_tgt->>'slot_id',
      'alternatives', coalesce(v_tgt->'alternatives','[]'::jsonb)
    ));
    if v_ok then v_ok_n := 1; else v_conf_n := 1; end if;

  elsif v_op = 'recurring' then
    v_rec := p_command->'recurrence';
    if v_rec is null or v_rec->>'time' is null or v_rec->>'start_date' is null
       or v_rec->>'end_date' is null or v_rec->>'weekday' is null then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'incomplete_recurrence',
        'patient', jsonb_build_object('id', v_patient, 'name', v_pname));
    end if;
    v_wd := (v_rec->>'weekday')::int;
    v_time := v_rec->>'time';
    if v_doc_id is null then
      v_doc_id := v_primary;
      if v_doc_id is not null then
        select name into v_doc_name from public.doctors where id = v_doc_id;
      else
        select id, name into v_doc_id, v_doc_name from public.doctors
         where clinic_id = p_clinic_id and is_active order by name limit 1;
        v_doc_auto := true;
      end if;
    end if;
    for v_d in
      select d::date from generate_series(
               (v_rec->>'start_date')::date,
               (v_rec->>'end_date')::date,
               interval '1 day') g(d)
       where extract(isodow from d) = v_wd
       order by d
       limit 26
    loop
      v_start := (v_d::text || ' ' || v_time)::timestamp at time zone 'Europe/Lisbon';
      if v_start <= now() then continue; end if;
      v_tgt := public.reception_target_status(p_clinic_id, v_doc_id, v_start, v_patient, true);
      v_ok := (v_tgt->>'status') = 'ok';
      v_actions := v_actions || jsonb_build_object(
        'kind', 'book',
        'status', v_tgt->>'status',
        'patient_id', v_patient,
        'doctor_id', v_doc_id,
        'doctor_name', v_doc_name,
        'doctor_auto', v_doc_auto,
        'to_lisbon', coalesce(v_tgt->>'to_lisbon', to_char(v_start at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI')),
        'to_label', coalesce(v_tgt->>'to_label', public.reception_lisbon_label(v_start)),
        'target_slot_id', v_tgt->>'slot_id'
      );
      if v_ok then v_ok_n := v_ok_n + 1; else v_conf_n := v_conf_n + 1; end if;
    end loop;
    if jsonb_array_length(v_actions) = 0 then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'no_dates',
        'patient', jsonb_build_object('id', v_patient, 'name', v_pname));
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'op', v_op,
    'patient', jsonb_build_object('id', v_patient, 'name', v_pname, 'opted_out', v_opted),
    'doctor', case when v_doc_id is not null
                   then jsonb_build_object('id', v_doc_id, 'name', v_doc_name, 'auto', v_doc_auto)
                   else null end,
    'actions', v_actions,
    'applicable', v_ok_n,
    'conflicts', v_conf_n
  );
end;
$$;

revoke all on function public.reception_plan(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.reception_plan(uuid, jsonb, uuid) to service_role;

create or replace function public.reception_apply(
  p_clinic_id uuid,
  p_plan jsonb,
  p_notify boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_a         jsonb;
  v_kind      text;
  v_patient   uuid;
  v_doc_id    uuid;
  v_tgt_id    uuid;
  v_vac_id    uuid;
  v_slot      public.slots%rowtype;
  v_results   jsonb := '[]'::jsonb;
  v_applied   int := 0;
  v_notified  boolean := false;
  v_opted     boolean;
  v_pname     text;
  v_conv      uuid;
  v_last      jsonb;
  v_body      text;
begin
  for v_a in select * from jsonb_array_elements(coalesce(p_plan->'actions','[]'::jsonb))
  loop
    if v_a->>'status' <> 'ok' then
      v_results := v_results || jsonb_build_object('to_lisbon', v_a->>'to_lisbon',
        'from_lisbon', v_a->>'from_lisbon', 'outcome', 'skipped', 'reason', v_a->>'status');
      continue;
    end if;

    v_kind   := v_a->>'kind';
    v_patient:= (v_a->>'patient_id')::uuid;
    v_doc_id := nullif(v_a->>'doctor_id','')::uuid;
    v_tgt_id := nullif(v_a->>'target_slot_id','')::uuid;
    v_vac_id := nullif(v_a->>'vacate_slot_id','')::uuid;

    -- Vacate the patient's current slot (reschedule/cancel) -> reopen available.
    if v_vac_id is not null then
      select * into v_slot from public.slots where id = v_vac_id for update;
      if found and v_slot.clinic_id = p_clinic_id and v_slot.patient_id = v_patient
         and v_slot.status in ('booked','confirmed','pending_confirmation','offered') then
        update public.slots
           set patient_id = null, status = 'available',
               booked_at = null, confirmed_at = null,
               original_patient_id = coalesce(original_patient_id, patient_id),
               cancellation_reason = 'reception_' || v_kind, updated_at = now()
         where id = v_vac_id;
      end if;
    end if;

    if v_kind = 'cancel' then
      v_applied := v_applied + 1;
      v_last := v_a;
      v_results := v_results || jsonb_build_object('from_lisbon', v_a->>'from_lisbon',
        'outcome', 'cancelled');
      continue;
    end if;

    -- book / reschedule: fill the resolved available slot (re-validate). Never
    -- creates a new slot — an 'ok' action always carries a real target_slot_id.
    if v_tgt_id is null then
      v_results := v_results || jsonb_build_object('to_lisbon', v_a->>'to_lisbon',
        'outcome', 'skipped', 'reason', 'no_slot');
      continue;
    end if;
    select * into v_slot from public.slots where id = v_tgt_id for update;
    if not found or v_slot.clinic_id <> p_clinic_id or v_slot.status <> 'available' then
      v_results := v_results || jsonb_build_object('to_lisbon', v_a->>'to_lisbon',
        'outcome', 'skipped', 'reason', 'taken');
      continue;
    end if;
    update public.slots
       set patient_id = v_patient, status = 'booked', booked_at = now(),
           cancellation_reason = null, cancelled_at = null, updated_at = now()
     where id = v_tgt_id;

    if v_doc_id is not null then
      update public.patients
         set primary_doctor_id = coalesce(primary_doctor_id, v_doc_id), updated_at = now()
       where id = v_patient;
    end if;

    v_applied := v_applied + 1;
    v_last := v_a;
    v_results := v_results || jsonb_build_object('to_lisbon', v_a->>'to_lisbon',
      'to_label', v_a->>'to_label', 'from_lisbon', v_a->>'from_lisbon',
      'outcome', 'applied', 'slot_id', v_tgt_id);
  end loop;

  if p_notify and v_last is not null then
    v_patient := (v_last->>'patient_id')::uuid;
    select name, opted_out into v_pname, v_opted from public.patients where id = v_patient;
    if not coalesce(v_opted, false) then
      v_body := case
        when v_applied = 0 then null
        when v_last->>'kind' = 'cancel' then
          'Olá ' || v_pname || ', a sua consulta de ' || (v_last->>'from_label')
          || ' foi cancelada. Se quiser remarcar, é só dizer.'
        when v_last->>'kind' = 'reschedule' then
          'Olá ' || v_pname || ', a sua consulta foi remarcada para ' || (v_last->>'to_label')
          || coalesce(' com ' || (v_last->>'doctor_name'), '') || '.'
        when (p_plan->>'op') = 'recurring' then
          'Olá ' || v_pname || ', ficaram marcadas ' || v_applied
          || ' consultas' || coalesce(' com ' || (v_last->>'doctor_name'), '')
          || '. A primeira é ' || (
             select x->>'to_label' from jsonb_array_elements(v_results) x
              where x->>'outcome' = 'applied' limit 1) || '.'
        else
          'Olá ' || v_pname || ', ficou com consulta marcada para ' || (v_last->>'to_label')
          || coalesce(' com ' || (v_last->>'doctor_name'), '') || '.'
      end;
      if v_body is not null then
        select id into v_conv from public.conversations
         where clinic_id = p_clinic_id and patient_id = v_patient
           and conversation_type = 'general' and status = 'active'
         order by created_at desc limit 1;
        if v_conv is null then
          insert into public.conversations (clinic_id, patient_id, conversation_type, status)
          values (p_clinic_id, v_patient, 'general', 'active')
          returning id into v_conv;
        end if;
        perform public.agent_send_message(v_conv, v_body);
        v_notified := true;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'status', 'applied',
    'applied', v_applied,
    'notified', v_notified,
    'results', v_results
  );
end;
$$;

revoke all on function public.reception_apply(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.reception_apply(uuid, jsonb, boolean) to service_role;
