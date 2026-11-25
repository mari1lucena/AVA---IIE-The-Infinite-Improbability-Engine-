-- 036_concurrency_guards.sql
-- Concurrency hardening for the shared agenda (reception command box + SMS agent
-- both write slots). Two layers:
--
-- (1) DB-level EXCLUSION CONSTRAINT: it is now impossible to have two overlapping
--     ACTIVE appointments for the same doctor — regardless of which actor writes,
--     and even across different slot rows (e.g. a Google-imported event overlapping
--     a grid slot). This is the ultimate backstop against double-booking.
--
-- (2) ROW-LEVEL STATUS GUARD on cascade_respond_accept: the cascade acceptance
--     filled its freed slot with an unguarded UPDATE (WHERE id=X). Now it fills
--     only if the slot is still unoccupied (patient_id is null); if a concurrent
--     booker took it, the UPDATE matches 0 rows and the function returns
--     'unavailable' instead of a false confirmation.
--
-- The primary booking paths (book_slot, reception_apply) already serialize via
-- SELECT ... FOR UPDATE + a status='available' re-check; these two additions
-- close the remaining gaps (the cascade fill and cross-row overlaps).
--
-- Preconditions checked before applying: 0 existing overlapping active pairs,
-- 0 active slots without a doctor_id.

create extension if not exists btree_gist;

-- One active appointment per doctor per time-range. tstzrange defaults to '[)'
-- (inclusive start, exclusive end) so back-to-back slots (10:00-10:30 and
-- 10:30-11:00) do NOT conflict. Only active statuses are constrained; available /
-- cancelled / completed rows are ignored, and rows with a null doctor_id are
-- skipped (unique-constraint NULL semantics). Verified live: overlaps blocked,
-- adjacent allowed.
alter table public.slots
  add constraint slots_no_double_booking
  exclude using gist (
    doctor_id with =,
    tstzrange(start_time, end_time) with &&
  ) where (status in ('booked','confirmed','pending_confirmation'));

-- Guarded cascade acceptance (see cascade_respond_accept in 008; this adds the
-- patient_id-is-null race guard + row-count check and reorders so the offer is
-- only marked 'accepted' after the slot is actually filled).
create or replace function public.cascade_respond_accept(p_conversation_id uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_conv    public.conversations%rowtype;
  v_offer   public.cascade_offers%rowtype;
  v_freed   uuid;
  v_vacated uuid;
  v_rows    integer;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;

  select * into v_offer from public.cascade_offers where id = v_conv.related_cascade_offer_id;
  if not found then raise exception 'offer_not_found'; end if;

  if v_offer.status <> 'pending' then
    return json_build_object('status', 'stale', 'offer_status', v_offer.status);
  end if;

  v_freed   := v_offer.slot_id;
  v_vacated := v_offer.candidate_slot_id;

  -- Race guard: only fill if nobody booked this freed slot in the meantime.
  update public.slots
     set patient_id   = v_offer.patient_id,
         status       = 'confirmed',
         confirmed_at = now(),
         cancelled_at = null,
         cancellation_reason = null,
         refilled_from = coalesce(refilled_from, 'cascade'),
         cascade_level = coalesce(cascade_level, 0) + 1
   where id = v_freed
     and patient_id is null;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    update public.cascade_offers
       set status = 'expired', responded_at = now(),
           response_message = 'ACCEPT_but_slot_taken'
     where id = v_offer.id;
    return json_build_object('status', 'unavailable', 'reason', 'slot_taken',
      'filled_slot_id', v_freed);
  end if;

  update public.cascade_offers
     set status = 'accepted', responded_at = now(), response_message = 'ACCEPT'
   where id = v_offer.id;

  if v_vacated is not null then
    update public.slots
       set original_patient_id  = coalesce(original_patient_id, patient_id),
           patient_id           = null,
           status               = 'cancelled',
           cancelled_at         = now(),
           cancellation_reason  = 'cascade_vacated'
     where id = v_vacated
       and status in ('booked', 'confirmed');
  else
    update public.waiting_list
       set status = 'booked', booked_at = now()
     where clinic_id = v_conv.clinic_id
       and patient_id = v_offer.patient_id
       and status = 'active';
  end if;

  update public.conversations
     set status = 'resolved', resolved_at = now(),
         resolution_outcome = 'slot_filled', updated_at = now()
   where id = p_conversation_id;

  return json_build_object(
    'status', 'accepted',
    'filled_slot_id', v_freed,
    'vacated_slot_id', v_vacated
  );
end;
$function$;
