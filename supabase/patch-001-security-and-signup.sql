-- ============================================================
-- Patch 001 — corrige el esquema que ya corriste en Supabase.
-- Ejecuta esto UNA VEZ en el SQL Editor de tu proyecto Pelukan (ya
-- existente), después de haber corrido el schema.sql original.
--
-- Qué arregla:
-- 1. Separa teléfono/domicilio/correo del dueño de la mascota en su propia
--    tabla, con permiso de base de datos para que un groomer NUNCA pueda
--    leerlos (ni siquiera saltándose la interfaz) — antes solo estaban
--    "ocultos" por una vista, que no era seguridad real.
-- 2. Permite que alguien que se está registrando por primera vez pueda
--    crear su propio negocio y su propio perfil de dueño (antes esto
--    estaba bloqueado sin querer, nadie hubiera podido registrarse).
-- ============================================================

-- 1. Mover teléfono/domicilio/correo a su propia tabla -----------------------
create table pet_owner_contacts (
  pet_owner_id uuid primary key references pet_owners(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  phone text,
  address text,
  email text,
  updated_at timestamptz not null default now()
);

-- Copia lo que ya exista en pet_owners (probablemente nada todavía)
insert into pet_owner_contacts (pet_owner_id, business_id, phone, address, email)
select id, business_id, phone, address, email from pet_owners
on conflict (pet_owner_id) do nothing;

alter table pet_owners drop column if exists phone;
alter table pet_owners drop column if exists address;
alter table pet_owners drop column if exists email;

drop view if exists pet_owners_for_groomer;

alter table pet_owner_contacts enable row level security;

create policy "pet_owner_contacts: solo dueño lee" on pet_owner_contacts
  for select using (business_id = current_business_id() and current_role_name() = 'owner');
create policy "pet_owner_contacts: cualquiera del negocio captura contacto" on pet_owner_contacts
  for insert with check (business_id = current_business_id());
create policy "pet_owner_contacts: solo dueño edita" on pet_owner_contacts
  for update using (business_id = current_business_id() and current_role_name() = 'owner');
create policy "pet_owner_contacts: solo dueño elimina" on pet_owner_contacts
  for delete using (business_id = current_business_id() and current_role_name() = 'owner');

-- 2. Permitir el registro inicial (crear negocio + perfil de dueño) ----------
create policy "businesses: crear al registrarse" on businesses
  for insert with check (auth.uid() is not null);
create policy "businesses: dueño edita su negocio" on businesses
  for update using (id = current_business_id() and current_role_name() = 'owner');

drop policy if exists "profiles: solo dueño crea personal" on profiles;
create policy "profiles: dueño crea personal, o te registras como dueño" on profiles
  for insert with check (
    (current_role_name() = 'owner' and business_id = current_business_id())
    or (id = auth.uid() and role = 'owner')
  );

-- 3. Políticas de eliminar que faltaban (rechazar fichas pendientes,
--    borrar un servicio del catálogo, etc.)
create policy "pets: dueño elimina o rechaza pendiente" on pets
  for delete using (business_id = current_business_id() and current_role_name() = 'owner');
create policy "pet_owners: dueño elimina o rechaza pendiente" on pet_owners
  for delete using (business_id = current_business_id() and current_role_name() = 'owner');
create policy "services: dueño elimina" on services
  for delete using (business_id = current_business_id() and current_role_name() = 'owner');
create policy "appointments: dueño elimina" on appointments
  for delete using (business_id = current_business_id() and current_role_name() = 'owner');
