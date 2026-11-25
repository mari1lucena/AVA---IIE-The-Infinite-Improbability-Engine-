-- 025 — Google Calendar two-way sync bookkeeping.
--
-- Adds the incremental-sync cursor + push-notification (watch) channel fields
-- the two-way agenda↔Google Calendar sync needs. The token columns
-- (clinics.google_calendar_id, clinics.google_refresh_token) already exist from
-- 001, and slots.google_event_id (the per-event round-trip key, with its index)
-- exists too — this only adds the sync-state columns.
--
-- Applied live to project YOUR_PROJECT_REF via MCP as
-- `google_calendar_sync_fields`; this file is the repo record.

alter table public.clinics
  add column if not exists google_connected_email     text,
  add column if not exists google_connected_at        timestamptz,
  add column if not exists google_sync_token          text,        -- events.list nextSyncToken (incremental cursor)
  add column if not exists google_channel_id          text,        -- UUID of the active events.watch push channel (we generate it)
  add column if not exists google_resource_id         text,        -- Google's resourceId for that channel
  add column if not exists google_channel_expiration  timestamptz; -- when the watch channel lapses (needs renew)

comment on column public.clinics.google_sync_token is
  'Google Calendar events.list nextSyncToken — incremental pull cursor. Null = do a full initial sync.';
comment on column public.clinics.google_channel_id is
  'UUID of the active events.watch push channel (we generate it). Null = no live push subscription.';
