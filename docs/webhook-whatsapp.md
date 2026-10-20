# Webhook de WhatsApp (Edge Function)

Decisión (2026-10-16): **un número de WhatsApp compartido** para todas las empresas. Cada empleado se vincula con un código de invitación; el esquema ya soporta también un número por cliente (`numeros_whatsapp.empresa_id`).

Código: [`supabase/functions/`](../supabase/functions/) (`whatsapp-webhook`, `crear-invitacion` y `_shared`). Pruebas: `node --test supabase/functions/_shared/logic.test.ts supabase/functions/_shared/invitacion.test.ts`

## Estado

| Parte | Estado |
|---|---|
| `_shared/logic.ts`: firma de Meta, lectura del payload, comandos, secuencia, señales de riesgo | **Probada**: 11 pruebas con Node (`logic.test.ts`), todas pasan |
| `_shared/invitacion.ts`: código, enlace `wa.me`, vigencia | **Probada**: 6 pruebas (`invitacion.test.ts`) |
| `crear-invitacion/index.ts` | Probada la lógica de control con un doble de Supabase (permisos, errores, hash). **No** probada contra la base real |
| `lib/flujo.ts`, `lib/whatsapp.ts`, `index.ts` | **Sin probar.** Solo se verificó que cargan sin error de sintaxis. No se han ejecutado contra Supabase ni contra Meta |
| Formatos de la Cloud API (versión de Graph, botones, solicitud de ubicación, medios) | Escritos de memoria; **verificar con la documentación vigente de Meta** antes de desplegar |

## Flujo

```
Meta ──POST──> index.ts
                 1. verifica X-Hub-Signature-256 (si no coincide: 401)
                 2. guarda cada mensaje en mensajes_whatsapp (wamid único: un reenvío no duplica)
                 3. procesarMensaje():
                      número no registrado en numeros_whatsapp ........ se ignora
                      wa_id sin vínculo
                         ├ sin código de invitación ................. "Este número no está registrado"
                         └ con código válido y teléfono coincide ..... crea vínculo + pide aceptar aviso
                      empleado "invitado" ......................... espera "Acepto" → 3 consentimientos, pasa a "activo"
                      empleado "activo"
                         ├ E / S / pausa (texto o botón) ............ abre sesión y pide ubicación
                         ├ ubicación ................................ valida geocerca → pide selfie (o completa)
                         ├ selfie ................................... guarda en Storage → crea el registro
                         └ cualquier otro texto ..................... muestra botones
```

Reglas ya implementadas:
- **Hora que vale:** la del servidor (`ocurrido_at`); la de WhatsApp queda en `ts_cliente`.
- **Fuera de la geocerca:** la sesión se marca `rechazada` con motivo; no se crea registro.
- **Selfie** requerida según empleado, si no sede, si no empresa. Por defecto, sí.
- **Código de invitación:** solo sirve desde el teléfono dado de alta (compara los últimos 10 dígitos). Se guarda su hash, no el código.
- **Señales de riesgo** (marcan, no bloquean): `secuencia_inusual`, `ubicacion_elegida`, `ubicacion_repetida`, `foto_repetida` (misma foto exacta por `sha256`), `cambio_numero_reciente`, `hora_desfasada`, `registro_diferido` (el empleado escribió `entrada 8:55`: ver docs/hoja-de-ruta-panel.md, Fase 4).
- **Errores al procesar:** el mensaje queda con `estado = 'error'` y el webhook responde 200 para que Meta no reintente en bucle.

## Invitaciones: `crear-invitacion`

El panel llama `POST /functions/v1/crear-invitacion` con la sesión del usuario y `{ "empleado_id": "<uuid>" }`. Responde `{ codigo, enlace, expira_at, empleado }`.

- Solo **dueño o administrador** de la empresa del empleado. Un empleado que el usuario no puede ver responde 404.
- El **código** (8 símbolos, sin `0 1 I O`) se devuelve una sola vez; en la base solo se guarda su **hash sha-256**.
- Vigencia de **72 horas**. Crear otra invitación invalida las pendientes de ese empleado.
- El **enlace** es `https://wa.me/<número>?text=ALTA%20<código>`: abre WhatsApp con el mensaje listo. Usa el número propio de la empresa si existe, o el compartido. `numero_visible` debe guardarse con código de país.
- El código solo funciona desde el teléfono dado de alta del empleado; para un cambio de número, primero se actualiza el teléfono y luego se invita de nuevo.
- Queda una fila `INVITACION` en la bitácora.
- Se despliega **con** verificación de JWT (a diferencia del webhook).

## Secretos que necesita la función

| Variable | Qué es |
|---|---|
| `WHATSAPP_APP_SECRET` | Secreto de la app de Meta, para verificar la firma |
| `WHATSAPP_VERIFY_TOKEN` | Texto que tú eliges; se pone igual en Meta al configurar el webhook |
| `WHATSAPP_ACCESS_TOKEN` | Token del sistema (usuario del sistema) para enviar mensajes y bajar fotos |
| `WHATSAPP_GRAPH_VERSION` | Opcional; por defecto `v21.0`, revisar cuál es la vigente |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los pone Supabase. Los secretos **no van en el repo** (el repo es público): se cargan con `supabase secrets set` o desde el panel.

## Para desplegar (cuando haya cuenta de Meta)

1. Crear la app en Meta for Developers, agregar WhatsApp, registrar y verificar el número, y crear un token de sistema.
2. Insertar el número en `numeros_whatsapp` (`phone_number_id`, `waba_id`, `empresa_id` nulo por ser compartido).
3. `supabase secrets set ...` con las variables de arriba.
4. **Desplegar las funciones con GitHub Actions** (`.github/workflows/desplegar-funciones.yml`): al subir cambios de `supabase/functions` a `main`, primero corre las pruebas y, si pasan, despliega `whatsapp-webhook` (con `--no-verify-jwt`, porque Meta no manda JWT de Supabase) y `crear-invitacion` (con verificación de JWT). Requiere:
   - Un **token de acceso de Supabase** (Supabase, Account, Access Tokens, Generate new token). Da acceso a toda tu cuenta de Supabase: guárdalo solo como secreto de GitHub y revócalo si se filtra.
   - Guardarlo en GitHub como secreto del repo con el nombre `SUPABASE_ACCESS_TOKEN` (repo, Settings, Secrets and variables, Actions, New repository secret).
   - Para subir el archivo del workflow, el token personal de GitHub que usas con `git push` necesita además el permiso **Workflows: Read and write**.
   - También se puede lanzar a mano desde la pestaña Actions del repo (*Run workflow*).
5. En Meta, configurar la URL del webhook (`https://<proyecto>.supabase.co/functions/v1/whatsapp-webhook`), el token de verificación y suscribirse al campo `messages`.
6. Probar con un empleado de prueba.

Para tener `supabase` CLI y `deno` hace falta una máquina con permisos; en el NAS no hay Docker accesible ni Deno.

## Lecciones de la primera prueba real (2026-10-19)

Con el número de prueba de Meta y un empleado de prueba, el mensaje de un celular llegó al webhook y el bot respondió. Para llegar ahí hubo que resolver cuatro cosas que no están en la documentación obvia:

1. **El token de verificación debe ser idéntico en Meta y en Supabase.** Meta respondió "couldn't be validated" hasta que se puso el mismo valor en los dos lados (se compara con el secreto `WHATSAPP_VERIFY_TOKEN`).
2. **La cuenta de WhatsApp (WABA) debe estar suscrita a la app.** Suscribir el campo `messages` en la configuración del webhook no basta: Meta recibía los mensajes pero no los reenviaba. Se arregló con `POST /{waba-id}/subscribed_apps` usando el token de acceso. `GET /{waba-id}/subscribed_apps` muestra qué apps están suscritas; al principio solo estaba una app interna de Meta (`WA DevX Webhook Events`).
3. **Móviles de México: Meta entrega `521` + 10 dígitos, pero el envío exige `52` + 10 dígitos.** Sin esa corrección, la API responde `(#131030) Recipient phone number not in allowed list`. Lo resuelve `destinoWhatsapp()` en `_shared/logic.ts`, con prueba.
4. **Con la app sin publicar, Meta solo entrega webhooks de prueba.** La app se publicó (requirió una política de privacidad pública, en `docs/privacidad.html`, servida con GitHub Pages) y no se comprobó si hubiera funcionado sin publicarla.

Datos útiles para depurar: la tabla `mensajes_whatsapp` guarda cada mensaje entrante con su `estado` y, si falla, el `error` completo; es más fiable que la pantalla de invocaciones de Supabase, que a veces no carga.

**Probado de punta a punta con un celular real (2026-10-19):** vinculación por código, aviso de privacidad, rechazo fuera de la geocerca (con la distancia), registro de **Entrada** con ubicación dentro de la geocerca y selfie, y confirmación con hora y sede.

Pendiente de probar: salida y pausas, la secuencia inusual (por ejemplo dos entradas seguidas), la expiración de la sesión, la foto repetida y el cambio de número. Y revisar la señal `ubicacion_elegida`: en Android toda ubicación enviada trae nombre y dirección, así que la regla actual podría marcar todos los registros.

## Falta construir

1. **Pantalla del panel** que llame a `crear-invitacion` y muestre el enlace o QR al administrador.
2. **Reintentos:** un trabajo que retome los mensajes en `estado = 'error'` o `recibido` (hay un índice para eso).
3. **Estados de entrega** (`statuses` de Meta): hoy se ignoran.
4. **Plantillas** de recordatorio y alertas (fuera de la ventana de 24 horas) y su aprobación en Meta.
5. **Foto repetida por parecido** (hash perceptual): hoy solo detecta la copia exacta.
6. **Límite de respuestas** a números desconocidos, para no gastar mensajes si alguien escribe sin parar.
7. **Pruebas con base y Meta simuladas** de `flujo.ts`.
8. **Revisar la regla de selfie en el chat:** no se puede forzar la cámara; es disuasión, no prueba.
