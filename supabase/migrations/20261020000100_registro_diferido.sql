-- Registro diferido: el empleado escribe "entrada 8:55" cuando no tenía internet.
-- La sesión conserva la hora que dijo para pedir la corrección al terminar el registro.
alter table public.sesiones_registro
  add column hora_declarada timestamptz;

comment on column public.sesiones_registro.hora_declarada is
  'Hora que el empleado dice que fue (texto "entrada 8:55"). El registro conserva la hora del servidor; esta hora se manda como corrección pendiente.';
