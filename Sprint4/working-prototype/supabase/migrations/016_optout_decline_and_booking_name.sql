-- 016: two fixes.
--
-- (A) STOP during an offer = NO + opt-out. Previously patient_opt_out declined
--     the pending cascade offer but the freed slot never advanced to the next
--     candidate (the wedge stalled), and a STOP mid-conversation could be read
--     by the classifier as frustration -> escalation. A STOP received DURING a
--     cascade/confirmation offer is now treated as an explicit decline: the
--     calendar is freed so the cascade keeps moving, exactly as "não" would,
--     AND the patient is opted out. Deterministic — never LLM-decided.
--
-- (B) New-contact booking no longer "finishes too soon". book_slot resolved the
--     conversation on booking; for an auto-created "Novo contacto" profile we
--     still ask for the name, so the reply must stay in the SAME thread. Keep
--     the conversation active for placeholder contacts (mock_sms_inbound only
--     finds active/escalated threads, so a resolved one orphaned the name reply
--     into a fresh "general" conversation).

-- --------------------------------------------------------------------------
-- (A) patient_opt_out: also decline the current offer so the slot advances.
create or replace function public.patient_opt_out(p_conversation_id uuid)
returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  v_patient uuid;
  v_conv    public.conversations%rowtype;
  v_offer   public.cascade_offers%rowtype;
  v_advance boolean := false;
  v_slot    uuid    := null;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  v_patient := v_conv.patient_id;
  if v_patient is null then return json_build_object('status','error','reason','no_patient'); end if;

  update public.patients set opted_out = true, opted_out_at = now(), updated_at = now()
   where id = v_patient;

  -- A STOP received DURING an offer is also a decline of that offer.
  if v_conv.conversation_type = 'slot_cascade' then
    -- Decline the pending offer on THIS conversation. The freed slot stays
    -- 'cancelled' (no status change), so n8n must re-advance the cascade.
    select * into v_offer from public.cascade_offers
      where id = v_conv.related_cascade_offer_id and status = 'pending';
    if found then
      update public.cascade_offers
         set status='declined', responded_at=now(), response_message='OPTED_OUT'
       where id = v_offer.id;
      v_slot := v_offer.slot_id;
    else
      v_slot := v_conv.related_slot_id;
    end if;
    v_advance := v_slot is not null;
  elsif v_conv.conversation_type = 'confirmation' then
    -- Decline the confirmation: free the booked slot (booked/confirmed ->
    -- cancelled) so the DB trigger auto-starts a fresh cascade. No n8n re-post.
    update public.slots
       set original_patient_id = coalesce(original_patient_id, patient_id),
           patient_id = null, status = 'cancelled', cancelled_at = now(),
           cancellation_reason = 'opted_out', updated_at = now()
     where id = v_conv.related_slot_id and status in ('booked','confirmed');
  end if;

  -- Tidy any OTHER pending proactive offers so nothing lingers for this patient.
  update public.cascade_offers set status='declined', responded_at=now(), response_message='OPTED_OUT'
   where patient_id = v_patient and status='pending';
  update public.conversations
     set status='resolved', offered_slot_ids=null, resolved_at=now(),
         resolution_outcome='opted_out', updated_at=now()
   where patient_id = v_patient and status='active'
     and conversation_type in ('slot_cascade','pullforward');
  update public.conversations set status='resolved', resolved_at=now(), updated_at=now()
   where id = p_conversation_id;

  return json_build_object('status','opted_out','advance_cascade',v_advance,'slot_id',v_slot);
end $$;

revoke all on function public.patient_opt_out(uuid) from public;
grant execute on function public.patient_opt_out(uuid) to service_role;

-- --------------------------------------------------------------------------
-- (B) book_slot: keep the conversation active for placeholder contacts so the
--     follow-up name reply continues in the same thread.
create or replace function public.book_slot(
  p_conversation_id uuid,
  p_slot_id uuid
) returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  v_patient     uuid;
  v_clinic      uuid;
  v_placeholder boolean := false;
  v_slot        public.slots%rowtype;
  v_vacated     uuid;
begin
  select c.patient_id, c.clinic_id, (p.name like 'Novo contacto %')
    into v_patient, v_clinic, v_placeholder
    from public.conversations c
    join public.patients p on p.id = c.patient_id
   where c.id = p_conversation_id;
  if v_patient is null then
    return json_build_object('status','error','reason','no_patient');
  end if;

  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found or v_slot.clinic_id <> v_clinic then
    return json_build_object('status','unavailable','reason','not_found');
  end if;
  if v_slot.status <> 'available' then
    return json_build_object('status','unavailable','reason','taken');
  end if;

  -- Move: free the patient's nearest OTHER upcoming appointment (if any).
  select id into v_vacated
    from public.slots
   where clinic_id = v_clinic and patient_id = v_patient and id <> p_slot_id
     and status in ('booked','confirmed','pending_confirmation','offered')
     and start_time > now()
   order by start_time
   limit 1;

  if v_vacated is not null then
    update public.slots
       set original_patient_id = coalesce(original_patient_id, patient_id),
           patient_id = null, status = 'cancelled',
           cancelled_at = now(), cancellation_reason = 'rebooked_via_agent',
           updated_at = now()
     where id = v_vacated;
  end if;

  update public.slots
     set patient_id = v_patient, status = 'booked', booked_at = now(), updated_at = now()
   where id = p_slot_id;

  -- Clear the pending offer either way. Resolve the conversation UNLESS this is
  -- a placeholder contact we still need to name: keep it active so their name
  -- reply lands in THIS thread (mock_sms_inbound reuses active threads only).
  if v_placeholder then
    update public.conversations
       set offered_slot_ids = null, updated_at = now()
     where id = p_conversation_id;
  else
    update public.conversations
       set offered_slot_ids = null, status = 'resolved', resolved_at = now(),
           resolution_outcome = 'rebooked', updated_at = now()
     where id = p_conversation_id;
  end if;

  return json_build_object(
    'status','booked', 'slot_id', p_slot_id,
    'start_time', v_slot.start_time, 'doctor_name', v_slot.doctor_name,
    'vacated_slot_id', v_vacated
  );
end;
$$;

revoke all on function public.book_slot(uuid,uuid) from public;
grant execute on function public.book_slot(uuid,uuid) to service_role;
