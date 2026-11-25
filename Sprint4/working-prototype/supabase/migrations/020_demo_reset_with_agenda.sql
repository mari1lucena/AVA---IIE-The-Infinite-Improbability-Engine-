-- 020: demo_reset() now (a) books the demo scenario on the next OPEN weekday
-- (clinic closed Sat/Sun) and (b) calls seed_clinic_agenda to repopulate the
-- full 3-doctor agenda after the wipe. Demo booked slots use grid times so they
-- sit cleanly inside the agenda; availability now comes entirely from the seed.
create or replace function public.demo_reset()
returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  v_clinic uuid;
  v_ana uuid; v_bruno uuid; v_carla uuid;
  v_date date := (date_trunc('day', now()) + interval '1 day')::date;
  v_a timestamptz; v_b timestamptz; v_c timestamptz;
  v_seed json;
begin
  select id into v_clinic from public.clinics where slug = 'clinica-sousa';
  if v_clinic is null then
    return json_build_object('status','error','reason','clinic_not_found');
  end if;

  -- Next OPEN weekday (clinic closed Saturday and Sunday).
  while extract(isodow from v_date) >= 6 loop
    v_date := v_date + 1;
  end loop;

  select id into v_ana   from public.patients where clinic_id = v_clinic and phone = '+351912000001';
  select id into v_bruno from public.patients where clinic_id = v_clinic and phone = '+351912000002';
  select id into v_carla from public.patients where clinic_id = v_clinic and phone = '+351912000003';

  -- Wipe transactional data (FK-safe order).
  delete from public.messages m using public.conversations c
    where m.conversation_id = c.id and c.clinic_id = v_clinic;
  delete from public.escalation_queue where clinic_id = v_clinic;
  delete from public.cascade_offers   where clinic_id = v_clinic;
  delete from public.conversations    where clinic_id = v_clinic;
  delete from public.slots            where clinic_id = v_clinic;
  delete from public.patients where clinic_id = v_clinic and name like 'Novo contacto %';

  update public.patients set opted_out = false, opted_out_at = null, is_active = true
   where clinic_id = v_clinic;
  update public.patients set accepts_short_notice = true
   where id in (v_ana, v_bruno, v_carla);

  -- Three consecutive booked consultations with Dr. Sousa on the next open
  -- weekday (grid times), for the cascade / confirmation demo.
  v_a := (v_date::text || ' 11:15')::timestamp at time zone 'Europe/Lisbon';
  v_b := (v_date::text || ' 11:45')::timestamp at time zone 'Europe/Lisbon';
  v_c := (v_date::text || ' 12:15')::timestamp at time zone 'Europe/Lisbon';
  insert into public.slots (clinic_id, doctor_name, start_time, end_time, patient_id, status, booked_at, notes) values
   (v_clinic, 'Dr. Sousa', v_a, v_a + interval '30 minutes', v_ana,   'booked', now(), 'demo'),
   (v_clinic, 'Dr. Sousa', v_b, v_b + interval '30 minutes', v_bruno, 'booked', now(), 'demo'),
   (v_clinic, 'Dr. Sousa', v_c, v_c + interval '30 minutes', v_carla, 'booked', now(), 'demo');

  -- Fill the rest of the 3-doctor agenda (available vagas); skips the booked times.
  v_seed := public.seed_clinic_agenda('clinica-sousa', 14, current_date);

  -- Keep doctor_id consistent on the name-only demo slots.
  update public.slots s set doctor_id = d.id
    from public.doctors d
   where s.doctor_id is null and s.clinic_id = d.clinic_id and s.doctor_name = d.name;

  return json_build_object('status','reset', 'day', v_date, 'agenda', v_seed);
end $$;

revoke all on function public.demo_reset() from public;
grant execute on function public.demo_reset() to authenticated, service_role;
