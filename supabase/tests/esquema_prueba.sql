-- Prueba del esquema inicial. Se ejecuta en el SQL Editor de Supabase DESPUÉS de aplicar las migraciones.
--
-- Todo ocurre dentro de un solo bloque DO que termina con una excepción a propósito:
-- Postgres revierte todo, así que no queda ningún dato de prueba. El editor mostrará un
-- "error" cuyo mensaje es el informe: cada línea empieza con OK o FALLA.

do $prueba$
declare
  ea uuid := gen_random_uuid(); eb uuid := gen_random_uuid();          -- empresas
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); sb uuid := gen_random_uuid();  -- sedes
  g  uuid := gen_random_uuid();
  ua uuid := gen_random_uuid(); us uuid := gen_random_uuid(); ub uuid := gen_random_uuid();  -- usuarios
  ma uuid := gen_random_uuid(); ms uuid := gen_random_uuid(); mb uuid := gen_random_uuid();  -- miembros
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid();          -- empleados de A
  r1 uuid; r2 uuid; c1 uuid;
  n integer; d double precision; dentro boolean; hora timestamptz; corr boolean;
  res text := '';
begin
  -- ----- Datos base (como postgres: salta RLS) -----
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'dueno-a@prueba.local'),
    (us, 'authenticated', 'authenticated', 'supervisor-a@prueba.local'),
    (ub, 'authenticated', 'authenticated', 'dueno-b@prueba.local');
  insert into public.empresas (id, nombre) values (ea, 'Empresa A'), (eb, 'Empresa B');
  insert into public.sedes (id, empresa_id, nombre) values
    (s1, ea, 'Sede 1'), (s2, ea, 'Sede 2'), (sb, eb, 'Sede B');
  insert into public.geocercas (id, empresa_id, sede_id, lat, lng, radio_m)
    values (g, ea, s1, 19.4326, -99.1332, 100);
  insert into public.miembros (id, empresa_id, user_id, rol) values
    (ma, ea, ua, 'dueno'), (ms, ea, us, 'supervisor'), (mb, eb, ub, 'dueno');
  insert into public.miembro_sedes (miembro_id, sede_id) values (ms, s1);
  insert into public.empleados (id, empresa_id, sede_id, nombre, telefono) values
    (e1, ea, s1, 'Empleado 1', '+525511111111'),
    (e2, ea, s2, 'Empleado 2', '+525522222222');

  -- ----- 1. Un registro por WhatsApp fuera de la geocerca se rechaza -----
  begin
    insert into public.registros (empresa_id, empleado_id, sede_id, tipo, canal, lat, lng, dentro_geocerca)
    values (ea, e1, s1, 'entrada', 'whatsapp', 19.5, -99.1, false);
    res := res || E'FALLA: se aceptó un registro de WhatsApp fuera de la geocerca\n';
  exception when check_violation then
    res := res || E'OK: registro de WhatsApp fuera de la geocerca rechazado\n';
  end;

  -- ----- 2. Un registro válido se inserta, y no se puede modificar ni borrar -----
  insert into public.registros (empresa_id, empleado_id, sede_id, tipo, canal, lat, lng, dentro_geocerca, geocerca_id)
  values (ea, e1, s1, 'entrada', 'whatsapp', 19.4326, -99.1332, true, g) returning id into r1;
  insert into public.registros (empresa_id, empleado_id, sede_id, tipo, canal, lat, lng, dentro_geocerca)
  values (ea, e2, s2, 'entrada', 'whatsapp', 19.4, -99.1, true) returning id into r2;
  res := res || E'OK: registros válidos insertados\n';

  begin
    update public.registros set tipo = 'salida' where id = r1;
    res := res || E'FALLA: se pudo modificar un registro\n';
  exception when raise_exception then
    res := res || E'OK: UPDATE sobre registros bloqueado\n';
  end;
  begin
    delete from public.registros where id = r1;
    res := res || E'FALLA: se pudo borrar un registro\n';
  exception when raise_exception then
    res := res || E'OK: DELETE sobre registros bloqueado\n';
  end;

  -- ----- 3. No se mezclan empresas -----
  begin
    insert into public.registros (empresa_id, empleado_id, sede_id, tipo, canal, lat, lng, dentro_geocerca)
    values (eb, e1, sb, 'entrada', 'whatsapp', 19.4, -99.1, true);
    res := res || E'FALLA: se aceptó un registro que mezcla dos empresas\n';
  exception when foreign_key_violation then
    res := res || E'OK: registro que mezcla empresas rechazado\n';
  end;

  -- ----- 4. Teléfono duplicado entre empleados activos de la misma empresa -----
  begin
    insert into public.empleados (empresa_id, sede_id, nombre, telefono)
    values (ea, s1, 'Duplicado', '+525511111111');
    res := res || E'FALLA: se aceptó un teléfono duplicado\n';
  exception when unique_violation then
    res := res || E'OK: teléfono duplicado rechazado\n';
  end;

  -- ----- 5. Geocerca -----
  select x.dentro, x.distancia_m into dentro, d from public.geocerca_para(s1, 19.4326, -99.1332) x;
  res := res || case when dentro and d < 1 then E'OK: punto en el centro queda dentro\n'
                     else format(E'FALLA: centro dentro=%s distancia=%s\n', dentro, d) end;
  select x.dentro, x.distancia_m into dentro, d from public.geocerca_para(s1, 19.4426, -99.1332) x;
  res := res || case when not dentro and d between 1000 and 1200 then E'OK: punto a ~1.1 km queda fuera\n'
                     else format(E'FALLA: 1.1 km dentro=%s distancia=%s\n', dentro, d) end;

  -- ----- 6. Correcciones y vista de registros efectivos -----
  insert into public.correcciones (empresa_id, empleado_id, registro_id, tipo, nueva_hora, motivo, origen, solicitada_por)
  select ea, e1, r1, 'modificar_hora', ocurrido_at - interval '30 minutes', 'prueba', 'supervisor', us
    from public.registros where id = r1 returning id into c1;

  select corregido into corr from public.registros_efectivos where fuente_id = r1;
  res := res || case when corr = false then E'OK: corrección pendiente no cambia el registro efectivo\n'
                     else E'FALLA: una corrección pendiente ya cambió el registro efectivo\n' end;

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ua::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.resolver_correccion(c1, true, 'aprobada en prueba');
  execute 'reset role';

  select corregido, hora_efectiva into corr, hora from public.registros_efectivos where fuente_id = r1;
  res := res || case when corr then E'OK: corrección aprobada aplicada en la vista\n'
                     else E'FALLA: la corrección aprobada no aparece en la vista\n' end;

  -- ----- 7. RLS: cada rol ve solo lo suyo -----
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', us::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.registros;
  execute 'reset role';
  res := res || case when n = 1 then E'OK: supervisor ve solo los registros de su sede (1)\n'
                     else format(E'FALLA: supervisor ve %s registros, se esperaba 1\n', n) end;

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ua::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.registros;
  execute 'reset role';
  res := res || case when n = 2 then E'OK: dueño ve todos los registros de su empresa (2)\n'
                     else format(E'FALLA: dueño ve %s registros, se esperaba 2\n', n) end;

  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ub::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.registros;
  execute 'reset role';
  res := res || case when n = 0 then E'OK: otra empresa no ve nada (0)\n'
                     else format(E'FALLA: otra empresa ve %s registros\n', n) end;

  -- El panel no puede insertar registros directamente (solo el servidor)
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ua::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.registros (empresa_id, empleado_id, sede_id, tipo, canal, creado_por, motivo)
    values (ea, e1, s1, 'entrada', 'manual', ua, 'prueba');
    execute 'reset role';
    res := res || E'FALLA: un usuario del panel insertó un registro directo\n';
  exception when insufficient_privilege then
    execute 'reset role';
    res := res || E'OK: el panel no puede insertar registros directamente\n';
  end;

  -- El rol anónimo no tiene acceso a las tablas
  perform set_config('role', 'anon', true);
  begin
    select count(*) into n from public.registros;
    execute 'reset role';
    res := res || E'FALLA: el rol anónimo pudo leer registros\n';
  exception when insufficient_privilege then
    execute 'reset role';
    res := res || E'OK: el rol anónimo no puede leer registros\n';
  end;

  -- ----- 8. Triggers con usuarios del panel y funciones fuera de la API -----
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ua::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.empleados set nombre = 'Empleado 1 editado' where id = e1;
    get diagnostics n = row_count;
    execute 'reset role';
    res := res || case when n = 1 then E'OK: dueño edita un empleado (triggers funcionan con permisos revocados)\n'
                       else E'FALLA: el dueño no pudo editar un empleado\n' end;
  exception when others then
    execute 'reset role';
    res := res || format(E'FALLA: editar empleado como dueño dio error: %s\n', sqlerrm);
  end;

  select count(*) into n from public.bitacora
   where tabla = 'empleados' and fila_id = e1 and accion = 'UPDATE' and actor = ua;
  res := res || case when n = 1 then E'OK: la bitácora registró la edición con el usuario\n'
                     else format(E'FALLA: bitácora tiene %s filas para la edición, se esperaba 1\n', n) end;

  res := res || case when to_regprocedure('public.tiene_rol(uuid, public.rol_miembro[])') is null
                          and to_regprocedure('private.tiene_rol(uuid, public.rol_miembro[])') is not null
                     then E'OK: funciones de apoyo en el esquema private (fuera de la API)\n'
                     else E'FALLA: las funciones de apoyo siguen en public\n' end;

  res := res || case when not has_function_privilege('authenticated', 'public.fn_bitacora()', 'execute')
                     then E'OK: fn_bitacora no es ejecutable por usuarios\n'
                     else E'FALLA: fn_bitacora sigue ejecutable por usuarios\n' end;

  -- Fin: se lanza una excepción para revertir todo y mostrar el informe.
  raise exception E'INFORME DE LA PRUEBA (todo fue revertido; no quedó ningún dato):\n%\nResultado: %',
    res, case when res like '%FALLA%' then 'HAY FALLAS' else 'TODO OK' end;
end
$prueba$;
