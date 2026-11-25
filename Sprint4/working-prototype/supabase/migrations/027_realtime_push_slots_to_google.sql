-- Direction A: mirror EVERY slot write out to Google Calendar in real-time.
-- The SMS agent books via Postgres RPCs directly (never touching the Next.js
-- app), so the app's inline Google push never fired for agent bookings — they
-- lived only in our DB and never reached the shared calendar (the "Vasco Maria"
-- gap). This DB trigger fires on any meaningful slot change and POSTs to the
-- app's /api/google/push webhook (via pg_net), so all writers publish to Google.
-- Same mechanism as private.notify_n8n_slot_cancelled.

create or replace function private.notify_app_slot_push()
returns trigger
language plpgsql
security definer
set search_path to 'private', 'public', 'extensions', 'net', 'pg_temp'
as $function$
declare
  v_url      text;
  v_secret   text;
  v_relevant boolean;
begin
  -- Fire ONLY on changes that affect what Google should show. Critically, this
  -- breaks the feedback loop: the push webhook writes back google_event_id and
  -- last_synced_at, and those writes must NOT re-trigger us (they change neither
  -- the appointment fields below nor, on their own, whether it's an appointment).
  if tg_op = 'INSERT' then
    v_relevant := new.status in ('booked', 'confirmed', 'pending_confirmation');
  else
    v_relevant :=
      (
        new.status     is distinct from old.status
        or new.start_time is distinct from old.start_time
        or new.end_time   is distinct from old.end_time
        or new.patient_id is distinct from old.patient_id
        or new.doctor_id  is distinct from old.doctor_id
        or new.notes      is distinct from old.notes
      )
      and (
        -- it must be, or have been, something mirrorable (else nothing to do)
        new.status in ('booked', 'confirmed', 'pending_confirmation')
        or old.status in ('booked', 'confirmed', 'pending_confirmation')
        or new.google_event_id is not null
        or old.google_event_id is not null
      );
  end if;

  if not v_relevant then
    return new;
  end if;

  select value into v_url    from private.app_config where key = 'app_google_push_url';
  select value into v_secret from private.app_config where key = 'n8n_webhook_secret';

  -- No app webhook configured (e.g. no public tunnel) → skip; the app's manual
  -- "Sincronizar agora" remains the reconcile backstop.
  if v_url is null or v_url = '' then
    return new;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object(
                 'type', 'slot_push',
                 'slot_id', new.id,
                 'clinic_id', new.clinic_id
               ),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-webhook-secret', coalesce(v_secret, '')
               )
  );
  return new;
end;
$function$;

drop trigger if exists trg_notify_app_slot_push on public.slots;
create trigger trg_notify_app_slot_push
after insert or update on public.slots
for each row execute function private.notify_app_slot_push();

-- The app's public push endpoint (same tunnel host as GOOGLE_WEBHOOK_URL). On a
-- tunnel restart this must be updated alongside the n8n + Google webhook URLs.
insert into private.app_config (key, value)
values ('app_google_push_url', 'https://<your-tunnel>.trycloudflare.com/api/google/push')
on conflict (key) do update set value = excluded.value;
