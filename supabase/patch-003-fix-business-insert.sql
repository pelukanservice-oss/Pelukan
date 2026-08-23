-- ============================================================
-- Patch 003 — asegura que exista la política que permite crear un
-- negocio nuevo al registrarte. Seguro de correr aunque ya la hayas
-- corrido antes (usa DROP IF EXISTS antes de crear cada una).
-- ============================================================

drop policy if exists "businesses: crear al registrarse" on businesses;
create policy "businesses: crear al registrarse" on businesses
  for insert with check (auth.uid() is not null);

drop policy if exists "businesses: dueño edita su negocio" on businesses;
create policy "businesses: dueño edita su negocio" on businesses
  for update using (id = current_business_id() and current_role_name() = 'owner');

drop policy if exists "profiles: solo dueño crea personal" on profiles;
drop policy if exists "profiles: dueño crea personal, o te registras como dueño" on profiles;
create policy "profiles: dueño crea personal, o te registras como dueño" on profiles
  for insert with check (
    (current_role_name() = 'owner' and business_id = current_business_id())
    or (id = auth.uid() and role = 'owner')
  );
