-- Función temporal solo para diagnosticar. La podemos borrar después con:
-- drop function debug_whoami();
create or replace function debug_whoami()
returns uuid language sql stable as $$
  select auth.uid()
$$;
