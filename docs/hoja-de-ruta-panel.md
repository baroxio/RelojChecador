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

## Fase 3: sedes, geocercas y horarios
- Administrar sedes y geocercas por empresa (mapa para colocar y ajustar el círculo).
- Modificar el horario de trabajo por empleado (tablas `horarios`, `horario_dias`, `empleado_horarios`, que ya existen).

## Fase 4: avisos y registro sin internet
- Avisar por WhatsApp al empleado que quedó registrado con la empresa X. Fuera de la ventana de 24 horas, WhatsApp exige una **plantilla aprobada por Meta**. Mientras tanto, el panel ya genera el mensaje listo para enviar desde el teléfono del dueño.
- Registro del empleado sin internet. Límite de fondo: el bot es una conversación (botón, ubicación, selfie) y sin internet el empleado no recibe los mensajes del bot. Lo que sí puede pasar es que WhatsApp guarde un mensaje enviado sin conexión y lo entregue después. Hace falta diseñar un "registro diferido" que acepte ese mensaje tardío conservando la ubicación que llevaba y marcándolo para revisión.

## Decisiones pendientes
1. ~~RH~~ Resuelto: RH = administrador de la empresa. Falta decidir quién será administrador de la plataforma (ver Fase 2).
2. Registro sin internet: ¿una ubicación enviada sin conexión cuenta como registro (con señal de revisión), o solo queda como aviso para corregir después?
3. Aviso de alta por WhatsApp: ¿se solicita la plantilla a Meta, o por ahora basta el mensaje desde el teléfono del dueño?
