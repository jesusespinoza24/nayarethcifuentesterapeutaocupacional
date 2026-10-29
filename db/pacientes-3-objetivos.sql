-- Registro de pacientes, cambio 3: motivo de consulta, objetivo general y estrategias
-- Ejecutar en Supabase: Dashboard > SQL Editor > New query > pegar todo > Run
-- (después de pacientes-2-rut-colegio.sql). No necesita reemplazar nada.

alter table public.patients
  add column consultation_reason text check (consultation_reason is null or char_length(consultation_reason) <= 1000),
  add column general_goal text check (general_goal is null or char_length(general_goal) <= 1000);

-- Los objetivos de la tabla goals pasan a ser los objetivos específicos, cada uno con sus estrategias
alter table public.goals
  add column strategies text check (strategies is null or char_length(strategies) <= 2000);
