-- 019: real multi-doctor agenda for the dev build.
--
-- (1) Seed the 3 clinica-sousa doctors into the `doctors` table (previously the
--     demo only had free-text doctor_name on slots, no doctor_id).
-- (2) seed_clinic_agenda(): generate 'available' vagas across each active
--     doctor's working day. Daily template (Europe/Lisbon), 30-min consultations,
--     09:00-18:00, 2 fifteen-minute breaks + a 1h lunch, ending exactly at 18:00:
--        09:00 09:30 10:00 10:30            (bloco 1)
--        -- pausa 11:00-11:15 --
--        11:15 11:45 12:15 12:45            (bloco 2)
--        -- almoco 13:15-14:15 --
--        14:15 14:45 15:15 15:45            (bloco 3)
--        -- pausa 16:15-16:30 --
--        16:30 17:00 17:30                  (bloco 4)  -> fecha 18:00
--     = 15 consultas/dia/medico. Weekdays only. Idempotent: skips a (doctor,time)
--     that already has a slot, and skips past times.
-- (3) Backfill doctor_id on the existing name-only demo slots.
--
-- NOTE: demo_reset() wipes all slots for this clinic (but NOT doctors); re-run
-- seed_clinic_agenda('clinica-sousa', 14) after a reset to repopulate the agenda.

-- (1) doctors ---------------------------------------------------------------
insert into public.doctors (clinic_id, name, specialty, is_active)
select c.id, d.name, d.specialty, true
from public.clinics c
cross join (values
  ('Dr. Sousa', 'Clínica Geral'),
  ('Dr. Silva', 'Clínica Geral'),
  ('Dra. Lima', 'Clínica Geral')
) as d(name, specialty)
where c.slug = 'clinica-sousa'
  and not exists (
    select 1 from public.doctors dd where dd.clinic_id = c.id and dd.name = d.name
  );

-- (3) backfill doctor_id on existing name-only slots ------------------------
update public.slots s
   set doctor_id = d.id
  from public.doctors d
 where s.doctor_id is null
   and s.clinic_id = d.clinic_id
   and s.doctor_name = d.name;

-- (2) agenda generator ------------------------------------------------------
create or replace function public.seed_clinic_agenda(
  p_clinic_slug text,
  p_days int default 14,
  p_start date default current_date
) returns json
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  v_clinic  uuid;
  v_doc     record;
  v_day     date;
  v_t       time;
  v_start   timestamptz;
  v_created int := 0;
  v_times   time[] := array[
    '09:00','09:30','10:00','10:30',
    '11:15','11:45','12:15','12:45',
    '14:15','14:45','15:15','15:45',
    '16:30','17:00','17:30'
  ]::time[];
begin
  select id into v_clinic from public.clinics where slug = p_clinic_slug;
  if v_clinic is null then
    return json_build_object('status','error','reason','clinic_not_found');
  end if;

  for i in 0 .. (p_days - 1) loop
    v_day := p_start + i;
    -- weekdays only (isodow: 6=Sat, 7=Sun)
    if extract(isodow from v_day) >= 6 then continue; end if;

    for v_doc in
      select id, name from public.doctors
       where clinic_id = v_clinic and coalesce(is_active, true)
    loop
      foreach v_t in array v_times loop
        v_start := ((v_day::text || ' ' || v_t::text)::timestamp)
                     at time zone 'Europe/Lisbon';
        -- skip past times and any existing slot for this doctor at this time
        if v_start <= now() then continue; end if;
        if exists (
          select 1 from public.slots s
           where s.clinic_id = v_clinic and s.start_time = v_start
             and (s.doctor_id = v_doc.id or s.doctor_name = v_doc.name)
        ) then continue; end if;

        insert into public.slots (clinic_id, doctor_id, doctor_name, start_time, end_time, status, notes)
        values (v_clinic, v_doc.id, v_doc.name, v_start, v_start + interval '30 minutes', 'available', 'agenda');
        v_created := v_created + 1;
      end loop;
    end loop;
  end loop;

  return json_build_object('status','ok','slots_created', v_created);
end $$;

revoke all on function public.seed_clinic_agenda(text,int,date) from public;
grant execute on function public.seed_clinic_agenda(text,int,date) to authenticated, service_role;
