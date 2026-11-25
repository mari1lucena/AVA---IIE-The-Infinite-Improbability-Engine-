-- 013: demo_reset() — one call to wipe transactional data for the demo clinic
-- (clinica-sousa) and reseed the clean Ana/Bruno/Carla scenario. Used by the
-- "Repor demo" button in /agenda and runnable directly: select demo_reset();

create or replace function public.demo_reset()
returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  v_clinic uuid;
  v_ana uuid; v_bruno uuid; v_carla uuid;
  v_day timestamptz := date_trunc('day', now()) + interval '1 day';
begin
  select id into v_clinic from public.clinics where slug = 'clinica-sousa';
  if v_clinic is null then
    return json_build_object('status','error','reason','clinic_not_found');
  end if;
  select id into v_ana   from public.patients where clinic_id = v_clinic and phone = '+351912000001';
  select id into v_bruno from public.patients where clinic_id = v_clinic and phone = '+351912000002';
  select id into v_carla from public.patients where clinic_id = v_clinic and phone = '+351912000003';

  -- Wipe transactional data for this clinic (FK-safe order).
  delete from public.messages m using public.conversations c
    where m.conversation_id = c.id and c.clinic_id = v_clinic;
  delete from public.escalation_queue where clinic_id = v_clinic;
  delete from public.cascade_offers   where clinic_id = v_clinic;
  delete from public.conversations    where clinic_id = v_clinic;
  delete from public.slots            where clinic_id = v_clinic;
  -- Drop auto-created "Novo contacto" profiles from unknown-number inbound
  -- (now unreferenced after the wipes above).
  delete from public.patients where clinic_id = v_clinic and name like 'Novo contacto %';

  -- Reset patient flags (opt everyone back in, active). Leave accepts_short_notice
  -- as-is for the extra patients (variety/controls), but force it on for the three
  -- core demo patients so the cascade demo always works.
  update public.patients set opted_out = false, opted_out_at = null, is_active = true
   where clinic_id = v_clinic;
  update public.patients set accepts_short_notice = true
   where id in (v_ana, v_bruno, v_carla);

  -- Booked appointments tomorrow (cascade / confirmation demo).
  insert into public.slots (clinic_id,start_time,end_time,doctor_name,patient_id,status,booked_at,notes) values
   (v_clinic, v_day+interval '11 hours', v_day+interval '11 hours 30 min','Dr. Sousa', v_ana,  'booked', now(),'demo'),
   (v_clinic, v_day+interval '12 hours', v_day+interval '12 hours 30 min','Dr. Sousa', v_bruno,'booked', now(),'demo'),
   (v_clinic, v_day+interval '13 hours', v_day+interval '13 hours 30 min','Dr. Sousa', v_carla,'booked', now(),'demo');

  -- Open slots (reschedule / pull-forward demo).
  insert into public.slots (clinic_id,start_time,end_time,doctor_name,status,notes) values
   (v_clinic, v_day+interval '9 hours 30 min', v_day+interval '10 hours','Dra. Lima','available','avail'),
   (v_clinic, v_day+interval '16 hours', v_day+interval '16 hours 30 min','Dr. Sousa','available','avail'),
   (v_clinic, v_day+interval '1 day 10 hours', v_day+interval '1 day 10 hours 30 min','Dra. Lima','available','avail');

  return json_build_object('status','reset', 'day', v_day::date);
end $$;

-- Demo tool: allow the signed-in staff app (authenticated) + service_role to run it.
revoke all on function public.demo_reset() from public;
grant execute on function public.demo_reset() to authenticated, service_role;
