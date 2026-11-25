-- 026 — SECURITY: lock down public RPC grants.
--
-- Audit (before public exposure) found many SECURITY DEFINER functions callable
-- by `anon` (the browser/publishable key, which is public) and `authenticated`.
-- Because SECURITY DEFINER bypasses RLS, anyone could hit the Supabase REST API
-- directly and run them — e.g. demo_reset() (wipe the clinic), agent_send_message
-- (inject agent texts), book_slot / cancel_booking (manipulate the agenda),
-- patient_set_name, agent_context (read patient data by conversation id).
--
-- These are only ever invoked by n8n (service_role) or a server action using the
-- service client, so the over-broad grants are revoked. mock_sms_* stay anon
-- (the /sms dev simulator calls them client-side; remove /sms for production).
--
-- Applied live via MCP as security_revoke_public_rpc_grants (+ _part2). This file
-- is the repo record.

do $$
declare r record;
begin
  -- Part 1: functions that had explicit anon/authenticated grants.
  for r in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'agent_context','agent_send_message','agent_escalate','book_slot',
        'booking_decline','booking_offer_clear','cancel_booking',
        'find_availability','find_availability_window','offer_accept',
        'offer_decline','patient_opt_in','patient_opt_out','patient_set_name',
        'pullforward_offer_next','seed_clinic_agenda','demo_reset'
      )
  loop
    execute format('revoke execute on function %s from anon, authenticated', r.sig);
  end loop;

  -- Part 2: four functions still carried the default PUBLIC execute grant.
  for r in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'cancel_booking','find_availability_window','offer_accept','offer_decline'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
