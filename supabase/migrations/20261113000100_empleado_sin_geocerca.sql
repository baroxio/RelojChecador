-- Empleados que pueden registrarse por WhatsApp desde cualquier lugar (sin validar geocerca).
-- Se activa por empleado; el registro conserva la ubicación y la distancia reales y queda
-- marcado con geocerca_omitida para que los reportes lo distingan.
alter table public.empleados
  add column sin_geocerca boolean not null default false;

comment on column public.empleados.sin_geocerca is
  'true = puede registrar desde cualquier lugar: el registro por WhatsApp no se rechaza por estar fuera de la geocerca.';

alter table public.registros
  add column geocerca_omitida boolean not null default false;

comment on column public.registros.geocerca_omitida is
  'true = el empleado tiene sin_geocerca y el registro quedó fuera de la geocerca (o la sede no tiene).';

-- La regla anterior exigía dentro_geocerca en todo registro por WhatsApp. Se reemplaza por una
-- que también acepta el registro con la geocerca omitida (la ubicación sigue siendo obligatoria).
do $$
declare
  v_nombre text;
begin
  select conname into v_nombre
  from pg_constraint
  where conrelid = 'public.registros'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%whatsapp%'
    and pg_get_constraintdef(oid) like '%dentro_geocerca%';
  if v_nombre is not null then
    execute format('alter table public.registros drop constraint %I', v_nombre);
  end if;
end $$;

alter table public.registros
  add constraint registros_whatsapp_zona_ck
  check (canal <> 'whatsapp' or (lat is not null and lng is not null and (dentro_geocerca or geocerca_omitida)));
