-- One RPC the dev-up script calls to repoint every tunnel-dependent URL after
-- cloudflared hands out fresh hosts. Host-swaps the n8n inbound + cascade URLs
-- (preserving whichever agent path is active — pilot vs wfa) and the app's
-- Google-push URL. service_role only (matches admin_set_agent_route).
create or replace function public.admin_set_tunnel_config(p_n8n_base text, p_app_base text)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_inbound text;
  v_cascade text;
  v_push    text;
begin
  if coalesce(p_n8n_base, '') = '' or coalesce(p_app_base, '') = '' then
    return json_build_object('status', 'error', 'reason', 'p_n8n_base and p_app_base are required');
  end if;
  p_n8n_base := regexp_replace(p_n8n_base, '/+$', '');
  p_app_base := regexp_replace(p_app_base, '/+$', '');

  -- n8n inbound: keep the active path (pilot vs wfa), swap only scheme+host.
  select value into v_inbound from private.app_config where key = 'n8n_inbound_webhook_url';
  v_inbound := case
    when coalesce(v_inbound, '') = '' then p_n8n_base || '/webhook/ii-agent-pilot'
    else regexp_replace(v_inbound, '^https?://[^/]+', p_n8n_base)
  end;

  select value into v_cascade from private.app_config where key = 'n8n_cascade_webhook_url';
  v_cascade := case
    when coalesce(v_cascade, '') = '' then p_n8n_base || '/webhook/ii-slot-cascade'
    else regexp_replace(v_cascade, '^https?://[^/]+', p_n8n_base)
  end;

  v_push := p_app_base || '/api/google/push';

  insert into private.app_config (key, value) values ('n8n_inbound_webhook_url', v_inbound)
    on conflict (key) do update set value = excluded.value;
  insert into private.app_config (key, value) values ('n8n_cascade_webhook_url', v_cascade)
    on conflict (key) do update set value = excluded.value;
  insert into private.app_config (key, value) values ('app_google_push_url', v_push)
    on conflict (key) do update set value = excluded.value;

  return json_build_object(
    'status', 'ok',
    'n8n_inbound_webhook_url', v_inbound,
    'n8n_cascade_webhook_url', v_cascade,
    'app_google_push_url', v_push
  );
end;
$function$;

revoke all on function public.admin_set_tunnel_config(text, text) from public, anon, authenticated;
grant execute on function public.admin_set_tunnel_config(text, text) to service_role;
