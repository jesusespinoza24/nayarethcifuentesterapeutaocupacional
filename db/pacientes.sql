-- Registro de pacientes — Nayareth Cifuentes, Terapeuta Ocupacional
-- Ejecutar completo en Supabase: Dashboard > SQL Editor > New query > pegar todo > Run
-- (después de schema.sql, que ya creó la cuenta de administradora).
--
-- ANTES DE EJECUTAR:
--   Reemplaza 'ADMIN_AUTH_UID_AQUI' (aparece 8 veces abajo) por el mismo User UID
--   de administradora que usaste en schema.sql (Authentication > Users > "User UID").
--   Así solo esa cuenta puede ver y editar las fichas; nadie más puede leerlas.

-- ── Tipos ────────────────────────────────────────────────────────────────
create type patient_status_t as enum ('activo', 'pausa', 'alta');
create type goal_status_t as enum ('pendiente', 'en_progreso', 'logrado');
create type goal_area_t as enum (
  'motricidad_fina', 'avd', 'motricidad_gruesa',
  'sensorial', 'cognicion_juego', 'social_conducta'
);

-- ── Tablas ───────────────────────────────────────────────────────────────
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 120),
  birth_date date,
  diagnosis text check (diagnosis is null or char_length(diagnosis) <= 300),
  guardian_name text check (guardian_name is null or char_length(guardian_name) <= 120),
  guardian_phone text check (guardian_phone is null or char_length(guardian_phone) <= 30),
  comuna text check (comuna is null or char_length(comuna) <= 80),
  notes text check (notes is null or char_length(notes) <= 2000),
  status patient_status_t not null default 'activo',
  created_at timestamptz not null default now()
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  area goal_area_t not null,
  title text not null check (char_length(title) between 2 and 200),
  description text check (description is null or char_length(description) <= 1000),
  target_date date,
  progress smallint not null default 0 check (progress between 0 and 100),
  status goal_status_t not null default 'pendiente',
  created_at timestamptz not null default now()
);

-- Cada vez que se registra un avance queda una fila aquí (historial para el gráfico)
create table public.goal_progress (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  progress smallint not null check (progress between 0 and 100),
  note text check (note is null or char_length(note) <= 500),
  recorded_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.therapy_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_date date not null default current_date,
  activities text check (activities is null or char_length(activities) <= 2000),
  observations text check (observations is null or char_length(observations) <= 2000),
  participation smallint check (participation is null or participation between 1 and 5),
  created_at timestamptz not null default now()
);

create index goals_patient_idx on public.goals (patient_id);
create index goal_progress_goal_idx on public.goal_progress (goal_id, recorded_on);
create index therapy_sessions_patient_idx on public.therapy_sessions (patient_id, session_date desc);

-- ── El último avance registrado actualiza el % y el estado del objetivo ──
create or replace function public.apply_goal_progress()
returns trigger language plpgsql as $$
begin
  update public.goals
     set progress = new.progress,
         status = case
           when new.progress >= 100 then 'logrado'::goal_status_t
           when new.progress > 0 then 'en_progreso'::goal_status_t
           else 'pendiente'::goal_status_t
         end
   where id = new.goal_id;
  return new;
end; $$;

create trigger trg_apply_goal_progress
after insert on public.goal_progress
for each row execute function public.apply_goal_progress();

-- ── Seguridad (RLS): solo la cuenta de administradora ────────────────────
alter table public.patients enable row level security;
alter table public.goals enable row level security;
alter table public.goal_progress enable row level security;
alter table public.therapy_sessions enable row level security;

create policy "admin manage patients"
on public.patients for all to authenticated
using (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid)
with check (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid);

create policy "admin manage goals"
on public.goals for all to authenticated
using (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid)
with check (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid);

create policy "admin manage goal progress"
on public.goal_progress for all to authenticated
using (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid)
with check (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid);

create policy "admin manage therapy sessions"
on public.therapy_sessions for all to authenticated
using (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid)
with check (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid);
