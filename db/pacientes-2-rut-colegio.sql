-- Registro de pacientes, cambio 2: RUT, colegio y curso
-- Ejecutar en Supabase: Dashboard > SQL Editor > New query > pegar todo > Run
-- (después de pacientes.sql). No necesita reemplazar nada.

alter table public.patients
  add column rut text check (rut is null or char_length(rut) <= 12),
  add column school text check (school is null or char_length(school) <= 120),
  add column grade text check (grade is null or char_length(grade) <= 60);

-- Evita registrar dos veces al mismo paciente con el mismo RUT
create unique index patients_rut_unique on public.patients (rut) where rut is not null;
