-- ============================================================
-- Patch 005 — ficha de personal (igual que la de Todo Guau, sin nómina).
-- Corre esto en el SQL Editor de tu proyecto Pelukan.
-- ============================================================

-- Separada de "profiles" a propósito: profiles.full_name lo ve cualquiera
-- del negocio (se necesita para asignar citas), pero estos datos son
-- sensibles (médicos, CURP, contacto de emergencia) — igual que en Todo
-- Guau, un groomer debe poder ver SU propia ficha, pero nunca la de sus
-- compañeros.
create table if not exists staff_details (
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

alter table staff_details enable row level security;

drop policy if exists "staff_details: dueño ve todo, groomer ve lo suyo" on staff_details;
create policy "staff_details: dueño ve todo, groomer ve lo suyo" on staff_details
  for select using (
    business_id = current_business_id()
    and (current_role_name() = 'owner' or profile_id = auth.uid())
  );

drop policy if exists "staff_details: solo dueño crea" on staff_details;
create policy "staff_details: solo dueño crea" on staff_details
  for insert with check (business_id = current_business_id() and current_role_name() = 'owner');

drop policy if exists "staff_details: solo dueño edita" on staff_details;
create policy "staff_details: solo dueño edita" on staff_details
  for update using (business_id = current_business_id() and current_role_name() = 'owner');

drop policy if exists "staff_details: solo dueño elimina" on staff_details;
create policy "staff_details: solo dueño elimina" on staff_details
  for delete using (business_id = current_business_id() and current_role_name() = 'owner');
