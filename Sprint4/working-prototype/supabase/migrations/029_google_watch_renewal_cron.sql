-- Auto-renew Google Calendar watch channels before their ~7-day expiry, so
-- Direction B stays live on a machine left running (dev:up / the "Renovar" button
-- cover interactive sessions; this covers the gap). Self-contained: pg_cron fires
-- a function that POSTs the app's /api/google/arm endpoint via pg_net (same
-- pattern as private.notify_n8n_slot_cancelled). setupWatch now stops the old
-- channel before opening a new one, so daily renewal keeps exactly one per calendar.

create extension if not exists pg_cron;

-- Track the app's arm URL alongside the push URL (both rotate with the tunnel).
-- admin_set_tunnel_config now writes it too; seed it from the current push URL.
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
  v_arm     text;
begin
  if coalesce(p_n8n_base, '') = '' or coalesce(p_app_base, '') = '' then
    return json_build_object('status', 'error', 'reason', 'p_n8n_base and p_app_base are required');
  end if;
  p_n8n_base := regexp_replace(p_n8n_base, '/+$', '');
  p_app_base := regexp_replace(p_app_base, '/+$', '');

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
  v_arm  := p_app_base || '/api/google/arm';

  insert into private.app_config (key, value) values ('n8n_inbound_webhook_url', v_inbound)
    on conflict (key) do update set value = excluded.value;
  insert into private.app_config (key, value) values ('n8n_cascade_webhook_url', v_cascade)
    on conflict (key) do update set value = excluded.value;
  insert into private.app_config (key, value) values ('app_google_push_url', v_push)
    on conflict (key) do update set value = excluded.value;
  insert into private.app_config (key, value) values ('app_google_arm_url', v_arm)
    on conflict (key) do update set value = excluded.value;

  return json_build_object(
    'status', 'ok',
    'n8n_inbound_webhook_url', v_inbound,
    'n8n_cascade_webhook_url', v_cascade,
    'app_google_push_url', v_push,
    'app_google_arm_url', v_arm
  );
end;
$function$;

revoke all on function public.admin_set_tunnel_config(text, text) from public, anon, authenticated;
grant execute on function public.admin_set_tunnel_config(text, text) to service_role;

-- Seed the arm URL from the current push URL (so the cron works before the next dev:up run).
insert into private.app_config (key, value)
select 'app_google_arm_url', replace(value, '/api/google/push', '/api/google/arm')
from private.app_config where key = 'app_google_push_url'
on conflict (key) do update set value = excluded.value;

-- The renewal call itself: POST the arm endpoint with the shared secret. No-op if
-- no arm URL is configured (e.g. tunnel down / machine off) — pg_net just isn't fired.
create or replace function private.renew_google_watches()
returns void
language plpgsql
security definer
set search_path to 'private', 'public', 'extensions', 'net', 'pg_temp'
as $function$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url    from private.app_config where key = 'app_google_arm_url';
  select value into v_secret from private.app_config where key = 'n8n_webhook_secret';
  if coalesce(v_url, '') = '' then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('source', 'cron'),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-webhook-secret', coalesce(v_secret, '')
               )
  );
end;
$function$;

-- Daily at 03:17 UTC. Watches last ~7 days; daily renewal is a cheap backstop
-- (idempotent — setupWatch stops the prior channel first). cron.schedule upserts by name.
select cron.schedule(
  'renew-google-watches',
  '17 3 * * *',
  $cron$ select private.renew_google_watches(); $cron$
);
