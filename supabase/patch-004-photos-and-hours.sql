-- ============================================================
-- Patch 004 — fotos (fichas + resultado de servicio) y horario del negocio.
-- Corre esto en el SQL Editor de tu proyecto Pelukan.
-- ============================================================

-- 1. Horario general del negocio (el "turno") -------------------------------
alter table businesses add column if not exists opens_at time not null default '09:00';
alter table businesses add column if not exists closes_at time not null default '18:00';

-- 2. Notas y foto de resultado por cita (para la próxima visita) ------------
alter table appointments add column if not exists service_notes text;
alter table appointments add column if not exists result_photo_url text;

-- 3. Bucket de almacenamiento para fotos -------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

-- Estructura de carpetas dentro del bucket: photos/{business_id}/...
-- Lectura pública (para poder mostrar las fotos en la app sin firmar URLs),
-- pero solo alguien del negocio correspondiente puede subir/borrar dentro
-- de su propia carpeta.
drop policy if exists "photos: lectura pública" on storage.objects;
create policy "photos: lectura pública" on storage.objects
  for select using (bucket_id = 'photos');

drop policy if exists "photos: solo el negocio sube a su carpeta" on storage.objects;
create policy "photos: solo el negocio sube a su carpeta" on storage.objects
  for insert with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = current_business_id()::text
  );

drop policy if exists "photos: solo el negocio borra de su carpeta" on storage.objects;
create policy "photos: solo el negocio borra de su carpeta" on storage.objects
  for delete using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = current_business_id()::text
  );
