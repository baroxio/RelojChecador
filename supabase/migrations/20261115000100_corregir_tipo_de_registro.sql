-- Permite que una corrección de tipo `modificar_hora` también cambie el tipo del registro
-- (por ejemplo, una «salida» que en realidad fue el «fin de pausa»). Si `nuevo_tipo` es nulo,
-- el tipo no cambia, así que las correcciones anteriores siguen funcionando igual.
create or replace view public.registros_efectivos with (security_invoker = true) as
  select 'registro'::text as origen,
         r.id             as fuente_id,
         r.empresa_id, r.empleado_id, r.sede_id,
         coalesce(m.nuevo_tipo, r.tipo) as tipo,
         coalesce(m.nueva_hora, r.ocurrido_at) as hora_efectiva,
         r.ocurrido_at    as hora_original,
         r.canal, r.dentro_geocerca, r.senales, r.medio_id,
         (m.id is not null) as corregido
    from public.registros r
    left join lateral (
      select c.id, c.nueva_hora, c.nuevo_tipo
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
