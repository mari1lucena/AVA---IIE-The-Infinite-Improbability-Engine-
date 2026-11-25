-- 033_reception_command.sql
-- Natural-language reception command box (dashboard).
--
-- A receptionist types a plain instruction ("reschedule António Silva to
-- tomorrow at 12:00", "Pedro Silva every Friday at 14:00 for 2 months",
-- "cancel Ana's appointment"). The LLM parse step (in the Next.js app) turns
-- that into a normalized command JSON; these fat RPCs do everything else,
-- deterministically and SQL-testable:
--
--   reception_plan(clinic, command, patient_id?)  -> read-only. Resolves the
--       patient + doctor + target slot(s), checks conflicts, returns a
--       UI-ready plan with a machine `actions` array. NEVER writes.
--   reception_apply(clinic, plan, notify)         -> re-validates each action
--       (the agenda can change between preview and confirm) and executes it;
--       optionally notifies the patient by SMS via agent_send_message.
--
-- Design decisions (mirroring existing conventions):
--   * A reception-initiated freed slot is REOPENED to `available` (rebookable,
--     no cascade) — the same semantics as the agenda "Cancelar" button
--     (2026-08-30). Patient-initiated cancels still cascade via the agent RPCs.
--     To make reception moves cascade the freed slot instead, set the vacated
--     slot's status to 'cancelled' in reception_apply (one line).
--   * Continuity of care: a booking sets primary_doctor_id when the patient has
--     none; a reschedule keeps the current doctor unless reception names another.
--   * Off-grid times reception explicitly asks for are created (reception owns
--     the agenda); we only block on overlap with an existing real appointment.
--   * Notifications reuse agent_send_message (STOP-once + plumbing) and skip
--     opted-out patients.
--
-- Grants: service_role only (matches migration 026 lockdown). The app calls
-- these through the service client after authenticating the staff member.

-- Notify-on-reception-change setting (default on: user asked to notify, toggleable).
alter table public.clinics
  add column if not exists notify_patient_on_reception_change boolean not null default true;

-- Accent/case-insensitive normalizer for patient/doctor name matching.
-- Dependency-free (no unaccent extension needed).
create or replace function public.reception_norm(p text)
returns text
language sql
immutable
as $$
  select translate(
    lower(coalesce(p, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçñ',
    'aaaaaeeeeiiiiooooouuuucn'
  );
$$;

-- Resolve one target time for a doctor: is there a free grid slot, is it free
-- to create, or does it overlap an existing appointment?
-- Returns {status: 'ok'|'conflict', slot_id: uuid|null, create: bool}.
-- p_exclude_patient ignores that patient's own slots in the overlap check (their
-- current appointment is being vacated in the same command).
create or replace function public.reception_target_status(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_start timestamptz,
  p_exclude_patient uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_end   timestamptz := p_start + interval '30 minutes';
  v_slot  uuid;
begin
  -- An existing AVAILABLE slot at exactly this doctor+time: fill it.
  select id into v_slot
    from public.slots
   where clinic_id = p_clinic_id
     and status = 'available'
     and start_time = p_start
     and (p_doctor_id is null or doctor_id = p_doctor_id)
   order by (doctor_id = p_doctor_id) desc
   limit 1;
  if v_slot is not null then
    return jsonb_build_object('status', 'ok', 'slot_id', v_slot, 'create', false);
  end if;

  -- Any occupied slot for this doctor overlapping [start, start+30min): conflict.
  if p_doctor_id is not null then
    perform 1
      from public.slots
     where clinic_id = p_clinic_id
       and doctor_id = p_doctor_id
       and status in ('booked','confirmed','pending_confirmation','offered','completed')
       and (p_exclude_patient is null or patient_id is distinct from p_exclude_patient)
       and start_time < v_end
       and end_time   > p_start
     limit 1;
    if found then
      return jsonb_build_object('status', 'conflict', 'slot_id', null, 'create', false);
    end if;
  end if;

  -- Free to create an off-grid slot at the requested time.
  return jsonb_build_object('status', 'ok', 'slot_id', null, 'create', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- reception_plan: read-only. Turns a normalized command into a resolved plan.
-- command shape (from the LLM parse step):
--   { op: 'reschedule'|'book'|'cancel'|'recurring',
--     patient_name: text, doctor_name: text|null,
--     date: 'YYYY-MM-DD'|null, time: 'HH:MM'|null,
--     recurrence: { weekday:1..7(ISO), time:'HH:MM',
--                   start_date:'YYYY-MM-DD', end_date:'YYYY-MM-DD' } | null }
-- ---------------------------------------------------------------------------
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

  -- Resolve the patient (unless a specific id was passed for disambiguation).
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
      -- An exact (normalized) match disambiguates a broad substring hit.
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

  -- Resolve a named doctor (surname or full name), if any.
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

  -- Current upcoming appointment (nearest), needed for reschedule/cancel.
  select * into v_cur_slot
    from public.slots
   where clinic_id = p_clinic_id and patient_id = v_patient
     and status in ('booked','confirmed','pending_confirmation','offered')
     and start_time > now()
   order by start_time limit 1;

  -- ---- op: cancel -------------------------------------------------------
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
      'doctor_name', v_cur_slot.doctor_name
    ));
    v_ok_n := 1;

  -- ---- op: reschedule ---------------------------------------------------
  elsif v_op = 'reschedule' then
    if v_date is null or v_time is null then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'missing_datetime',
        'patient', jsonb_build_object('id', v_patient, 'name', v_pname));
    end if;
    if v_cur_slot.id is null then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'no_current_appt',
        'patient', jsonb_build_object('id', v_patient, 'name', v_pname));
    end if;
    -- Keep the current doctor unless reception named a different one.
    if v_doc_id is null then
      v_doc_id := v_cur_slot.doctor_id;
      v_doc_name := v_cur_slot.doctor_name;
    end if;
    v_start := (v_date || ' ' || v_time)::timestamp at time zone 'Europe/Lisbon';
    if v_start <= now() then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'target_in_past',
        'patient', jsonb_build_object('id', v_patient, 'name', v_pname));
    end if;
    v_tgt := public.reception_target_status(p_clinic_id, v_doc_id, v_start, v_patient);
    v_actions := jsonb_build_array(jsonb_build_object(
      'kind', 'reschedule',
      'status', v_tgt->>'status',
      'patient_id', v_patient,
      'doctor_id', v_doc_id,
      'doctor_name', v_doc_name,
      'start_time', v_start,
      'end_time', v_start + interval '30 minutes',
      'to_lisbon', to_char(v_start at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI'),
      'from_lisbon', to_char(v_cur_slot.start_time at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI'),
      'target_slot_id', v_tgt->>'slot_id',
      'vacate_slot_id', v_cur_slot.id,
      'create', (v_tgt->>'create')::boolean
    ));
    if v_tgt->>'status' = 'ok' then v_ok_n := 1; else v_conf_n := 1; end if;

  -- ---- op: book (single new appointment) --------------------------------
  elsif v_op = 'book' then
    if v_date is null or v_time is null then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'missing_datetime',
        'patient', jsonb_build_object('id', v_patient, 'name', v_pname));
    end if;
    -- Doctor: named -> primary -> first active (auto-picked, flagged for the UI).
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
    v_tgt := public.reception_target_status(p_clinic_id, v_doc_id, v_start, v_patient);
    v_actions := jsonb_build_array(jsonb_build_object(
      'kind', 'book',
      'status', v_tgt->>'status',
      'patient_id', v_patient,
      'doctor_id', v_doc_id,
      'doctor_name', v_doc_name,
      'doctor_auto', v_doc_auto,
      'start_time', v_start,
      'end_time', v_start + interval '30 minutes',
      'to_lisbon', to_char(v_start at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI'),
      'target_slot_id', v_tgt->>'slot_id',
      'create', (v_tgt->>'create')::boolean
    ));
    if v_tgt->>'status' = 'ok' then v_ok_n := 1; else v_conf_n := 1; end if;

  -- ---- op: recurring ----------------------------------------------------
  elsif v_op = 'recurring' then
    v_rec := p_command->'recurrence';
    if v_rec is null or v_rec->>'time' is null or v_rec->>'start_date' is null
       or v_rec->>'end_date' is null or v_rec->>'weekday' is null then
      return jsonb_build_object('ok', false, 'op', v_op, 'problem', 'incomplete_recurrence',
        'patient', jsonb_build_object('id', v_patient, 'name', v_pname));
    end if;
    v_wd := (v_rec->>'weekday')::int;
    v_time := v_rec->>'time';
    -- Doctor: named -> primary -> first active.
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
    -- Every matching weekday between start and end (cap 26 occurrences).
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
      v_tgt := public.reception_target_status(p_clinic_id, v_doc_id, v_start, v_patient);
      v_actions := v_actions || jsonb_build_object(
        'kind', 'book',
        'status', v_tgt->>'status',
        'patient_id', v_patient,
        'doctor_id', v_doc_id,
        'doctor_name', v_doc_name,
        'doctor_auto', v_doc_auto,
        'start_time', v_start,
        'end_time', v_start + interval '30 minutes',
        'to_lisbon', to_char(v_start at time zone 'Europe/Lisbon','DD/MM/YYYY HH24:MI'),
        'target_slot_id', v_tgt->>'slot_id',
        'create', (v_tgt->>'create')::boolean
      );
      if v_tgt->>'status' = 'ok' then v_ok_n := v_ok_n + 1; else v_conf_n := v_conf_n + 1; end if;
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

-- ---------------------------------------------------------------------------
-- reception_apply: re-validates and executes an already-computed plan.
-- Only actions with status='ok' are attempted; each is re-checked against the
-- live agenda (it may have changed since the preview) and reported per-action.
-- ---------------------------------------------------------------------------
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
  v_start     timestamptz;
  v_end       timestamptz;
  v_tgt_id    uuid;
  v_vac_id    uuid;
  v_doc_name  text;
  v_new_slot  uuid;
  v_slot      public.slots%rowtype;
  v_results   jsonb := '[]'::jsonb;
  v_applied   int := 0;
  v_notified  boolean := false;
  v_opted     boolean;
  v_pname     text;
  v_conv      uuid;
  v_last      jsonb;   -- last successful action, for the notification text
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
    v_doc_name := v_a->>'doctor_name';
    v_tgt_id := nullif(v_a->>'target_slot_id','')::uuid;
    v_vac_id := nullif(v_a->>'vacate_slot_id','')::uuid;
    v_start  := nullif(v_a->>'start_time','')::timestamptz;
    v_end    := nullif(v_a->>'end_time','')::timestamptz;

    -- Vacate the patient's current slot (reschedule/cancel): reopen to
    -- `available` — reception semantics, no cascade. Re-verify it's still
    -- this patient's occupied slot.
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

    -- book / reschedule: fill an existing available slot, or create one.
    v_new_slot := null;
    if v_tgt_id is not null then
      select * into v_slot from public.slots where id = v_tgt_id for update;
      if found and v_slot.clinic_id = p_clinic_id and v_slot.status = 'available' then
        update public.slots
           set patient_id = v_patient, status = 'booked', booked_at = now(),
               cancellation_reason = null, cancelled_at = null, updated_at = now()
         where id = v_tgt_id;
        v_new_slot := v_tgt_id;
      end if;
    end if;

    if v_new_slot is null then
      -- Re-check the time is still free before creating an off-grid slot.
      if v_doc_id is not null and exists (
        select 1 from public.slots
         where clinic_id = p_clinic_id and doctor_id = v_doc_id
           and status in ('booked','confirmed','pending_confirmation','offered','completed')
           and start_time < v_end and end_time > v_start
      ) then
        v_results := v_results || jsonb_build_object('to_lisbon', v_a->>'to_lisbon',
          'outcome', 'skipped', 'reason', 'conflict');
        continue;
      end if;
      insert into public.slots (clinic_id, doctor_id, doctor_name, start_time, end_time,
                                patient_id, status, booked_at, notes)
      values (p_clinic_id, v_doc_id, v_doc_name, v_start, v_end,
              v_patient, 'booked', now(), 'reception_command')
      returning id into v_new_slot;
    end if;

    -- Continuity of care: adopt this doctor as the patient's primary if none.
    if v_doc_id is not null then
      update public.patients
         set primary_doctor_id = coalesce(primary_doctor_id, v_doc_id), updated_at = now()
       where id = v_patient;
    end if;

    v_applied := v_applied + 1;
    v_last := v_a;
    v_results := v_results || jsonb_build_object('to_lisbon', v_a->>'to_lisbon',
      'from_lisbon', v_a->>'from_lisbon', 'outcome', 'applied', 'slot_id', v_new_slot);
  end loop;

  -- Notify the patient once, if asked and not opted out. Deterministic PT text;
  -- reuses agent_send_message (STOP-once + message plumbing). Patient is the
  -- same across all actions of a single command.
  if p_notify and v_last is not null then
    v_patient := (v_last->>'patient_id')::uuid;
    select name, opted_out into v_pname, v_opted from public.patients where id = v_patient;
    if not coalesce(v_opted, false) then
      v_body := case
        when v_applied = 0 then null
        when v_last->>'kind' = 'cancel' then
          'Olá ' || v_pname || ', a sua consulta de ' || (v_last->>'from_lisbon')
          || ' foi cancelada. Se quiser remarcar, é só dizer.'
        when v_last->>'kind' = 'reschedule' then
          'Olá ' || v_pname || ', a sua consulta foi remarcada para ' || (v_last->>'to_lisbon')
          || coalesce(' com ' || (v_last->>'doctor_name'), '') || '.'
        when (p_plan->>'op') = 'recurring' then
          'Olá ' || v_pname || ', ficaram marcadas ' || v_applied
          || ' consultas' || coalesce(' com ' || (v_last->>'doctor_name'), '')
          || '. A primeira é a ' || (
             select x->>'to_lisbon' from jsonb_array_elements(v_results) x
              where x->>'outcome' = 'applied' limit 1) || '.'
        else
          'Olá ' || v_pname || ', ficou com consulta marcada para ' || (v_last->>'to_lisbon')
          || coalesce(' com ' || (v_last->>'doctor_name'), '') || '.'
      end;
      if v_body is not null then
        -- Reuse an active general conversation, else open one.
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

-- Lock down: service_role only (app calls via the service client). Matches 026.
revoke all on function public.reception_norm(text) from public, anon, authenticated;
revoke all on function public.reception_target_status(uuid, uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.reception_plan(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.reception_apply(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.reception_plan(uuid, jsonb, uuid) to service_role;
grant execute on function public.reception_apply(uuid, jsonb, boolean) to service_role;
