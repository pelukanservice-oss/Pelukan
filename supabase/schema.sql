-- ============================================================
-- Pelukan — SaaS para peluquerías/estéticas caninas (grooming)
-- Esquema MVP v1 — multi-tenant, aislamiento por negocio vía RLS
-- Fecha: 2026-08-22 (v2: separa datos de contacto en su propia tabla,
-- para que el ocultamiento a groomers sea real a nivel de base de datos,
-- no solo en la interfaz)
--
-- Alcance: MVP v1 solamente (fichas, calendario, catálogo de servicios,
-- panel financiero simple, personal básico). Inventario completo, personal
-- avanzado (turnos/comisiones) y check-in/checkout con carta responsiva
-- quedan para segunda/tercera ola — no están en este esquema todavía.
--
-- Requiere Postgres con pgcrypto/pgsodium para gen_random_uuid() (ya viene
-- habilitado por defecto en proyectos nuevos de Supabase).
-- ============================================================

-- 1. Negocios (tenants) ------------------------------------------------------
create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subscription_tier text not null default 'solo'
    check (subscription_tier in ('solo', 'equipo', 'estudio', 'negocio_plus')),
  subscription_status text not null default 'trialing'
    check (subscription_status in ('trialing', 'active', 'past_due', 'canceled')),
  stripe_customer_id text,
  stripe_subscription_id text,
  opens_at time not null default '09:00',   -- horario general del negocio ("turno")
  closes_at time not null default '18:00',
  created_at timestamptz not null default now()
);

-- 2. Perfiles de usuario (dueño / groomer) -----------------------------------
-- Extiende auth.users de Supabase. El dueño se registra normal (signup);
-- los groomers se crean desde un backend con la service role key (el dueño
-- les da usuario/contraseña directo, sin invitación por correo).
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  role text not null check (role in ('owner', 'groomer')),
  full_name text not null,
  created_at timestamptz not null default now()
);

create index profiles_business_id_idx on profiles(business_id);

-- Funciones de apoyo para las políticas RLS de abajo.
-- OJO: deben ser "security definer" — si no, al evaluar la política RLS de
-- profiles (que usa estas mismas funciones) se vuelve a disparar la propia
-- política sobre la consulta interna de la función, y eso entra en un
-- bucle infinito ("stack depth limit exceeded"). Con security definer, la
-- consulta interna corre con el dueño de la función (no sujeto a RLS de
-- profiles) y no se recursiona.
create or replace function current_business_id()
returns uuid language sql stable security definer set search_path = public as $$
  select business_id from profiles where id = auth.uid()
$$;

create or replace function current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

-- 2b. Ficha de personal (igual que Todo Guau, sin nómina) -------------------
-- Separada de profiles a propósito: full_name lo ve cualquiera del negocio
-- (se necesita para asignar citas), pero esto es sensible (médico, CURP,
-- contacto de emergencia) — un groomer ve su propia ficha, nunca la de
-- sus compañeros.
create table staff_details (
  profile_id uuid primary key references profiles(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  phone text,
  birth_date date,
  address text,
  curp text,
  emergency_contact_name text,
  emergency_contact_phone text,
  blood_type text,
  medical_conditions text,
  medications text,
  allergies text,
  notes text,
  status text not null default 'activo' check (status in ('activo', 'inactivo')),
  updated_at timestamptz not null default now()
);

-- 3. Dueños de mascotas (clientes del negocio) -------------------------------
-- OJO: a propósito NO tiene teléfono/domicilio/correo aquí — eso vive en
-- pet_owner_contacts (tabla 3b) con su propio permiso, para que un groomer
-- nunca pueda leerlos, ni siquiera consultando la tabla directo por API.
create table pet_owners (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  full_name text not null,
  review_status text not null default 'approved'
    check (review_status in ('pending', 'approved')),
  created_by uuid references profiles(id),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index pet_owners_business_id_idx on pet_owners(business_id);

-- 3b. Datos de contacto del dueño de la mascota ------------------------------
-- Separada de pet_owners para poder restringir el SELECT solo al rol
-- 'owner' del negocio a nivel de base de datos (protege la cartera de
-- clientes si un groomer deja el negocio).
create table pet_owner_contacts (
  pet_owner_id uuid primary key references pet_owners(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  phone text,
  address text,
  email text,
  updated_at timestamptz not null default now()
);

-- 4. Fichas de mascotas -------------------------------------------------------
create table pets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  pet_owner_id uuid not null references pet_owners(id) on delete cascade,
  name text not null,
  breed text,
  size text check (size in ('chico', 'mediano', 'grande')),
  age_years numeric,
  temperament text,
  allergies text,
  photo_url text,
  review_status text not null default 'approved'
    check (review_status in ('pending', 'approved')),
  created_by uuid references profiles(id),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index pets_business_id_idx on pets(business_id);
create index pets_pet_owner_id_idx on pets(pet_owner_id);

-- 5. Solicitudes de edición pendientes ----------------------------------------
-- El groomer propone cambios a una ficha ya existente sin tocar el dato en
-- firme; el dueño aprueba o rechaza. Mientras tanto, la ficha (tabla pets)
-- sigue con su valor aprobado y se puede usar con normalidad.
create table pet_edit_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  pet_id uuid not null references pets(id) on delete cascade,
  proposed_changes jsonb not null, -- ej. {"allergies": "pulgas", "temperament": "nervioso"}
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by uuid references profiles(id),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index pet_edit_requests_business_id_idx on pet_edit_requests(business_id);

-- 6. Catálogo de servicios -----------------------------------------------------
create table services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null,
  price numeric(10,2) not null,
  estimated_supply_cost numeric(10,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index services_business_id_idx on services(business_id);

-- 7. Citas ----------------------------------------------------------------------
create table appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  pet_id uuid not null references pets(id) on delete restrict,
  service_id uuid not null references services(id) on delete restrict,
  groomer_id uuid references profiles(id),
  scheduled_at timestamptz not null,
  duration_minutes integer not null,   -- copiado del servicio al agendar
  price_charged numeric(10,2) not null, -- copiado del servicio, editable (descuentos)
  status text not null default 'agendado'
    check (status in ('agendado', 'confirmado', 'en_proceso', 'completado', 'cancelado', 'no_show')),
  service_notes text,       -- qué se le hizo exactamente, para referencia en la próxima visita
  result_photo_url text,    -- foto del resultado del servicio
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index appointments_business_id_idx on appointments(business_id);
create index appointments_groomer_id_idx on appointments(groomer_id);
create index appointments_scheduled_at_idx on appointments(scheduled_at);

-- 8. Movimientos financieros (ingresos y egresos) --------------------------------
create table transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  type text not null check (type in ('ingreso', 'egreso')),
  amount numeric(10,2) not null,
  description text,
  category text, -- ej. 'servicio', 'insumos', 'renta', 'sueldos'
  appointment_id uuid references appointments(id), -- liga un ingreso a la cita que lo generó
  occurred_on date not null default current_date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index transactions_business_id_idx on transactions(business_id);
create index transactions_occurred_on_idx on transactions(occurred_on);

-- ============================================================
-- Row Level Security — aislamiento por negocio (tenant)
-- ============================================================

alter table businesses enable row level security;
alter table profiles enable row level security;
alter table staff_details enable row level security;
alter table pet_owners enable row level security;
alter table pet_owner_contacts enable row level security;
alter table pets enable row level security;
alter table pet_edit_requests enable row level security;
alter table services enable row level security;
alter table appointments enable row level security;
alter table transactions enable row level security;

-- businesses: cada quien ve solo su propio negocio; cualquier persona
-- autenticada puede crear una (es el paso de "registrar mi negocio")
create policy "businesses: ver el propio" on businesses
  for select using (id = current_business_id());
create policy "businesses: crear al registrarse" on businesses
  for insert with check (auth.uid() is not null);
create policy "businesses: dueño edita su negocio" on businesses
  for update using (id = current_business_id() and current_role_name() = 'owner');

-- profiles: todos dentro del negocio se ven entre sí. Para crear perfiles,
-- dos casos: (a) el dueño da de alta a un groomer, o (b) alguien se acaba
-- de registrar y crea SU PROPIO perfil de dueño (por eso no puede exigirse
-- current_role_name() = 'owner' en todos los casos: la primera vez que te
-- registras todavía no tienes perfil, sería un candado sin llave).
create policy "profiles: ver compañeros del negocio" on profiles
  for select using (business_id = current_business_id());
create policy "profiles: dueño crea personal, o te registras como dueño" on profiles
  for insert with check (
    (current_role_name() = 'owner' and business_id = current_business_id())
    or (id = auth.uid() and role = 'owner')
  );
create policy "profiles: solo dueño edita personal" on profiles
  for update using (current_role_name() = 'owner' and business_id = current_business_id());
create policy "profiles: solo dueño elimina personal" on profiles
  for delete using (current_role_name() = 'owner' and business_id = current_business_id());

-- staff_details: dueño ve/edita todo, groomer solo ve la SUYA (nunca la de compañeros)
create policy "staff_details: dueño ve todo, groomer ve lo suyo" on staff_details
  for select using (
    business_id = current_business_id()
    and (current_role_name() = 'owner' or profile_id = auth.uid())
  );
create policy "staff_details: solo dueño crea" on staff_details
  for insert with check (business_id = current_business_id() and current_role_name() = 'owner');
create policy "staff_details: solo dueño edita" on staff_details
  for update using (business_id = current_business_id() and current_role_name() = 'owner');
create policy "staff_details: solo dueño elimina" on staff_details
  for delete using (business_id = current_business_id() and current_role_name() = 'owner');

-- pet_owners: mismo negocio ve/crea; el dueño aprueba en firme, o el autor
-- puede seguir editando mientras esté pendiente de revisión
create policy "pet_owners: mismo negocio" on pet_owners
  for select using (business_id = current_business_id());
create policy "pet_owners: crear en el propio negocio" on pet_owners
  for insert with check (business_id = current_business_id());
create policy "pet_owners: dueño aprueba, o autor mientras esté pendiente" on pet_owners
  for update using (
    business_id = current_business_id()
    and (current_role_name() = 'owner' or (review_status = 'pending' and created_by = auth.uid()))
  );

-- pet_owner_contacts: CUALQUIERA del negocio puede capturar el contacto al
-- registrar un cliente nuevo (insert), pero SOLO el dueño puede leerlo o
-- editarlo después — esto es lo que de verdad protege la cartera de
-- clientes, no una vista ni una regla de la interfaz.
create policy "pet_owner_contacts: solo dueño lee" on pet_owner_contacts
  for select using (business_id = current_business_id() and current_role_name() = 'owner');
create policy "pet_owner_contacts: cualquiera del negocio captura contacto" on pet_owner_contacts
  for insert with check (business_id = current_business_id());
create policy "pet_owner_contacts: solo dueño edita" on pet_owner_contacts
  for update using (business_id = current_business_id() and current_role_name() = 'owner');
create policy "pet_owner_contacts: solo dueño elimina" on pet_owner_contacts
  for delete using (business_id = current_business_id() and current_role_name() = 'owner');

-- pets: mismo patrón que pet_owners
create policy "pets: mismo negocio" on pets
  for select using (business_id = current_business_id());
create policy "pets: crear en el propio negocio" on pets
  for insert with check (business_id = current_business_id());
create policy "pets: dueño aprueba en firme" on pets
  for update using (business_id = current_business_id() and current_role_name() = 'owner');
create policy "pets: dueño elimina o rechaza pendiente" on pets
  for delete using (business_id = current_business_id() and current_role_name() = 'owner');

create policy "pet_owners: dueño elimina o rechaza pendiente" on pet_owners
  for delete using (business_id = current_business_id() and current_role_name() = 'owner');

-- pet_edit_requests: cualquiera del negocio propone, solo el dueño resuelve
create policy "pet_edit_requests: mismo negocio" on pet_edit_requests
  for select using (business_id = current_business_id());
create policy "pet_edit_requests: proponer cambio" on pet_edit_requests
  for insert with check (business_id = current_business_id());
create policy "pet_edit_requests: solo dueño resuelve" on pet_edit_requests
  for update using (business_id = current_business_id() and current_role_name() = 'owner');

-- services: todos ven el catálogo, solo el dueño lo administra
create policy "services: mismo negocio" on services
  for select using (business_id = current_business_id());
create policy "services: solo dueño crea" on services
  for insert with check (business_id = current_business_id() and current_role_name() = 'owner');
create policy "services: solo dueño edita" on services
  for update using (business_id = current_business_id() and current_role_name() = 'owner');
create policy "services: solo dueño elimina" on services
  for delete using (business_id = current_business_id() and current_role_name() = 'owner');

-- appointments: todos ven la agenda del negocio; solo el dueño agenda,
-- edita y cambia el estado (completado/no_show, etc.)
create policy "appointments: mismo negocio" on appointments
  for select using (business_id = current_business_id());
create policy "appointments: solo dueño agenda" on appointments
  for insert with check (business_id = current_business_id() and current_role_name() = 'owner');
create policy "appointments: solo dueño actualiza estado" on appointments
  for update using (business_id = current_business_id() and current_role_name() = 'owner');
create policy "appointments: solo dueño elimina" on appointments
  for delete using (business_id = current_business_id() and current_role_name() = 'owner');

-- transactions: panel financiero solo visible/editable por el dueño
create policy "transactions: solo dueño" on transactions
  for all using (business_id = current_business_id() and current_role_name() = 'owner');

-- ============================================================
-- Almacenamiento de fotos (fichas de mascotas + resultado de servicio)
-- Carpetas dentro del bucket: photos/{business_id}/...
-- ============================================================
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

create policy "photos: lectura pública" on storage.objects
  for select using (bucket_id = 'photos');

create policy "photos: solo el negocio sube a su carpeta" on storage.objects
  for insert with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = current_business_id()::text
  );

create policy "photos: solo el negocio borra de su carpeta" on storage.objects
  for delete using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = current_business_id()::text
  );
