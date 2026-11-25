-- 024: Dispatcher RPCs for the Agent Pilot — collapse 6 reply-side tools into 3.
-- Each branches deterministically on conversation state (Postgres decides, not the LLM),
-- and delegates to the existing, untouched RPCs so WF-A behaviour is unaffected.
-- Applied live via Supabase MCP as `pilot_tool_consolidation_dispatchers` (2026-08-17).

-- YES to whatever was offered: cascade offer accept, or day-before confirmation keep.
create or replace function public.offer_accept(p_conversation_id uuid)
returns json language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_type text;
begin
  select conversation_type into v_type from public.conversations where id = p_conversation_id;
  if v_type is null then
    return json_build_object('status','error','reason','conversation_not_found');
  elsif v_type = 'slot_cascade' then
    return public.cascade_respond_accept(p_conversation_id);
  elsif v_type = 'confirmation' then
    return public.confirmation_confirm(p_conversation_id);
  else
    return json_build_object('status','error','reason','no_offer_to_accept','conversation_type',v_type);
  end if;
end;
$$;

-- NO to whatever was offered: cascade offer decline, or day-before "not going" (frees slot -> cascade).
create or replace function public.offer_decline(p_conversation_id uuid)
returns json language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_type text;
begin
  select conversation_type into v_type from public.conversations where id = p_conversation_id;
  if v_type is null then
    return json_build_object('status','error','reason','conversation_not_found');
  elsif v_type = 'slot_cascade' then
    return public.cascade_respond_decline(p_conversation_id);
  elsif v_type = 'confirmation' then
    return public.confirmation_decline(p_conversation_id);
  else
    return json_build_object('status','error','reason','no_offer_to_decline','conversation_type',v_type);
  end if;
end;
$$;

-- Stateful cancel: first call ALWAYS nudges (resist-once), second call actually cancels.
-- The resist step can no longer be skipped by the LLM -- the DB enforces the order via cancel_pending.
create or replace function public.cancel_booking(p_conversation_id uuid)
returns json language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_pending boolean;
begin
  select cancel_pending into v_pending from public.conversations where id = p_conversation_id;
  if not found then
    return json_build_object('status','error','reason','conversation_not_found');
  end if;
  if coalesce(v_pending, false) then
    return public.booking_cancel(p_conversation_id);
  else
    perform public.booking_cancel_request(p_conversation_id);
    return json_build_object('status','nudge',
      'note','Registado pedido de cancelamento. Sugira remarcar em vez de cancelar; so cancele se o paciente insistir na proxima mensagem.');
  end if;
end;
$$;

revoke all on function public.offer_accept(uuid)  from anon, authenticated;
revoke all on function public.offer_decline(uuid) from anon, authenticated;
revoke all on function public.cancel_booking(uuid) from anon, authenticated;
grant execute on function public.offer_accept(uuid)  to service_role;
grant execute on function public.offer_decline(uuid) to service_role;
grant execute on function public.cancel_booking(uuid) to service_role;
