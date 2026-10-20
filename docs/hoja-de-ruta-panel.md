# Hoja de ruta del panel (pedido del 2026-10-19)

Lo que el dueño pidió para el panel, separado por fases. **Fase 1 ya está hecha**; las demás esperan decisiones (ver el final).

## Fase 1: app instalable, cuenta y ayuda (hecha)
- [x] App instalable en Android (manifiesto, íconos, service worker). Se abre sin internet; los datos de empleados, selfies y sesiones **nunca** se guardan en la caché del service worker.
- [x] Barra con el usuario en grande y, debajo, la empresa y el rol.
- [x] El menú "Más" pasó a **Cuenta**: usuario, empresa, ayuda, versión, "Buscar actualización", instalar, conexión, cómo se usa y datos del desarrollador.
- [x] Actualización automática: la app busca versiones nuevas al abrirse, al volver a ella y cada hora; avisa con "Actualizar ahora". Una versión que ya esperaba al abrir se activa sola.
- [x] Sin internet: la app abre, avisa "Sin conexión" y Hoy muestra lo último cargado, marcado como tal. Los cambios (altas, correcciones) necesitan conexión.
- Al publicar un cambio hay que **subir `VERSION` en `docs/panel/sw.js`**; si no, los teléfonos no detectan la versión nueva.

## Fase 2: usuarios, roles y empresas (construida; falta aplicarla y probarla en vivo)
Decisión del dueño: **RH es simplemente administrador de su empresa**; no hay un rol nuevo. Los roles siguen siendo dueño, administrador, supervisor y consulta.

Reglas (las aplica el servidor; el panel solo muestra u oculta opciones):
- El **dueño** puede dar de alta a cualquier rol, incluido otro dueño o administrador.
- El **administrador** da de alta, cambia, da de baja y reinicia la contraseña de **supervisores y consulta**. No toca a dueños ni a otros administradores.
- Nadie cambia su propio rol ni se da de baja a sí mismo, y la empresa siempre conserva al menos un dueño activo.
- Un usuario dado de baja no puede hacer nada.
- Pueden dar de alta o baja a empleados el dueño y el administrador (ya era así).

Piezas:
- `supabase/migrations/20261019000300_usuarios_y_plataforma.sql`: tabla `plataforma_admins` (**vacía**), función `miembros_de_empresa()` y `usuario_id_por_correo()`.
- Edge Function `administrar` (crear usuario, cambiar rol, baja y reactivación, reiniciar clave; y, solo para el administrador de la plataforma, listar, crear y renombrar empresas y unirse a una). Crea el usuario de Auth con una **contraseña temporal de un solo uso**, que se muestra una vez; al entrar, la app obliga a elegir una propia.
- Panel: pantalla **Administrar** (Usuarios y, si aplica, Empresas), cambio de empresa para quien pertenece a varias, y cambio de contraseña en Cuenta.
- Pruebas: 7 de reglas de permisos y 25 de la función con base simulada, más las de la interfaz.

### Para activarla (pasos del dueño del proyecto)
1. Correr la migración en el SQL Editor de Supabase.
2. `git push`: el flujo de GitHub Actions despliega la función `administrar`.
3. **Opcional: ser administrador de la plataforma.** Solo si quieres administrar todas las empresas, corre (con tu correo):
```sql
insert into public.plataforma_admins (user_id)
select id from auth.users where email = 'TU_CORREO'
returning user_id;
```
   Sin esa fila, nadie ve la pestaña Empresas.

## Fase 3: sedes, geocercas y horarios (hecha, falta probar en vivo)
Todo se escribe desde el panel con la sesión del usuario: las políticas RLS que ya existían (`sedes_write`, `geocercas_write`, `horarios_write`, `horario_dias_write`, `empleado_horarios_write`) permiten solo a dueño y administrador, así que no hace falta función de servidor ni migración.
- **Administrar > Lugares:** crear y editar sedes (nombre, dirección, zona horaria de México), desactivarlas, y por sede agregar, editar y desactivar geocercas. La ubicación se toma con "Usar mi ubicación actual" parado en el lugar, o pegando las coordenadas de Google Maps; el radio va de 10 a 5000 m. Las geocercas no se borran porque los registros las referencian: se desactivan.
- **Administrar > Horarios:** crear, editar y eliminar horarios con días, entrada, salida, pausa y tolerancias. Un horario asignado a empleados no se puede eliminar.
- **Equipo > detalle del empleado:** asignar o quitar el horario. El cambio rige desde hoy: la asignación vigente se cierra hoy y queda en el historial (`empleado_horarios.vigencia`).
- Pendiente: mapa dibujado para ajustar el círculo (se evitó un servicio de mapas externo por privacidad y para que el panel siga funcionando sin dependencias), jornada partida desde la pantalla (la base ya la soporta) y días festivos.

## Fase 4: avisos y registro sin internet (construida, falta migrar, desplegar y probar con celular)
**Registro sin internet ("registro diferido").** Límite de fondo: sin internet el empleado no recibe los mensajes del bot, y la hora que Meta entrega es la de **recepción en sus servidores**, no la del celular. Por eso la hora de un registro hecho sin conexión no se puede deducir; la declara el empleado:
1. Sin internet escribe `entrada 8:55` (o `salida 18:05`, `pausa 14:00`), comparte su ubicación y manda su selfie. WhatsApp los entrega en orden al reconectar.
2. El bot los procesa como un registro normal: se valida la geocerca con la ubicación enviada y el registro queda con la hora del servidor (los registros no se editan).
3. Si la hora que dijo difiere más de 3 minutos de la del servidor, el registro lleva la señal `registro_diferido` y se crea una **corrección pendiente** (`modificar_hora`, origen `empleado`) con su hora. En Correcciones el supervisor la ve como "Pedida por el empleado" y la aprueba o rechaza; solo al aprobarla cambia la hora efectiva.
- La hora debe ser de las últimas 24 h; una hora que aún no llega hoy se entiende como de ayer; más de 5 min en el futuro se rechaza.
- Migración: `20261020000100_registro_diferido.sql` (columna `sesiones_registro.hora_declarada`).

**Aviso de alta por WhatsApp.** `crear-invitacion` envía una plantilla de Meta al empleado cuando existe el secreto `WHATSAPP_PLANTILLA_ALTA`. Sin él (o si Meta falla) todo sigue como antes: el panel ofrece el botón "Enviar por WhatsApp" desde el teléfono del dueño. Para activarlo:
1. En Meta (WhatsApp Manager > Plantillas) crear una plantilla de categoría *Utilidad*, idioma español (México), con este cuerpo y 3 variables: `Hola {{1}}, {{2}} te dio de alta para registrar tu asistencia por WhatsApp. Toca este enlace y envía el mensaje que aparece: {{3}}`
2. Esperar su aprobación y guardar los secretos de funciones: `WHATSAPP_PLANTILLA_ALTA` (nombre exacto de la plantilla) y, si no es es_MX, `WHATSAPP_PLANTILLA_IDIOMA`.

## Decisiones pendientes
1. ~~RH~~ Resuelto: RH = administrador de la empresa. Falta decidir quién será administrador de la plataforma (ver Fase 2).
2. ~~Registro sin internet~~ Resuelto por defecto: cuenta como registro con señal y corrección pendiente (ver Fase 4). Se puede cambiar si prefieres que solo quede como aviso.
3. Aviso de alta por WhatsApp: el código ya está listo; falta solicitar la plantilla a Meta (pasos en la Fase 4). Mientras tanto funciona el mensaje desde el teléfono del dueño.
