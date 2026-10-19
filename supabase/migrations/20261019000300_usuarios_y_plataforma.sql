-- Fase 2 del panel: administradores de la plataforma y lista de usuarios por empresa.
--
-- * plataforma_admins: quién puede administrar todas las empresas. Empieza VACÍA a propósito;
--   se agrega a alguien con un insert hecho por el dueño del proyecto (ver docs/hoja-de-ruta-panel.md).
-- * miembros_de_empresa(): lista a los usuarios de una empresa con su correo y nombre. Solo dueño o
--   administrador de esa empresa; auth.users no se expone directamente.
-- * usuario_id_por_correo(): la usa la función del servidor para saber si un correo ya existe.
--
-- Crear usuarios, cambiar roles y crear empresas se hacen en la Edge Function "administrar", con la
-- clave del servidor; los clientes no escriben en miembros ni en empresas.

create table public.plataforma_admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  creado_at timestamptz not null default now()
);
alter table public.plataforma_admins enable row level security;

-- Cada quien puede saber si él mismo es administrador de la plataforma. Nadie escribe desde el cliente.
create policy plataforma_admins_propio on public.plataforma_admins for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.plataforma_admins from anon;

create or replace function public.miembros_de_empresa(p_empresa uuid)
returns table (
  miembro_id uuid, user_id uuid, correo text, nombre text, rol public.rol_miembro,
  activo boolean, sedes uuid[], creado_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.tiene_rol(p_empresa, array['dueno', 'admin']::public.rol_miembro[]) then
    raise exception 'sin permiso' using errcode = '42501';
  end if;
  return query
    select m.id, m.user_id, u.email::text,
           coalesce(u.raw_user_meta_data ->> 'nombre', u.raw_user_meta_data ->> 'full_name'),
           m.rol, m.activo,
           coalesce((select array_agg(ms.sede_id) from public.miembro_sedes ms where ms.miembro_id = m.id), '{}'),
           m.creado_at
      from public.miembros m
      join auth.users u on u.id = m.user_id
     where m.empresa_id = p_empresa
     order by m.activo desc, m.rol, u.email;
end $$;

revoke execute on function public.miembros_de_empresa(uuid) from public, anon;
grant execute on function public.miembros_de_empresa(uuid) to authenticated;

-- Solo para la función del servidor (service_role): ningún usuario puede preguntar qué correos existen.
create or replace function public.usuario_id_por_correo(p_correo text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(p_correo) limit 1
$$;
revoke execute on function public.usuario_id_por_correo(text) from public, anon, authenticated;
grant execute on function public.usuario_id_por_correo(text) to service_role;

-- Un usuario puede pertenecer a varias empresas (por ejemplo, el administrador de la plataforma):
-- cada fila de miembros ya es única por (empresa, usuario), así que no hace falta cambiar nada más.
