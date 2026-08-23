-- ============================================================
-- Patch 002 — corrige recursión infinita en las funciones de apoyo de RLS.
-- Ejecuta esto UNA VEZ en el SQL Editor de tu proyecto Pelukan, después
-- del patch-001.
--
-- Qué arregla: current_business_id() y current_role_name() consultan la
-- tabla profiles, pero profiles también tiene RLS que usa esas mismas
-- funciones — sin "security definer", esa consulta interna vuelve a
-- disparar la política y entra en bucle infinito (error real que dio
-- Supabase: "stack depth limit exceeded").
-- ============================================================

create or replace function current_business_id()
returns uuid language sql stable security definer set search_path = public as $$
  select business_id from profiles where id = auth.uid()
$$;

create or replace function current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;
