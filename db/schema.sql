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
-- Nota: Supabase no permite "alter database ... set" desde el SQL Editor
-- (falta de permiso de superusuario), así que la API key va directo en el
-- cuerpo de la función. Sigue siendo privada: solo visible para quien tenga
-- acceso a tu proyecto de Supabase, nunca se sube al repositorio de GitHub.
create extension if not exists pg_net;

create or replace function public.notify_new_booking()
returns trigger language plpgsql security definer as $$
declare
  v_slot record;
  v_city_label text;
  v_date_label text;
  v_html text;
begin
  select * into v_slot from public.slots where id = new.slot_id;

  v_city_label := case v_slot.city when 'valdivia' then 'Valdivia' when 'la_union' then 'La Unión' end;

  v_date_label := extract(day from v_slot.slot_date)::text || ' de ' ||
    (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
           'septiembre','octubre','noviembre','diciembre'])[extract(month from v_slot.slot_date)::int]
    || ' de ' || extract(year from v_slot.slot_date)::text;

  v_html := format(
    '<div style="font-family:Arial,Helvetica,sans-serif;background:#f3f6f5;padding:32px 16px;">' ||
    '<table role="presentation" width="100%%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dcece6;">' ||
      '<tr><td style="background:#2f9e82;padding:22px 28px;">' ||
        '<table role="presentation"><tr>' ||
          '<td style="width:44px;vertical-align:middle;"><div style="width:40px;height:40px;border-radius:50%%;background:#ffffff;color:#2f9e82;font-weight:bold;font-size:15px;text-align:center;line-height:40px;">NC</div></td>' ||
          '<td style="vertical-align:middle;padding-left:12px;">' ||
            '<div style="color:#ffffff;font-size:16px;font-weight:bold;">Nayareth Cifuentes Fuchslocher</div>' ||
            '<div style="color:#e7f5f0;font-size:12px;">Terapeuta Ocupacional</div>' ||
          '</td>' ||
        '</tr></table>' ||
      '</td></tr>' ||
      '<tr><td style="padding:28px;">' ||
        '<p style="margin:0 0 6px;color:#1f6f5c;font-size:12px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;">Nueva reserva</p>' ||
        '<h2 style="margin:0 0 22px;color:#1e2a28;font-size:19px;">Tienes una hora agendada</h2>' ||
        '<table role="presentation" width="100%%" style="border-collapse:collapse;">' ||
          '<tr><td style="padding:9px 0;border-bottom:1px solid #eef3f1;color:#506b66;font-size:12px;width:110px;">Paciente</td><td style="padding:9px 0;border-bottom:1px solid #eef3f1;color:#1e2a28;font-size:14px;font-weight:bold;">%s</td></tr>' ||
          '<tr><td style="padding:9px 0;border-bottom:1px solid #eef3f1;color:#506b66;font-size:12px;">Teléfono</td><td style="padding:9px 0;border-bottom:1px solid #eef3f1;color:#1e2a28;font-size:14px;">%s</td></tr>' ||
          '<tr><td style="padding:9px 0;border-bottom:1px solid #eef3f1;color:#506b66;font-size:12px;">Comuna</td><td style="padding:9px 0;border-bottom:1px solid #eef3f1;color:#1e2a28;font-size:14px;">%s</td></tr>' ||
          '<tr><td style="padding:9px 0;color:#506b66;font-size:12px;">Motivo</td><td style="padding:9px 0;color:#1e2a28;font-size:14px;">%s</td></tr>' ||
        '</table>' ||
        '<table role="presentation" width="100%%" style="margin-top:20px;background:#e7f5f0;border-radius:10px;">' ||
          '<tr><td style="padding:16px 18px;">' ||
            '<div style="color:#1f6f5c;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;">Cita agendada</div>' ||
            '<div style="color:#1e2a28;font-size:15px;font-weight:bold;">%s — %s</div>' ||
            '<div style="color:#1e2a28;font-size:15px;">%s a %s hrs</div>' ||
          '</td></tr>' ||
        '</table>' ||
        '<hr style="border:none;border-top:1px solid #eef3f1;margin:26px 0 20px;">' ||
        '<table role="presentation"><tr>' ||
          '<td style="width:40px;vertical-align:top;"><div style="width:36px;height:36px;border-radius:50%%;background:#e7f5f0;color:#1f6f5c;font-weight:bold;font-size:13px;text-align:center;line-height:36px;">NC</div></td>' ||
          '<td style="padding-left:12px;">' ||
            '<div style="color:#1e2a28;font-size:14px;font-weight:bold;">Nayareth Cifuentes Fuchslocher</div>' ||
            '<div style="color:#506b66;font-size:12px;margin-top:2px;">Terapeuta Ocupacional · Registro SIS N° 935279</div>' ||
            '<div style="color:#506b66;font-size:12px;margin-top:2px;">Universidad San Sebastián, sede Valdivia</div>' ||
            '<div style="color:#1f6f5c;font-size:12px;margin-top:10px;line-height:1.7;">' ||
              'to.nayarethcifuentes@gmail.com<br>' ||
              '+56 9 XXXX XXXX<br>' ||
              'jesusespinoza24.github.io/nayarethcifuentesterapeutaocupacional' ||
            '</div>' ||
          '</td>' ||
        '</tr></table>' ||
      '</td></tr>' ||
      '<tr><td style="background:#f6f8f7;padding:16px 28px;border-top:1px solid #eef3f1;">' ||
        '<p style="margin:0;color:#506b66;font-size:11px;">Aviso automático de tu sitio de agendamiento · Terapia Ocupacional a domicilio · Valdivia y La Unión, Región de Los Ríos</p>' ||
      '</td></tr>' ||
    '</table></div>',
    new.client_name, new.client_phone, new.client_comuna, coalesce(new.reason, '-'),
    v_city_label, v_date_label, v_slot.start_time::text, v_slot.end_time::text
  );

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer RESEND_API_KEY_AQUI',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', 'Nayareth Cifuentes - Terapia Ocupacional <onboarding@resend.dev>',
      'to', jsonb_build_array('to.nayarethcifuentes@gmail.com'),
      'subject', 'Nueva reserva · ' || v_city_label || ' · ' || v_date_label,
      'html', v_html
    )
  );
  return new;
end; $$;

create trigger trg_notify_new_booking
after insert on public.bookings
for each row execute function public.notify_new_booking();
