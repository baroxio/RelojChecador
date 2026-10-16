# Webhook de WhatsApp (Edge Function)

Decisión (2026-10-16): **un número de WhatsApp compartido** para todas las empresas. Cada empleado se vincula con un código de invitación; el esquema ya soporta también un número por cliente (`numeros_whatsapp.empresa_id`).

Código: [`supabase/functions/whatsapp-webhook/`](../supabase/functions/whatsapp-webhook/)

## Estado

| Parte | Estado |
|---|---|
| `lib/logic.ts`: firma de Meta, lectura del payload, comandos, secuencia, señales de riesgo | **Probada**: 11 pruebas con Node (`logic.test.ts`), todas pasan |
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
- **Señales de riesgo** (marcan, no bloquean): `secuencia_inusual`, `ubicacion_elegida`, `ubicacion_repetida`, `foto_repetida` (misma foto exacta por `sha256`), `cambio_numero_reciente`, `hora_desfasada`.
- **Errores al procesar:** el mensaje queda con `estado = 'error'` y el webhook responde 200 para que Meta no reintente en bucle.

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
4. `supabase functions deploy whatsapp-webhook --no-verify-jwt`. Sin esa bandera Supabase rechazaría a Meta por no traer JWT.
5. En Meta, configurar la URL del webhook (`https://<proyecto>.supabase.co/functions/v1/whatsapp-webhook`), el token de verificación y suscribirse al campo `messages`.
6. Probar con un empleado de prueba.

Para tener `supabase` CLI y `deno` hace falta una máquina con permisos; en el NAS no hay Docker accesible ni Deno.

## Falta construir

1. **Crear invitaciones:** nada genera aún el código y el enlace `wa.me/<número>?text=ALTA%20CODIGO` ni guarda su hash. Va con el panel o una función aparte.
2. **Reintentos:** un trabajo que retome los mensajes en `estado = 'error'` o `recibido` (hay un índice para eso).
3. **Estados de entrega** (`statuses` de Meta): hoy se ignoran.
4. **Plantillas** de recordatorio y alertas (fuera de la ventana de 24 horas) y su aprobación en Meta.
5. **Foto repetida por parecido** (hash perceptual): hoy solo detecta la copia exacta.
6. **Límite de respuestas** a números desconocidos, para no gastar mensajes si alguien escribe sin parar.
7. **Pruebas con base y Meta simuladas** de `flujo.ts`.
8. **Revisar la regla de selfie en el chat:** no se puede forzar la cámara; es disuasión, no prueba.
