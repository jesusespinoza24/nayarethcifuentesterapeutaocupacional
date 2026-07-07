-- Sistema de agendamiento — Nayareth Cifuentes, Terapeuta Ocupacional
-- Ejecutar completo en Supabase: Dashboard > SQL Editor > New query > pegar todo > Run
--
-- ANTES DE EJECUTAR:
--   1. Reemplaza 'ADMIN_AUTH_UID_AQUI' (aparece 3 veces abajo) por el UID real de tu
--      usuario de administrador. Para obtenerlo: Authentication > Users > crea tu usuario
--      (correo + contraseña) > copia el "User UID" que aparece en la lista.
--   2. Reemplaza 'RESEND_API_KEY_AQUI' por tu API key real de resend.com (Settings > API Keys).
--   3. Ve a Database > Extensions y activa "pg_net" si no aparece ya activada.

-- ── Tipos ────────────────────────────────────────────────────────────────
create type city_t as enum ('valdivia', 'la_union');
create type slot_status_t as enum ('available', 'blocked', 'booked');

-- ── Tablas ───────────────────────────────────────────────────────────────
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  city city_t not null,
  slot_date date not null,
  start_time time not null,
  end_time time not null,
  status slot_status_t not null default 'available',
  created_at timestamptz not null default now(),
  constraint valid_time_range check (end_time > start_time),
  constraint unique_slot unique (city, slot_date, start_time)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id),
  client_name   text not null check (char_length(client_name) between 2 and 100),
  client_phone  text not null check (client_phone ~ '^\+?[0-9 ]{8,15}$'),
  client_comuna text not null check (char_length(client_comuna) between 2 and 80),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

-- ── Regla de negocio: no mezclar ciudades el mismo día ──────────────────
create or replace function public.enforce_single_city_per_day()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.slots
    where slot_date = new.slot_date
      and city <> new.city
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000')
  ) then
    raise exception 'Ya existen horarios de otra ciudad para la fecha %', new.slot_date;
  end if;
  return new;
end; $$;

create trigger trg_single_city_per_day
before insert or update on public.slots
for each row execute function public.enforce_single_city_per_day();

-- ── Reserva atómica (sin condiciones de carrera) ────────────────────────
create or replace function public.book_slot(
  p_slot_id uuid, p_name text, p_phone text, p_comuna text, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_booking_id uuid;
begin
  update public.slots
     set status = 'booked'
   where id = p_slot_id and status = 'available' and slot_date >= current_date;

  if not found then
    raise exception 'SLOT_NOT_AVAILABLE';
  end if;

  insert into public.bookings (slot_id, client_name, client_phone, client_comuna, reason)
  values (p_slot_id, p_name, p_phone, p_comuna, p_reason)
  returning id into v_booking_id;

  return v_booking_id;
end; $$;

revoke all on function public.book_slot from public;
grant execute on function public.book_slot to anon, authenticated;

-- ── Seguridad (RLS) ──────────────────────────────────────────────────────
alter table public.slots enable row level security;
alter table public.bookings enable row level security;

create policy "public read available future slots"
on public.slots for select to anon, authenticated
using (status = 'available' and slot_date >= current_date);

-- Solo la cuenta de administradora puede crear/editar/borrar horarios.
-- Reemplaza ADMIN_AUTH_UID_AQUI por tu User UID real (ver instrucciones arriba).
create policy "admin manage slots"
on public.slots for all to authenticated
using (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid)
with check (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid);

create policy "admin read bookings"
on public.bookings for select to authenticated
using (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid);

create policy "admin update bookings"
on public.bookings for update to authenticated
using (auth.uid() = 'ADMIN_AUTH_UID_AQUI'::uuid);

-- Nota: no existe política de INSERT en "bookings" para anon/authenticated.
-- El único camino para crear una reserva es la función book_slot() (SECURITY DEFINER),
-- que evita condiciones de carrera y evita que cualquiera lea o escriba directo.

-- ── Aviso automático por correo (Resend, vía pg_net) ────────────────────
create extension if not exists pg_net;

alter database postgres set app.settings.resend_api_key = 'RESEND_API_KEY_AQUI';

create or replace function public.notify_new_booking()
returns trigger language plpgsql security definer as $$
declare v_slot record;
begin
  select * into v_slot from public.slots where id = new.slot_id;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.resend_api_key', true),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', 'Reservas Nayareth <onboarding@resend.dev>',
      'to', jsonb_build_array('to.nayarethcifuentes@gmail.com'),
      'subject', 'Nueva reserva: ' || v_slot.city || ' ' || v_slot.slot_date,
      'html', format(
        'Nombre: %s<br>Teléfono: %s<br>Comuna: %s<br>Motivo: %s<br>Fecha: %s %s–%s<br>Ciudad: %s',
        new.client_name, new.client_phone, new.client_comuna,
        coalesce(new.reason, '-'), v_slot.slot_date, v_slot.start_time, v_slot.end_time, v_slot.city
      )
    )
  );
  return new;
end; $$;

create trigger trg_notify_new_booking
after insert on public.bookings
for each row execute function public.notify_new_booking();
