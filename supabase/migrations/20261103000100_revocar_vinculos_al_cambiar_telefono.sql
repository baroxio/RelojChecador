-- Al cambiar el teléfono de un empleado, el WhatsApp anterior deja de servir de inmediato.
--
-- Antes, el vínculo anterior solo se revocaba cuando el empleado aceptaba una invitación nueva desde el
-- número nuevo; mientras tanto, el número viejo (extraviado, prestado o de alguien que ya no trabaja ahí)
-- podía seguir registrando asistencia. Ahora lo revoca la propia base, sea cual sea la vía del cambio.
--
-- * Se compara por los últimos 10 dígitos (Meta entrega los móviles de México como 521 + 10 dígitos).
--   Si el teléfono "cambia" solo de formato, el vínculo vigente no se toca.
-- * El vínculo queda en el historial (revocado_at y motivo 'telefono_cambiado'): sirve de traza.
-- * El empleado sigue activo y conserva sus consentimientos; para registrar desde el número nuevo basta
--   con una invitación nueva (el código solo funciona desde el teléfono dado de alta).
-- * La función es security definer porque el panel no puede escribir en vinculos_whatsapp.

create or replace function private.fn_revocar_vinculos_por_telefono()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.vinculos_whatsapp v
     set revocado_at = now(), motivo_revocacion = 'telefono_cambiado'
   where v.empleado_id = new.id
     and v.revocado_at is null
     and right(regexp_replace(v.wa_id, '\D', '', 'g'), 10) <> right(regexp_replace(new.telefono, '\D', '', 'g'), 10);
  return null;
end $$;

revoke all on function private.fn_revocar_vinculos_por_telefono() from public, anon, authenticated;

create trigger empleados_revocar_vinculos
  after update of telefono on public.empleados
  for each row when (old.telefono is distinct from new.telefono)
  execute function private.fn_revocar_vinculos_por_telefono();
