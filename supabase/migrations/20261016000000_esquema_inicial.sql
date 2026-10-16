-- Esquema inicial: reloj checador por WhatsApp (MVP)
--
-- Convenciones:
--   * Todas las llaves primarias son uuid (la replicación lógica no sincroniza secuencias).
--   * Toda fila de negocio lleva empresa_id; las llaves foráneas compuestas (id, empresa_id)
--     impiden mezclar datos de dos empresas.
--   * El webhook de WhatsApp y las Edge Functions escriben con service_role (salta RLS).
--     Los clientes del panel solo leen, salvo la configuración que administran dueño y admin.
--   * Las zonas horarias se guardan por sede; los instantes siempre en timestamptz.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.rol_miembro       as enum ('dueno', 'admin', 'supervisor', 'consulta');
create type public.estado_empleado   as enum ('invitado', 'activo', 'baja');
create type public.tipo_registro     as enum ('entrada', 'salida', 'pausa_inicio', 'pausa_fin');
create type public.canal_registro    as enum ('whatsapp', 'web', 'app', 'kiosco', 'manual');
create type public.estado_sesion     as enum ('esperando_ubicacion', 'esperando_selfie', 'completada', 'rechazada', 'expirada');
create type public.tipo_correccion   as enum ('agregar', 'modificar_hora', 'anular');
create type public.estado_correccion as enum ('pendiente', 'aprobada', 'rechazada');
create type public.direccion_mensaje as enum ('entrante', 'saliente');

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create function public.fn_actualizado_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.actualizado_at = now();
  return new;
end $$;

-- Distancia en metros entre dos puntos (haversine); evita depender de PostGIS en el MVP.
create function public.distancia_m(lat1 double precision, lng1 double precision,
                                   lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe set search_path = '' as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))
$$;

-- ---------------------------------------------------------------------------
-- Empresas, sedes, geocercas
-- ---------------------------------------------------------------------------
create table public.empresas (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  razon_social      text,
  rfc               text,
  plan              text not null default 'prueba',
  selfie_requerida  boolean not null default true,
  conservacion_meses integer not null default 12 check (conservacion_meses >= 12),
  creado_at         timestamptz not null default now(),
  actualizado_at    timestamptz not null default now()
);
create trigger empresas_actualizado before update on public.empresas
  for each row execute function public.fn_actualizado_at();

create table public.sedes (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  nombre           text not null,
  direccion        text,
  zona_horaria     text not null default 'America/Mexico_City',
  selfie_requerida boolean,            -- null = heredar de la empresa
  activa           boolean not null default true,
  creado_at        timestamptz not null default now(),
  actualizado_at   timestamptz not null default now(),
  unique (id, empresa_id),
  unique (empresa_id, nombre)
);
create trigger sedes_actualizado before update on public.sedes
  for each row execute function public.fn_actualizado_at();

create table public.geocercas (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  sede_id    uuid not null,
  nombre     text not null default 'Principal',
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  radio_m    integer not null check (radio_m between 10 and 5000),
  activa     boolean not null default true,
  creado_at  timestamptz not null default now(),
  foreign key (sede_id, empresa_id) references public.sedes (id, empresa_id) on delete cascade,
  unique (id, empresa_id)
);
create index geocercas_sede_idx on public.geocercas (sede_id) where activa;

-- ---------------------------------------------------------------------------
-- Usuarios del panel (miembros) y su alcance por sede
-- ---------------------------------------------------------------------------
create table public.miembros (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  rol        public.rol_miembro not null,
  activo     boolean not null default true,
  creado_at  timestamptz not null default now(),
  unique (empresa_id, user_id),
  unique (id, empresa_id)
);
create index miembros_user_idx on public.miembros (user_id) where activo;

-- Solo aplica al rol supervisor: qué sedes puede ver.
create table public.miembro_sedes (
  miembro_id uuid not null references public.miembros (id) on delete cascade,
  sede_id    uuid not null references public.sedes (id) on delete cascade,
  primary key (miembro_id, sede_id)
);

-- ---------------------------------------------------------------------------
-- Horarios
-- ---------------------------------------------------------------------------
create table public.horarios (
  id                     uuid primary key default gen_random_uuid(),
  empresa_id             uuid not null references public.empresas (id) on delete cascade,
  nombre                 text not null,
  tolerancia_retardo_min integer not null default 10 check (tolerancia_retardo_min >= 0),
  tolerancia_salida_min  integer not null default 0  check (tolerancia_salida_min >= 0),
  creado_at              timestamptz not null default now(),
  actualizado_at         timestamptz not null default now(),
  unique (id, empresa_id),
  unique (empresa_id, nombre)
);
create trigger horarios_actualizado before update on public.horarios
  for each row execute function public.fn_actualizado_at();

-- Varias filas por día permiten jornada partida. dia_semana: 0 = domingo ... 6 = sábado
-- (igual que extract(dow ...)). Si la salida es menor o igual a la entrada, cruza la medianoche.
create table public.horario_dias (
  id               uuid primary key default gen_random_uuid(),
  horario_id       uuid not null references public.horarios (id) on delete cascade,
  dia_semana       smallint not null check (dia_semana between 0 and 6),
  hora_entrada     time not null,
  hora_salida      time not null check (hora_salida <> hora_entrada),
  minutos_pausa    integer not null default 0 check (minutos_pausa >= 0),
  cruza_medianoche boolean generated always as (hora_salida < hora_entrada) stored,
  unique (horario_id, dia_semana, hora_entrada)
);

create table public.dias_festivos (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas (id) on delete cascade,  -- null = global
  fecha      date not null,
  nombre     text not null,
  unique nulls not distinct (empresa_id, fecha)
);

-- ---------------------------------------------------------------------------
-- Empleados
-- ---------------------------------------------------------------------------
create table public.empleados (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  sede_id          uuid not null,
  user_id          uuid references auth.users (id) on delete set null,  -- autoservicio web/app (v2)
  supervisor_id    uuid references public.miembros (id) on delete set null,
  num_empleado     text,
  nombre           text not null,
  telefono         text not null check (telefono ~ '^\+[1-9][0-9]{7,14}$'),  -- E.164
  estado           public.estado_empleado not null default 'invitado',
  selfie_requerida boolean,            -- null = heredar de la sede / empresa
  fecha_ingreso    date,
  fecha_baja       date,
  creado_at        timestamptz not null default now(),
  actualizado_at   timestamptz not null default now(),
  foreign key (sede_id, empresa_id) references public.sedes (id, empresa_id),
  unique (id, empresa_id),
  check (fecha_baja is null or fecha_ingreso is null or fecha_baja >= fecha_ingreso)
);
create trigger empleados_actualizado before update on public.empleados
  for each row execute function public.fn_actualizado_at();
create unique index empleados_telefono_activo_uq on public.empleados (empresa_id, telefono)
  where estado <> 'baja';
create unique index empleados_num_uq on public.empleados (empresa_id, num_empleado)
  where num_empleado is not null;
create index empleados_sede_idx on public.empleados (sede_id) where estado <> 'baja';

-- Historial de horarios: los reportes de periodos pasados usan el horario vigente de entonces.
create table public.empleado_horarios (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null,
  empleado_id uuid not null,
  horario_id  uuid not null,
  vigencia    daterange not null default daterange(current_date, null),
  foreign key (empleado_id, empresa_id) references public.empleados (id, empresa_id) on delete cascade,
  foreign key (horario_id, empresa_id)  references public.horarios (id, empresa_id),
  exclude using gist (empleado_id with =, vigencia with &&)
);

create table public.consentimientos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null,
  empleado_id uuid not null,
  tipo        text not null check (tipo in ('aviso_privacidad', 'ubicacion', 'selfie')),
  version     text not null,
  aceptado_at timestamptz not null default now(),
  wamid       text,                    -- mensaje de WhatsApp que lo respalda
  revocado_at timestamptz,
  foreign key (empleado_id, empresa_id) references public.empleados (id, empresa_id) on delete cascade,
  unique (empleado_id, tipo, version)
);

-- ---------------------------------------------------------------------------
-- WhatsApp: números, vínculos, invitaciones, mensajes, medios
-- ---------------------------------------------------------------------------
-- empresa_id null = número compartido entre empresas (decisión pendiente: compartido o por cliente).
-- Los tokens de acceso de Meta NO se guardan aquí: usar Supabase Vault o variables de entorno.
create table public.numeros_whatsapp (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid references public.empresas (id) on delete cascade,
  phone_number_id text not null unique,
  waba_id         text,
  numero_visible  text,
  activo          boolean not null default true,
  creado_at       timestamptz not null default now(),
  unique (id, empresa_id)
);

-- Une un wa_id (número de WhatsApp del empleado) con el empleado. Un cambio de número
-- revoca el vínculo anterior y crea otro: sirve de historial y de señal de riesgo.
create table public.vinculos_whatsapp (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null,
  empleado_id uuid not null,
  numero_id   uuid not null references public.numeros_whatsapp (id),
  wa_id       text not null,
  vinculado_at timestamptz not null default now(),
  revocado_at timestamptz,
  motivo_revocacion text,
  activo      boolean generated always as (revocado_at is null) stored,
  foreign key (empleado_id, empresa_id) references public.empleados (id, empresa_id) on delete cascade
);
create unique index vinculos_wa_activo_uq on public.vinculos_whatsapp (numero_id, wa_id) where activo;
create unique index vinculos_empleado_activo_uq on public.vinculos_whatsapp (empleado_id, numero_id) where activo;

create table public.invitaciones (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null,
  empleado_id uuid not null,
  codigo_hash text not null unique,    -- sha-256 hex del código; el código en claro no se guarda
  expira_at   timestamptz not null,
  usado_at    timestamptz,
  creado_at   timestamptz not null default now(),
  foreign key (empleado_id, empresa_id) references public.empleados (id, empresa_id) on delete cascade
);

-- Bitácora cruda de todo lo que entra y sale. La unicidad de wamid vuelve idempotente el webhook.
create table public.mensajes_whatsapp (
  id           uuid primary key default gen_random_uuid(),
  wamid        text unique,            -- puede ser null en salientes aún no enviados
  numero_id    uuid references public.numeros_whatsapp (id),
  empresa_id   uuid references public.empresas (id) on delete set null,
  empleado_id  uuid references public.empleados (id) on delete set null,
  wa_id        text,
  direccion    public.direccion_mensaje not null,
  tipo         text not null,          -- text, location, image, interactive, ...
  payload      jsonb not null,
  ts_whatsapp  timestamptz,            -- hora que reporta Meta
  recibido_at  timestamptz not null default now(),
  estado       text not null default 'recibido'
               check (estado in ('recibido', 'procesando', 'procesado', 'error', 'ignorado')),
  intentos     integer not null default 0,
  error        text,
  procesado_at timestamptz
);
create index mensajes_cola_idx on public.mensajes_whatsapp (recibido_at)
  where estado in ('recibido', 'error');
create index mensajes_empleado_idx on public.mensajes_whatsapp (empleado_id, recibido_at desc);

-- Selfies. phash permite detectar fotos repetidas sin reconocimiento facial;
-- distancia de Hamming: bit_count((a # b)::bit(64)).
create table public.medios (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null,
  empleado_id  uuid not null,
  mensaje_id   uuid references public.mensajes_whatsapp (id) on delete set null,
  wa_media_id  text,
  ruta_storage text not null,          -- selfies/{empresa_id}/{empleado_id}/{medio_id}.jpg
  sha256       text not null,
  phash        bigint,
  mime         text not null,
  bytes        integer not null,
  creado_at    timestamptz not null default now(),
  foreign key (empleado_id, empresa_id) references public.empleados (id, empresa_id) on delete cascade,
  unique (id, empresa_id)
);
create index medios_empleado_idx on public.medios (empleado_id, creado_at desc);
create index medios_sha_idx on public.medios (sha256);

-- ---------------------------------------------------------------------------
-- Registro de asistencia
-- ---------------------------------------------------------------------------
-- Un intento (ubicación, luego selfie) vive en la sesión. Si se rechaza, queda aquí con el motivo.
-- Si se completa, se crea un registro.
create table public.sesiones_registro (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null,
  empleado_id     uuid not null,
  vinculo_id      uuid references public.vinculos_whatsapp (id),
  tipo            public.tipo_registro not null,
  estado          public.estado_sesion not null default 'esperando_ubicacion',
  sede_id         uuid,
  lat             double precision,
  lng             double precision,
  precision_m     real,
  tipo_ubicacion  text,                -- 'actual' o 'elegida' si WhatsApp lo distingue
  geocerca_id     uuid,
  distancia_m     real,
  dentro_geocerca boolean,
  ubicacion_wamid text,
  medio_id        uuid,
  motivo_rechazo  text,
  senales         text[] not null default '{}',
  creada_at       timestamptz not null default now(),
  expira_at       timestamptz not null default now() + interval '10 minutes',
  completada_at   timestamptz,
  foreign key (empleado_id, empresa_id) references public.empleados (id, empresa_id) on delete cascade,
  foreign key (medio_id, empresa_id)    references public.medios (id, empresa_id),
  foreign key (geocerca_id, empresa_id) references public.geocercas (id, empresa_id),
  foreign key (sede_id, empresa_id)     references public.sedes (id, empresa_id)
);
-- Una sola sesión abierta por empleado.
create unique index sesiones_abierta_uq on public.sesiones_registro (empleado_id)
  where estado in ('esperando_ubicacion', 'esperando_selfie');
create index sesiones_expira_idx on public.sesiones_registro (expira_at)
  where estado in ('esperando_ubicacion', 'esperando_selfie');

-- Registro inmutable: solo se inserta. Los cambios van en `correcciones`.
create table public.registros (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null,
  empleado_id     uuid not null,
  sede_id         uuid not null,
  sesion_id       uuid unique references public.sesiones_registro (id),
  tipo            public.tipo_registro not null,
  canal           public.canal_registro not null default 'whatsapp',
  ocurrido_at     timestamptz not null default now(),   -- hora del servidor (la que vale)
  ts_cliente      timestamptz,                          -- hora que reporta WhatsApp, el aparato, etc.
  lat             double precision,
  lng             double precision,
  precision_m     real,
  geocerca_id     uuid,
  distancia_m     real,
  dentro_geocerca boolean,
  medio_id        uuid,
  senales         text[] not null default '{}',         -- señales de riesgo; marcan, no bloquean
  creado_por      uuid references auth.users (id),      -- solo registros manuales
  motivo          text,                                 -- obligatorio en registros manuales
  creado_at       timestamptz not null default now(),
  foreign key (empleado_id, empresa_id) references public.empleados (id, empresa_id),
  foreign key (sede_id, empresa_id)     references public.sedes (id, empresa_id),
  foreign key (geocerca_id, empresa_id) references public.geocercas (id, empresa_id),
  foreign key (medio_id, empresa_id)    references public.medios (id, empresa_id),
  unique (id, empleado_id),
  unique (id, empresa_id),
  check (canal <> 'manual' or (creado_por is not null and motivo is not null)),
  -- Un registro por WhatsApp solo existe si estuvo dentro de la geocerca.
  check (canal <> 'whatsapp' or (lat is not null and lng is not null and dentro_geocerca)),
  check (lat is null or lat between -90 and 90),
  check (lng is null or lng between -180 and 180)
);
create index registros_empresa_fecha_idx  on public.registros (empresa_id, ocurrido_at desc);
create index registros_empleado_fecha_idx on public.registros (empleado_id, ocurrido_at desc);
create index registros_sede_fecha_idx     on public.registros (sede_id, ocurrido_at desc);

create function public.fn_registros_inmutables() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Escape para el trabajo de purga por plazo de conservación:
  --   set local reloj.permitir_purga = 'on';
  if tg_op = 'DELETE' and current_setting('reloj.permitir_purga', true) = 'on' then
    return old;
  end if;
  raise exception 'registros es inmutable: usa correcciones (% sobre %)', tg_op, tg_table_name;
end $$;
create trigger registros_no_update before update or delete on public.registros
  for each row execute function public.fn_registros_inmutables();
create trigger registros_no_truncate before truncate on public.registros
  for each statement execute function public.fn_registros_inmutables();

-- Correcciones: agregar un registro olvidado, cambiar la hora de uno, o anularlo.
create table public.correcciones (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null,
  empleado_id        uuid not null,
  registro_id        uuid,
  tipo               public.tipo_correccion not null,
  nuevo_tipo         public.tipo_registro,
  nueva_hora         timestamptz,
  motivo             text not null,
  origen             text not null check (origen in ('empleado', 'supervisor', 'admin')),
  estado             public.estado_correccion not null default 'pendiente',
  solicitada_por     uuid references auth.users (id),   -- null si la pidió el empleado por el chat
  resuelto_por       uuid references auth.users (id),
  resuelto_at        timestamptz,
  comentario_resolucion text,
  creada_at          timestamptz not null default now(),
  foreign key (empleado_id, empresa_id)  references public.empleados (id, empresa_id),
  foreign key (registro_id, empleado_id) references public.registros (id, empleado_id),
  check (tipo <> 'agregar'        or (registro_id is null and nuevo_tipo is not null and nueva_hora is not null)),
  check (tipo <> 'modificar_hora' or (registro_id is not null and nueva_hora is not null)),
  check (tipo <> 'anular'         or registro_id is not null),
  check (estado = 'pendiente' or (resuelto_at is not null))
);
create index correcciones_empleado_idx on public.correcciones (empleado_id, creada_at desc);
create index correcciones_pendientes_idx on public.correcciones (empresa_id) where estado = 'pendiente';
-- Una sola anulación o modificación pendiente por registro.
create unique index correcciones_unica_pendiente_uq on public.correcciones (registro_id, tipo)
  where estado = 'pendiente' and registro_id is not null;

-- Lo que usan los reportes: registros originales con las correcciones aprobadas aplicadas.
create view public.registros_efectivos with (security_invoker = true) as
  select 'registro'::text as origen,
         r.id             as fuente_id,
         r.empresa_id, r.empleado_id, r.sede_id, r.tipo,
         coalesce(m.nueva_hora, r.ocurrido_at) as hora_efectiva,
         r.ocurrido_at    as hora_original,
         r.canal, r.dentro_geocerca, r.senales, r.medio_id,
         (m.id is not null) as corregido
    from public.registros r
    left join lateral (
      select c.id, c.nueva_hora
        from public.correcciones c
       where c.registro_id = r.id and c.tipo = 'modificar_hora' and c.estado = 'aprobada'
       order by c.resuelto_at desc
       limit 1
    ) m on true
   where not exists (
     select 1 from public.correcciones a
      where a.registro_id = r.id and a.tipo = 'anular' and a.estado = 'aprobada')
  union all
  select 'correccion'::text,
         c.id,
         c.empresa_id, c.empleado_id, e.sede_id, c.nuevo_tipo,
         c.nueva_hora,
         null::timestamptz,
         'manual'::public.canal_registro, null::boolean, '{}'::text[], null::uuid,
         true
    from public.correcciones c
    join public.empleados e on e.id = c.empleado_id
   where c.tipo = 'agregar' and c.estado = 'aprobada';

-- ---------------------------------------------------------------------------
-- Bitácora de acciones de administración
-- ---------------------------------------------------------------------------
create table public.bitacora (
  id         bigint generated always as identity primary key,
  empresa_id uuid,
  actor      uuid,
  accion     text not null,
  tabla      text not null,
  fila_id    uuid,
  antes      jsonb,
  despues    jsonb,
  at         timestamptz not null default now()
);
create index bitacora_empresa_idx on public.bitacora (empresa_id, at desc);
create trigger bitacora_no_update before update or delete on public.bitacora
  for each row execute function public.fn_registros_inmutables();

create function public.fn_bitacora() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  fila jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.bitacora (empresa_id, actor, accion, tabla, fila_id, antes, despues)
  values (
    coalesce((fila ->> 'empresa_id')::uuid,
             case when tg_table_name = 'empresas' then (fila ->> 'id')::uuid end),
    (select auth.uid()),
    tg_op,
    tg_table_name,
    (fila ->> 'id')::uuid,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['empresas', 'sedes', 'geocercas', 'miembros', 'horarios', 'horario_dias',
                           'empleados', 'empleado_horarios', 'correcciones', 'numeros_whatsapp']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.fn_bitacora()', t || '_bitacora', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Funciones de apoyo para el webhook
-- ---------------------------------------------------------------------------
-- Geocerca de la sede que contiene el punto; si ninguna, la más cercana con dentro = false.
create function public.geocerca_para(p_sede uuid, p_lat double precision, p_lng double precision)
returns table (geocerca_id uuid, distancia_m double precision, dentro boolean)
language sql stable set search_path = '' as $$
  select g.id, x.d, x.d <= g.radio_m
    from public.geocercas g
   cross join lateral (select public.distancia_m(g.lat, g.lng, p_lat, p_lng) as d) x
   where g.sede_id = p_sede and g.activa
   order by (x.d <= g.radio_m) desc, x.d
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- Funciones de permisos (RLS)
-- ---------------------------------------------------------------------------
create function public.empresas_del_usuario() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.empresa_id from public.miembros m
   where m.user_id = (select auth.uid()) and m.activo
$$;

create function public.tiene_rol(p_empresa uuid, p_roles public.rol_miembro[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.miembros m
     where m.empresa_id = p_empresa and m.user_id = (select auth.uid())
       and m.activo and m.rol = any (p_roles))
$$;

-- Dueño, admin y consulta ven toda la empresa; el supervisor solo sus sedes.
create function public.puede_ver_sede(p_empresa uuid, p_sede uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.miembros m
     where m.empresa_id = p_empresa and m.user_id = (select auth.uid()) and m.activo
       and (m.rol in ('dueno', 'admin', 'consulta')
            or (m.rol = 'supervisor' and exists (
                  select 1 from public.miembro_sedes s
                   where s.miembro_id = m.id and s.sede_id = p_sede))))
$$;

create function public.puede_ver_empleado(p_empleado uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select public.puede_ver_sede(e.empresa_id, e.sede_id)
                     from public.empleados e where e.id = p_empleado), false)
$$;

-- Los clientes no actualizan correcciones directamente: pasan por esta función.
create function public.resolver_correccion(p_id uuid, p_aprobar boolean, p_comentario text default null)
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
  if not (public.tiene_rol(c.empresa_id, array['dueno', 'admin', 'supervisor']::public.rol_miembro[])
          and public.puede_ver_empleado(c.empleado_id)) then
    raise exception 'sin permiso';
  end if;
  update public.correcciones
     set estado = (case when p_aprobar then 'aprobada' else 'rechazada' end)::public.estado_correccion,
         resuelto_por = (select auth.uid()),
         resuelto_at = now(),
         comentario_resolucion = p_comentario
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['empresas', 'sedes', 'geocercas', 'miembros', 'miembro_sedes', 'horarios',
                           'horario_dias', 'dias_festivos', 'empleados', 'empleado_horarios',
                           'consentimientos', 'numeros_whatsapp', 'vinculos_whatsapp', 'invitaciones',
                           'mensajes_whatsapp', 'medios', 'sesiones_registro', 'registros',
                           'correcciones', 'bitacora']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Empresas
create policy empresas_select on public.empresas for select to authenticated
  using (id in (select public.empresas_del_usuario()));
create policy empresas_update on public.empresas for update to authenticated
  using (public.tiene_rol(id, array['dueno', 'admin']::public.rol_miembro[]))
  with check (public.tiene_rol(id, array['dueno', 'admin']::public.rol_miembro[]));

-- Sedes y empleados: lectura por alcance; escritura dueño/admin
create policy sedes_select on public.sedes for select to authenticated
  using (public.puede_ver_sede(empresa_id, id));
create policy sedes_write on public.sedes for all to authenticated
  using (public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]))
  with check (public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]));

create policy empleados_select on public.empleados for select to authenticated
  using (public.puede_ver_sede(empresa_id, sede_id));
create policy empleados_write on public.empleados for all to authenticated
  using (public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]))
  with check (public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]));

-- Configuración visible para cualquier miembro, editable por dueño/admin
create policy geocercas_select on public.geocercas for select to authenticated
  using (public.puede_ver_sede(empresa_id, sede_id));
create policy geocercas_write on public.geocercas for all to authenticated
  using (public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]))
  with check (public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]));

create policy horarios_select on public.horarios for select to authenticated
  using (empresa_id in (select public.empresas_del_usuario()));
create policy horarios_write on public.horarios for all to authenticated
  using (public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]))
  with check (public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]));

create policy horario_dias_select on public.horario_dias for select to authenticated
  using (exists (select 1 from public.horarios h where h.id = horario_id
                 and h.empresa_id in (select public.empresas_del_usuario())));
create policy horario_dias_write on public.horario_dias for all to authenticated
  using (exists (select 1 from public.horarios h where h.id = horario_id
                 and public.tiene_rol(h.empresa_id, array['dueno', 'admin']::public.rol_miembro[])))
  with check (exists (select 1 from public.horarios h where h.id = horario_id
                 and public.tiene_rol(h.empresa_id, array['dueno', 'admin']::public.rol_miembro[])));

create policy dias_festivos_select on public.dias_festivos for select to authenticated
  using (empresa_id is null or empresa_id in (select public.empresas_del_usuario()));
create policy dias_festivos_write on public.dias_festivos for all to authenticated
  using (empresa_id is not null
         and public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]))
  with check (empresa_id is not null
         and public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]));

create policy empleado_horarios_select on public.empleado_horarios for select to authenticated
  using (public.puede_ver_empleado(empleado_id));
create policy empleado_horarios_write on public.empleado_horarios for all to authenticated
  using (public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]))
  with check (public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]));

-- Miembros: cada quien ve su fila; dueño/admin ven y el dueño administra
create policy miembros_select on public.miembros for select to authenticated
  using (user_id = (select auth.uid())
         or public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]));
create policy miembros_write on public.miembros for all to authenticated
  using (public.tiene_rol(empresa_id, array['dueno']::public.rol_miembro[]))
  with check (public.tiene_rol(empresa_id, array['dueno']::public.rol_miembro[]));

create policy miembro_sedes_select on public.miembro_sedes for select to authenticated
  using (exists (select 1 from public.miembros m where m.id = miembro_id
                 and (m.user_id = (select auth.uid())
                      or public.tiene_rol(m.empresa_id, array['dueno', 'admin']::public.rol_miembro[]))));
create policy miembro_sedes_write on public.miembro_sedes for all to authenticated
  using (exists (select 1 from public.miembros m where m.id = miembro_id
                 and public.tiene_rol(m.empresa_id, array['dueno', 'admin']::public.rol_miembro[])))
  with check (exists (select 1 from public.miembros m where m.id = miembro_id
                 and public.tiene_rol(m.empresa_id, array['dueno', 'admin']::public.rol_miembro[])));

-- Datos operativos: solo lectura desde el panel; escribe el servidor (service_role)
create policy registros_select on public.registros for select to authenticated
  using (public.puede_ver_sede(empresa_id, sede_id));
create policy sesiones_select on public.sesiones_registro for select to authenticated
  using (public.puede_ver_empleado(empleado_id));
create policy medios_select on public.medios for select to authenticated
  using (public.puede_ver_empleado(empleado_id));
create policy consentimientos_select on public.consentimientos for select to authenticated
  using (public.puede_ver_empleado(empleado_id));
create policy vinculos_select on public.vinculos_whatsapp for select to authenticated
  using (public.puede_ver_empleado(empleado_id));

create policy mensajes_select on public.mensajes_whatsapp for select to authenticated
  using (empresa_id is not null
         and public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]));
create policy invitaciones_select on public.invitaciones for select to authenticated
  using (public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]));
create policy numeros_select on public.numeros_whatsapp for select to authenticated
  using (empresa_id is not null
         and public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]));
create policy bitacora_select on public.bitacora for select to authenticated
  using (empresa_id is not null
         and public.tiene_rol(empresa_id, array['dueno', 'admin']::public.rol_miembro[]));

-- Correcciones: supervisores, admin y dueño las piden; se resuelven con resolver_correccion().
create policy correcciones_select on public.correcciones for select to authenticated
  using (public.puede_ver_empleado(empleado_id));
create policy correcciones_insert on public.correcciones for insert to authenticated
  with check (public.tiene_rol(empresa_id, array['dueno', 'admin', 'supervisor']::public.rol_miembro[])
              and public.puede_ver_empleado(empleado_id)
              and estado = 'pendiente'
              and solicitada_por = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Permisos de ejecución y de rol anónimo
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.empresas_del_usuario(), public.tiene_rol(uuid, public.rol_miembro[]),
  public.puede_ver_sede(uuid, uuid), public.puede_ver_empleado(uuid),
  public.resolver_correccion(uuid, boolean, text)
  to authenticated;
