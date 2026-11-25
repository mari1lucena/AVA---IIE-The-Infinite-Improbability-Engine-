-- 014: inbound from an unknown number auto-creates a patient profile, so a
-- "random number" can text the clinic to book and then be chatted with like any
-- other patient. (mock_sms_inbound is the /sms simulator's inbound entry point;
-- real SMS via Twilio would call an equivalent path.)

create or replace function public.mock_sms_inbound(p_clinic_slug text, p_phone text, p_body text)
returns uuid
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  v_clinic_id uuid;
  v_patient_id uuid;
  v_conversation_id uuid;
begin
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'empty_body';
  end if;
  if p_phone is null or length(btrim(p_phone)) = 0 then
    raise exception 'empty_phone';
  end if;

  select id into v_clinic_id from clinics where slug = p_clinic_slug;
  if v_clinic_id is null then
    raise exception 'clinic_not_found';
  end if;

  select id into v_patient_id
  from patients
  where clinic_id = v_clinic_id and phone = p_phone and coalesce(is_active, true)
  limit 1;

  -- Unknown number → create a lightweight profile (placeholder name from the
  -- last 4 digits; staff can rename later).
  if v_patient_id is null then
    insert into patients (clinic_id, name, phone, is_active, accepts_short_notice)
    values (
      v_clinic_id,
      'Novo contacto ' || right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 4),
      p_phone, true, true
    )
    returning id into v_patient_id;
  end if;

  select id into v_conversation_id
  from conversations
  where clinic_id = v_clinic_id and patient_id = v_patient_id
    and status in ('active', 'escalated')
  order by coalesce(last_message_at, created_at) desc
  limit 1;

  if v_conversation_id is null then
    insert into conversations (clinic_id, patient_id, conversation_type, status)
    values (v_clinic_id, v_patient_id, 'general', 'active')
    returning id into v_conversation_id;
  end if;

  insert into messages (conversation_id, sender_type, sender_id, body, channel)
  values (v_conversation_id, 'patient', v_patient_id, btrim(p_body), 'mock');

  update conversations
  set message_count = coalesce(message_count, 0) + 1, last_message_at = now(), updated_at = now()
  where id = v_conversation_id;

  return v_conversation_id;
end;
$function$;
