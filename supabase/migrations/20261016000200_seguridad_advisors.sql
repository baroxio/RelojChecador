-- Corrige los avisos del Security Advisor de Supabase tras el esquema inicial.
--
-- 1. btree_gist estaba en public: se mueve al esquema extensions.
-- 2. Las funciones de apoyo de RLS (security definer) eran invocables desde la API REST
--    (/rest/v1/rpc/...). Se mueven al esquema `private`, que la API no expone. Las políticas
--    RLS siguen funcionando porque guardan la función por identificador, no por nombre.
-- 3. Las funciones de trigger no necesitan permiso de ejecución para los usuarios.
--
-- Queda a propósito public.resolver_correccion(): el panel la llama por RPC y valida
-- rol y alcance dentro de la función. El aviso de ese caso es esperado.

-- 1. Extensión ---------------------------------------------------------------
create schema if not exists extensions;
alter extension btree_gist set schema extensions;

-- 2. Funciones de apoyo de RLS a un esquema no expuesto ----------------------
create schema if not exists private;
grant usage on schema private to authenticated;

alter function public.empresas_del_usuario()                      set schema private;
alter function public.tiene_rol(uuid, public.rol_miembro[])       set schema private;
alter function public.puede_ver_sede(uuid, uuid)                  set schema private;
alter function public.puede_ver_empleado(uuid)                    set schema private;
alter function public.puede_ver_ruta_selfie(text)                 set schema private;

-- Estas tres llaman a otras funciones por nombre, así que se recrean con la nueva ruta.
create or replace function private.puede_ver_empleado(p_empleado uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.puede_ver_sede(e.empresa_id, e.sede_id)
                     from public.empleados e where e.id = p_empleado), false)
$$;

create or replace function private.puede_ver_ruta_selfie(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  partes text[] := string_to_array(p_ruta, '/');
begin
  if array_length(partes, 1) is null or array_length(partes, 1) < 3
     or partes[2] !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return private.puede_ver_empleado(partes[2]::uuid);
end $$;

create or replace function public.resolver_correccion(p_id uuid, p_aprobar boolean, p_comentario text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.correcciones;
begin
  select * into c from public.correcciones where id = p_id for update;
  if not found then
    raise exception 'correccion no encontrada';
  end if;
  if c.estado <> 'pendiente' then
    raise exception 'la correccion ya fue resuelta';
  end if;
  if not (private.tiene_rol(c.empresa_id, array['dueno', 'admin', 'supervisor']::public.rol_miembro[])
          and private.puede_ver_empleado(c.empleado_id)) then
    raise exception 'sin permiso';
  end if;
  update public.correcciones
     set estado = (case when p_aprobar then 'aprobada' else 'rechazada' end)::public.estado_correccion,
         resuelto_por = (select auth.uid()),
         resuelto_at = now(),
         comentario_resolucion = p_comentario
   where id = p_id;
end $$;

-- Los permisos de ejecución se conservan al mover/recrear, pero se fijan de nuevo por claridad.
revoke execute on function
  private.empresas_del_usuario(), private.tiene_rol(uuid, public.rol_miembro[]),
  private.puede_ver_sede(uuid, uuid), private.puede_ver_empleado(uuid),
  private.puede_ver_ruta_selfie(text)
  from public, anon;
grant execute on function
  private.empresas_del_usuario(), private.tiene_rol(uuid, public.rol_miembro[]),
  private.puede_ver_sede(uuid, uuid), private.puede_ver_empleado(uuid),
  private.puede_ver_ruta_selfie(text)
  to authenticated;

revoke execute on function public.resolver_correccion(uuid, boolean, text) from public, anon;
grant execute on function public.resolver_correccion(uuid, boolean, text) to authenticated;

-- 3. Funciones de trigger: nadie las llama directamente ----------------------
revoke execute on function public.fn_bitacora()            from public, anon, authenticated;
revoke execute on function public.fn_actualizado_at()      from public, anon, authenticated;
revoke execute on function public.fn_registros_inmutables() from public, anon, authenticated;
