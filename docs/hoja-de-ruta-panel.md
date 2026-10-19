# Hoja de ruta del panel (pedido del 2026-10-19)

Lo que el dueño pidió para el panel, separado por fases. **Fase 1 ya está hecha**; las demás esperan decisiones (ver el final).

## Fase 1: app instalable, cuenta y ayuda (hecha)
- [x] App instalable en Android (manifiesto, íconos, service worker). Se abre sin internet; los datos de empleados, selfies y sesiones **nunca** se guardan en la caché del service worker.
- [x] Barra con el usuario en grande y, debajo, la empresa y el rol.
- [x] El menú "Más" pasó a **Cuenta**: usuario, empresa, ayuda, versión, "Buscar actualización", instalar, conexión, cómo se usa y datos del desarrollador.
- [x] Actualización automática: la app busca versiones nuevas al abrirse, al volver a ella y cada hora; avisa con "Actualizar ahora". Una versión que ya esperaba al abrir se activa sola.
- [x] Sin internet: la app abre, avisa "Sin conexión" y Hoy muestra lo último cargado, marcado como tal. Los cambios (altas, correcciones) necesitan conexión.
- Al publicar un cambio hay que **subir `VERSION` en `docs/panel/sw.js`**; si no, los teléfonos no detectan la versión nueva.

## Fase 2: usuarios, roles y empresas
Pedido: en el menú, administrar usuarios y sus roles; si eres administrador de la plataforma, administrar empresas; usuarios de RH que dan de alta y baja a **sus** empleados por empresa.
- Hoy los roles viven dentro de cada empresa (`dueno`, `admin`, `supervisor`, `consulta`). No existe un rol de plataforma ni un rol "RH".
- Crear usuarios nuevos de Auth necesita la clave secreta del servidor: va en una Edge Function, nunca en el navegador.

## Fase 3: sedes, geocercas y horarios
- Administrar sedes y geocercas por empresa (mapa para colocar y ajustar el círculo).
- Modificar el horario de trabajo por empleado (tablas `horarios`, `horario_dias`, `empleado_horarios`, que ya existen).

## Fase 4: avisos y registro sin internet
- Avisar por WhatsApp al empleado que quedó registrado con la empresa X. Fuera de la ventana de 24 horas, WhatsApp exige una **plantilla aprobada por Meta**. Mientras tanto, el panel ya genera el mensaje listo para enviar desde el teléfono del dueño.
- Registro del empleado sin internet. Límite de fondo: el bot es una conversación (botón, ubicación, selfie) y sin internet el empleado no recibe los mensajes del bot. Lo que sí puede pasar es que WhatsApp guarde un mensaje enviado sin conexión y lo entregue después. Hace falta diseñar un "registro diferido" que acepte ese mensaje tardío conservando la ubicación que llevaba y marcándolo para revisión.

## Decisiones pendientes
1. ¿RH es un rol propio, o basta con "administrador" por empresa? ¿Quién es "administrador de la plataforma"?
2. Registro sin internet: ¿una ubicación enviada sin conexión cuenta como registro (con señal de revisión), o solo queda como aviso para corregir después?
3. Aviso de alta por WhatsApp: ¿se solicita la plantilla a Meta, o por ahora basta el mensaje desde el teléfono del dueño?
