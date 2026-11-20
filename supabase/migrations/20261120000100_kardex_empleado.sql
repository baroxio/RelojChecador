-- Kárdex por empleado: expediente con la historia laboral, incidencias, notas/sanciones y documentos.
-- Los eventos no se borran ni se editan: solo se anulan (con motivo), igual que las checadas.
-- Lo ven y lo escriben dueño, administrador y supervisor (este último solo de las sedes que ve).

create table public.kardex_eventos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null,
  empleado_id    uuid not null,
  categoria      text not null check (categoria in ('laboral', 'incidencia', 'nota', 'documento')),
  tipo           text not null,
  fecha_inicio   date not null,
  fecha_fin      date,                       -- para permisos, vacaciones, incapacidades
  titulo         text not null check (length(btrim(titulo)) between 2 and 120),
  detalle        text check (detalle is null or length(detalle) <= 2000),
  valor_anterior text check (valor_anterior is null or length(valor_anterior) <= 200),
  valor_nuevo    text check (valor_nuevo is null or length(valor_nuevo) <= 200),
  con_goce       boolean,                    -- incidencias: ¿con goce de sueldo?
  archivo_ruta   text,                       -- bucket «kardex»: {empresa}/{empleado}/{uuid}.ext
  archivo_nombre text,
  archivo_mime   text,
  archivo_bytes  integer check (archivo_bytes is null or archivo_bytes > 0),
  creado_por     uuid not null references auth.users (id),
  creado_at      timestamptz not null default now(),
  anulado        boolean not null default false,
  anulado_por    uuid references auth.users (id),
  anulado_at     timestamptz,
  motivo_anulacion text,
  foreign key (empleado_id, empresa_id) references public.empleados (id, empresa_id) on delete cascade,
  check (fecha_fin is null or fecha_fin >= fecha_inicio),
  check (
    (categoria = 'laboral'    and tipo in ('alta', 'baja', 'reingreso', 'cambio_puesto', 'cambio_sede', 'cambio_horario', 'cambio_sueldo', 'otro'))
 or (categoria = 'incidencia' and tipo in ('falta', 'retardo', 'permiso', 'incapacidad', 'vacaciones', 'dia_economico', 'otra'))
 or (categoria = 'nota'       and tipo in ('nota', 'llamada_atencion', 'acta_administrativa', 'reconocimiento'))
 or (categoria = 'documento'  and tipo in ('contrato', 'identificacion', 'curp', 'rfc', 'nss', 'comprobante_domicilio', 'certificado_medico', 'otro'))
  ),
  check (categoria <> 'documento' or archivo_ruta is not null),
  check (not anulado or (anulado_at is not null and motivo_anulacion is not null))
);
create index kardex_empleado_idx on public.kardex_eventos (empleado_id, fecha_inicio desc, creado_at desc);
create index kardex_empresa_idx  on public.kardex_eventos (empresa_id, creado_at desc);

-- Una vez guardado, solo se puede anular: nada más cambia ni se borra.
create function public.fn_kardex_solo_anular() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los eventos del kárdex no se borran; se anulan.' using errcode = '42501';
  end if;
  if old.anulado then
    raise exception 'El evento ya está anulado.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'anulado' - 'anulado_por' - 'anulado_at' - 'motivo_anulacion')
     is distinct from
     (to_jsonb(old) - 'anulado' - 'anulado_por' - 'anulado_at' - 'motivo_anulacion') then
    raise exception 'Un evento del kárdex no se edita; solo se anula.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.fn_kardex_solo_anular() from public, anon, authenticated;
create trigger kardex_no_editar before update or delete on public.kardex_eventos
  for each row execute function public.fn_kardex_solo_anular();

create trigger kardex_eventos_bitacora after insert or update or delete on public.kardex_eventos
  for each row execute function public.fn_bitacora();

alter table public.kardex_eventos enable row level security;

create policy kardex_select on public.kardex_eventos for select to authenticated
  using (private.tiene_rol(empresa_id, array['dueno', 'admin', 'supervisor']::public.rol_miembro[])
         and private.puede_ver_empleado(empleado_id));

create policy kardex_insert on public.kardex_eventos for insert to authenticated
  with check (private.tiene_rol(empresa_id, array['dueno', 'admin', 'supervisor']::public.rol_miembro[])
              and private.puede_ver_empleado(empleado_id)
              and creado_por = (select auth.uid())
              and not anulado);

-- Anular: dueño y administrador (el supervisor agrega, pero no anula).
create policy kardex_anular on public.kardex_eventos for update to authenticated
  using (private.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]))
  with check (private.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[])
              and anulado_por = (select auth.uid()));

revoke all on public.kardex_eventos from anon;
grant select, insert, update on public.kardex_eventos to authenticated;
grant all on public.kardex_eventos to service_role;

-- ---------------------------------------------------------------------------
-- Documentos: bucket privado. Ruta: {empresa_id}/{empleado_id}/{uuid}.{ext}
-- (La función de apoyo va en el esquema `private`, que la API REST no expone.)
-- Aquí sí escribe el panel (con la sesión de quien sube), según su alcance.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kardex', 'kardex', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create function private.puede_usar_ruta_kardex(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  partes text[] := string_to_array(p_ruta, '/');
begin
  if array_length(partes, 1) is distinct from 3
     or partes[1] !~ '^[0-9a-fA-F-]{36}$' or partes[2] !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return private.tiene_rol(partes[1]::uuid, array['dueno', 'admin', 'supervisor']::public.rol_miembro[])
     and exists (select 1 from public.empleados e
                  where e.id = partes[2]::uuid and e.empresa_id = partes[1]::uuid)
     and private.puede_ver_empleado(partes[2]::uuid);
end $$;
revoke execute on function private.puede_usar_ruta_kardex(text) from public, anon;
grant execute on function private.puede_usar_ruta_kardex(text) to authenticated;

create policy kardex_archivos_leer on storage.objects for select to authenticated
  using (bucket_id = 'kardex' and private.puede_usar_ruta_kardex(name));
create policy kardex_archivos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'kardex' and private.puede_usar_ruta_kardex(name));
-- Sin políticas de update ni delete: los archivos subidos no se modifican ni se borran desde el panel.
