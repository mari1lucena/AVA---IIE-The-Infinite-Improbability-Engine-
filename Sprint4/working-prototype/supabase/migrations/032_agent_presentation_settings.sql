-- 032_agent_presentation_settings.sql
-- Per-clinic agent presentation/behaviour settings, editable from the platform's
-- "Agente" tab on /settings and consumed by the n8n agent via agent_context.
-- All defaults preserve today's behaviour (no name, formal você, Portuguese, no emojis).
alter table public.clinics
  add column if not exists agent_name text,                                -- how the agent signs itself; null = anonymous (current behaviour)
  add column if not exists agent_tone text not null default 'formal',      -- 'formal' (você) | 'informal' (tu)
  add column if not exists agent_language text not null default 'pt',      -- 'pt' (always European Portuguese) | 'mirror' (reply in patient's language)
  add column if not exists agent_signature text,                           -- optional sign-off line
  add column if not exists agent_use_emoji boolean not null default false, -- allow emojis
  add column if not exists agent_custom_instructions text;                 -- free-text extra guidance for the system prompt

-- Expose the settings to the agent. agent_context is SECURITY DEFINER / service_role only.
create or replace function public.agent_context(p_conversation_id uuid)
returns json language sql security definer set search_path to 'public','pg_temp'
as $function$
  select json_build_object(
    'conversation_id', c.id,
    'status', c.status,
    'conversation_type', c.conversation_type,
    'clinic_name', cl.name,
    'clinic_slug', cl.slug,
    'agent_settings', json_build_object(
      'name', cl.agent_name,
      'tone', coalesce(cl.agent_tone, 'formal'),
      'language', coalesce(cl.agent_language, 'pt'),
      'signature', cl.agent_signature,
      'use_emoji', coalesce(cl.agent_use_emoji, false),
      'custom_instructions', cl.agent_custom_instructions
    ),
    'patient', json_build_object(
      'name', p.name, 'phone', p.phone, 'is_active', p.is_active,
      'primary_doctor_id', p.primary_doctor_id,
      'primary_doctor_name', pd.name
    ),
    'doctors', coalesce((
      select json_agg(json_build_object('id', d.id, 'name', d.name) order by d.name)
      from public.doctors d where d.clinic_id = cl.id and coalesce(d.is_active, true)
    ), '[]'::json),
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
    'cancel_pending', c.cancel_pending,
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
  left join public.doctors pd on pd.id = p.primary_doctor_id
  left join public.slots s on s.id = c.related_slot_id
  where c.id = p_conversation_id;
$function$;

revoke all on function public.agent_context(uuid) from public, anon, authenticated;
grant execute on function public.agent_context(uuid) to service_role;
