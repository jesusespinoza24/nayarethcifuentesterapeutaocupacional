-- Registro de pacientes, cambio 4: previsión, pagos, pauta de evaluación e informe final
-- Ejecutar en Supabase: Dashboard > SQL Editor > New query > pegar todo > Run
-- (después de pacientes-3-objetivos.sql). Se puede ejecutar más de una vez sin problema.
--
-- ANTES DE EJECUTAR:
--   Reemplaza 'ADMIN_AUTH_UID_AQUI' (aparece 2 veces abajo) por el mismo User UID
--   de administradora que usaste en pacientes.sql.

-- ── Ficha: previsión de salud e informe final ───────────────────────────
alter table public.patients
  add column if not exists health_insurance text check (health_insurance is null or health_insurance in ('fonasa', 'isapre', 'particular')),
  add column if not exists final_report_date date,
  add column if not exists final_conclusions text check (final_conclusions is null or char_length(final_conclusions) <= 4000),
  add column if not exists final_recommendations text check (final_recommendations is null or char_length(final_recommendations) <= 4000);

-- ── Sesiones: tipo (evaluación o intervención) y si el pago está cancelado ──
alter table public.therapy_sessions
  add column if not exists kind text not null default 'intervencion' check (kind in ('evaluacion', 'intervencion')),
  add column if not exists paid boolean not null default false;

-- ── Pautas de evaluación aplicadas (normalmente en las sesiones 1 y 2) ──
create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  eval_date date not null default current_date,
  instrument text not null check (char_length(instrument) between 2 and 200),
  results text check (results is null or char_length(results) <= 4000),
  conclusions text check (conclusions is null or char_length(conclusions) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists evaluations_patient_idx on public.evaluations (patient_id, eval_date);

alter table public.evaluations enable row level security;

drop policy if exists "admin manage evaluations" on public.evaluations;
create policy "admin manage evaluations"
on public.evaluations for all to authenticated
using (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid)
with check (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid);
