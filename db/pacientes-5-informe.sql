-- Registro de pacientes, cambio 5: ficha clínica completa, varios objetivos generales y puntajes de evaluación
-- Ejecutar en Supabase: Dashboard > SQL Editor > New query > pegar todo > Run
-- (después de pacientes-4-proceso.sql). Se puede ejecutar más de una vez sin problema.
--
-- ANTES DE EJECUTAR:
--   Reemplaza 'ADMIN_AUTH_UID_AQUI' (aparece 2 veces abajo) por el mismo User UID
--   de administradora que usaste en pacientes.sql.

-- ── Ficha clínica: antecedentes, observación, áreas de la ocupación, diagnóstico
--    ocupacional y modelos de intervención (cada sección es un campo de texto) ──
alter table public.patients
  add column if not exists clinical jsonb not null default '{}'::jsonb;

-- ── Objetivos generales: cada uno agrupa sus objetivos específicos ───────
create table if not exists public.general_goals (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 500),
  period text check (period is null or char_length(period) <= 100),
  strategies text check (strategies is null or char_length(strategies) <= 3000),
  activities text check (activities is null or char_length(activities) <= 6000),
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists general_goals_patient_idx on public.general_goals (patient_id, position);

alter table public.general_goals enable row level security;

drop policy if exists "admin manage general goals" on public.general_goals;
create policy "admin manage general goals"
on public.general_goals for all to authenticated
using (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid)
with check (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid);

alter table public.goals
  add column if not exists general_goal_id uuid references public.general_goals(id) on delete set null;

-- ── Evaluaciones: descripción del instrumento y tabla de puntajes ───────
alter table public.evaluations
  add column if not exists description text check (description is null or char_length(description) <= 4000),
  add column if not exists scores jsonb not null default '[]'::jsonb;

-- ── Pasar el objetivo general que ya existía (uno por paciente) a la tabla nueva ──
insert into public.general_goals (patient_id, title, strategies)
select p.id,
       coalesce(nullif(trim(p.general_goal), ''), 'Objetivo general'),
       (select string_agg(g.strategies, E'\n') from public.goals g
         where g.patient_id = p.id and g.strategies is not null)
from public.patients p
where (nullif(trim(p.general_goal), '') is not null
       or exists (select 1 from public.goals g where g.patient_id = p.id))
  and not exists (select 1 from public.general_goals gg where gg.patient_id = p.id);

update public.goals g
   set general_goal_id = gg.id
  from public.general_goals gg
 where gg.patient_id = g.patient_id
   and g.general_goal_id is null
   and (select count(*) from public.general_goals x where x.patient_id = g.patient_id) = 1;
