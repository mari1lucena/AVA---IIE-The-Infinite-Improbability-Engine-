-- 015: rename auto-created "Novo contacto" profiles once the person gives a name.
-- WF-A extracts a name (Groq 8B) from messages of placeholder-named patients and
-- calls this RPC. Guarded so it only ever renames a placeholder, never overwrites
-- a real name.

create or replace function public.patient_set_name(p_conversation_id uuid, p_name text)
returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  v_patient uuid;
  v_current text;
  v_clean   text;
begin
  select c.patient_id, p.name into v_patient, v_current
    from public.conversations c
    join public.patients p on p.id = c.patient_id
   where c.id = p_conversation_id;
  if v_patient is null then
    return json_build_object('status','error','reason','no_patient');
  end if;

  -- Only rename auto-created placeholders.
  if v_current is null or v_current not like 'Novo contacto %' then
    return json_build_object('status','skipped','reason','already_named');
  end if;

  v_clean := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if length(v_clean) < 2 or length(v_clean) > 80 then
    return json_build_object('status','skipped','reason','invalid_name');
  end if;

  update public.patients set name = v_clean, updated_at = now() where id = v_patient;
  return json_build_object('status','renamed','name',v_clean);
end $$;

revoke all on function public.patient_set_name(uuid,text) from public;
grant execute on function public.patient_set_name(uuid,text) to service_role;
