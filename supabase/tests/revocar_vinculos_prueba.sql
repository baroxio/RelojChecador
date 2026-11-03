-- Prueba de la migración 20261103000100 (revocar el WhatsApp anterior al cambiar el teléfono).
-- Se ejecuta en el SQL Editor de Supabase DESPUÉS de aplicar la migración. No deja ningún dato:
-- todo termina en una excepción a propósito, cuyo mensaje es el informe (OK o FALLA por línea).

do $prueba$
declare
  ea uuid := gen_random_uuid(); s1 uuid := gen_random_uuid();
  ua uuid := gen_random_uuid(); ma uuid := gen_random_uuid(); us uuid := gen_random_uuid(); ms uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); e3 uuid := gen_random_uuid();
  nid uuid := gen_random_uuid();
  v1 uuid := gen_random_uuid(); v2 uuid := gen_random_uuid(); v3 uuid := gen_random_uuid();
  fila record; n integer;
  res text := '';
begin
  insert into auth.users (id, aud, role, email) values
    (ua, 'authenticated', 'authenticated', 'dueno@prueba.local'),
    (us, 'authenticated', 'authenticated', 'sup@prueba.local');
  insert into public.empresas (id, nombre) values (ea, 'Empresa de prueba');
  insert into public.sedes (id, empresa_id, nombre) values (s1, ea, 'Sede 1');
  insert into public.miembros (id, empresa_id, user_id, rol) values (ma, ea, ua, 'dueno'), (ms, ea, us, 'supervisor');
  insert into public.empleados (id, empresa_id, sede_id, nombre, telefono, estado) values
    (e1, ea, s1, 'Ana', '+523312345678', 'activo'),
    (e2, ea, s1, 'Beto', '+523311112222', 'activo'),
    (e3, ea, s1, 'Carla', '+523300001111', 'activo');
  insert into public.numeros_whatsapp (id, phone_number_id) values (nid, 'pn-prueba');
  -- Meta entrega los móviles de México como 521 + 10 dígitos.
  insert into public.vinculos_whatsapp (id, empresa_id, empleado_id, numero_id, wa_id) values
    (v1, ea, e1, nid, '5213312345678'), (v2, ea, e2, nid, '5213311112222'), (v3, ea, e3, nid, '5213300001111');

  -- 1. Cambiar otro dato no toca el vínculo.
  update public.empleados set nombre = 'Ana María' where id = e1;
  select count(*) into n from public.vinculos_whatsapp where empleado_id = e1 and activo;
  res := res || case when n = 1 then E'OK: cambiar el nombre no revoca el vínculo\n' else E'FALLA: cambiar el nombre revocó el vínculo\n' end;

  -- 2. El mismo número escrito de otra forma (con el 1 intermedio) no revoca.
  update public.empleados set telefono = '+5213312345678' where id = e1;
  select count(*) into n from public.vinculos_whatsapp where empleado_id = e1 and activo;
  res := res || case when n = 1 then E'OK: el mismo número con otro formato no revoca\n' else E'FALLA: revocó por un cambio solo de formato\n' end;

  -- 3. Un número distinto revoca de inmediato y deja el motivo.
  update public.empleados set telefono = '+523399990000' where id = e1;
  select * into fila from public.vinculos_whatsapp where id = v1;
  res := res || case when fila.revocado_at is not null and not fila.activo and fila.motivo_revocacion = 'telefono_cambiado'
                     then E'OK: el WhatsApp anterior quedó revocado con su motivo\n'
                     else E'FALLA: el vínculo anterior sigue activo\n' end;

  -- 4. Los vínculos de otros empleados no se tocan.
  select count(*) into n from public.vinculos_whatsapp where empleado_id in (e2, e3) and activo;
  res := res || case when n = 2 then E'OK: los vínculos de otros empleados siguen activos\n' else E'FALLA: se revocaron vínculos ajenos\n' end;

  -- 5. El empleado sigue activo (conserva su alta y consentimientos).
  res := res || case when (select estado from public.empleados where id = e1) = 'activo'
                     then E'OK: el empleado sigue activo\n' else E'FALLA: cambió el estado del empleado\n' end;

  -- 6. Por la vía del panel (usuario con rol de dueño): el cambio funciona y también revoca,
  --    aunque el panel no pueda escribir en vinculos_whatsapp.
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ua::text, true);
  perform set_config('role', 'authenticated', true);
  update public.empleados set telefono = '+523388887777' where id = e2;
  execute 'reset role';
  select * into fila from public.vinculos_whatsapp where id = v2;
  res := res || case when fila.revocado_at is not null and fila.motivo_revocacion = 'telefono_cambiado'
                     then E'OK: el dueño cambia el teléfono desde el panel y el vínculo se revoca\n'
                     else E'FALLA: por la vía del panel no se revocó el vínculo\n' end;

  -- 7. Un supervisor no puede cambiar teléfonos (RLS) y por tanto no revoca nada.
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', us::text, true);
  perform set_config('role', 'authenticated', true);
  update public.empleados set telefono = '+523377776666' where id = e3;
  execute 'reset role';
  select count(*) into n from public.vinculos_whatsapp where id = v3 and activo;
  res := res || case when n = 1 and (select telefono from public.empleados where id = e3) = '+523300001111'
                     then E'OK: el supervisor no puede cambiar teléfonos ni revocar vínculos\n'
                     else E'FALLA: el supervisor pudo cambiar un teléfono\n' end;

  -- 8. La función del disparador no es ejecutable por los usuarios de la API.
  res := res || case when not has_function_privilege('authenticated', 'private.fn_revocar_vinculos_por_telefono()', 'execute')
                          and not has_function_privilege('anon', 'private.fn_revocar_vinculos_por_telefono()', 'execute')
                     then E'OK: la función de revocación no es ejecutable por anon ni authenticated\n'
                     else E'FALLA: la función de revocación es ejecutable desde la API\n' end;

  raise exception E'INFORME DE LA PRUEBA (todo fue revertido; no quedó ningún dato):\n%\nResultado: %',
    res, case when res like '%FALLA%' then 'HAY FALLAS' else 'TODO OK' end;
end
$prueba$;
