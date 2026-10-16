# Reloj checador por WhatsApp: funcionalidades

Documento de trabajo. Parte del análisis de competidores (WhatsTime, Prodisap, FiscoClic, BotChecador, Asistia, CheckRH, Bizneo, AppChecar, Lenox HR, Sesame, Worky). Las prioridades son una propuesta nuestra: **MVP** = lanzamiento, **v2** = siguiente fase, **v3** = después.

Supuesto: "nasabetos" se interpretó como "NAS" (el Synology donde corre este proyecto en Docker).

---

## 1. Canal WhatsApp (empleado)

Usar la **WhatsApp Business Platform (Cloud API) de Meta**, no un WhatsApp común ni bibliotecas no oficiales. Esto evita bloqueos de número y es lo que ofrecen WhatsTime y Prodisap.

### 1.1 Alta y vinculación del empleado
| Función | Prioridad |
|---|---|
| Alta masiva del empleado desde el panel (nombre, teléfono, horario, sucursal) | MVP |
| Vinculación por QR o enlace de invitación: el empleado escribe al número y queda enlazado | MVP |
| Aviso de privacidad y consentimiento aceptado por el empleado dentro del chat, con fecha guardada | MVP |
| Cambio de número de teléfono con revalidación (evita que se herede o se preste el acceso) | MVP |
| Baja del empleado: el bot deja de responderle y se conserva su historial | MVP |
| Varios idiomas del bot (español primero) | v3 |

### 1.2 Registro de asistencia
| Función | Prioridad |
|---|---|
| Menú de botones: Entrada, Salida, Inicio de pausa, Fin de pausa | MVP |
| Comandos de texto equivalentes ("E", "S", "entrada", "salida") | MVP |
| Solicitud de ubicación con el botón interactivo de WhatsApp y validación contra la geocerca de la sede | MVP |
| Confirmación inmediata con hora, sede y tipo de registro | MVP |
| Detección automática de si toca entrada o salida según el último registro y el horario | MVP |
| Registro de la **hora del servidor** y de la **hora del mensaje de WhatsApp**, ambas guardadas | MVP |
| Rechazo claro cuando está fuera de la geocerca, con opción de pedir autorización al supervisor | MVP |
| Registro con jornada abierta: avisar si olvidó checar salida y permitir justificarla | MVP |
| Registro de "trabajo en campo" o visita a cliente, con nota o foto | v2 |
| Registro en nombre de otra persona por un supervisor (con bitácora) | v2 |

### 1.3 Verificación de identidad
El número de teléfono por sí solo es un identificador débil: se puede prestar el celular o compartir una ubicación elegida a mano. Es la crítica que hace Lenox HR a este canal y el hueco que ningún competidor en WhatsApp cubre bien. Propuesta por niveles, que el admin elige por sede o por empleado:

| Nivel | Cómo | Prioridad |
|---|---|---|
| Básico | Teléfono vinculado y ubicación dentro de la geocerca | MVP |
| Medio | Foto o selfie enviada por el chat en cada registro, guardada como evidencia | MVP |
| Medio | Código de un solo uso o NIP personal, además de la ubicación | v2 |
| Medio | QR dinámico en la sede (cambia cada pocos segundos) que el empleado escanea y envía; prueba presencia física | v2 |
| Alto | Enlace de un solo uso al navegador para selfie con **prueba de vida** y GPS del dispositivo | v2 |
| Alto | Reconocimiento facial comparando contra la foto de alta | v3 |

**Decisión para el MVP (2026-10-16):** ubicación dentro de la geocerca **más selfie por el chat en todos los registros** (entrada, salida y pausas). El admin puede desactivarla por sede o por empleado. Además se marcan, sin bloquear, las señales de riesgo: ubicación idéntica todos los días, salto imposible entre sedes, foto repetida (hash perceptual, sin reconocimiento facial) y cambio reciente de número. Quedan fuera del MVP: prueba de vida, reconocimiento facial, QR dinámico y código de un solo uso.

Notas de diseño:
- Descargar la selfie desde Meta poco después de recibirla (los enlaces de medios expiran pronto; confirmarlo en la documentación de Meta al construir).
- Cada registro pasa a dos mensajes del empleado; medir el tiempo real contra la meta de unos 5 a 15 segundos.
- La selfie por el chat sirve como evidencia, no como biometría. El reconocimiento facial formal exige consentimiento expreso y manejo de datos sensibles (ver sección 6).
- La ubicación compartida por WhatsApp puede no ser la real del aparato. Guardar el tipo de ubicación recibida y marcar el registro de riesgo cuando haya señales raras (precisión nula, mismo punto exacto todos los días, salto imposible entre sedes).

### 1.4 Conversación y avisos hacia el empleado
| Función | Prioridad |
|---|---|
| Consultar su horario del día y de la semana | MVP |
| Consultar sus últimos registros y horas acumuladas del periodo | MVP |
| Recordatorio de entrada y de salida (mensaje de plantilla aprobada por Meta) | v2 |
| Aviso de retardo o falta a la persona antes de que el supervisor lo vea | v2 |
| Solicitar vacaciones, permiso o incapacidad desde el chat y recibir la respuesta | v2 |
| Pedir corrección de un registro con justificación | v2 |
| Recibir y firmar documentos o avisos (acuses) | v3 |
| Consultar saldo de vacaciones | v2 |
| Mensaje de resumen de la jornada al salir | v3 |

### 1.5 Avisos hacia supervisores y dueños por WhatsApp
| Función | Prioridad |
|---|---|
| Resumen diario programable: presentes, ausentes, retardos, jornadas abiertas | MVP |
| Alerta en tiempo real de falta, retardo o registro fuera de zona | v2 |
| Aprobar o rechazar solicitudes con botones desde el chat | v2 |
| Consultas rápidas ("¿quién falta hoy?") | v3 |

### 1.6 Requisitos técnicos propios de WhatsApp
- **Webhook público con HTTPS** y verificación de la firma (`X-Hub-Signature-256`) en cada llamada.
- **Idempotencia**: Meta puede reenviar el mismo mensaje; no duplicar registros. Guardar el identificador del mensaje (`wamid`) con restricción única.
- **Cola de proceso**: responder al webhook rápido (200) y procesar aparte; reintentos con espera creciente.
- **Ventana de 24 horas**: dentro de ella se responde libremente. Fuera de ella solo se pueden enviar **plantillas** aprobadas por Meta (recordatorios, resúmenes, alertas). Planear las plantillas desde el inicio.
- **Costos por conversación o mensaje**: las tarifas de Meta cambian. El artículo de Lenox HR menciona cobros para mensajes de servicio desde el 1 de octubre de 2026; no lo verifiqué con Meta. Revisar el precio vigente antes de fijar nuestro precio de venta.
- **Número de WhatsApp por cliente o compartido**: decidir si cada empresa usa su propio número verificado o un número nuestro. Un número compartido es más barato y simple; uno propio da marca, pero exige verificación de negocio por cliente.
- Almacenar el mensaje original (payload) como evidencia, además del registro interpretado.

---

## 2. Registro y validación (núcleo, independiente del canal)

| Función | Prioridad |
|---|---|
| Registro inmutable: no se edita ni se borra, solo se agregan correcciones con traza | MVP |
| Correcciones con quién, cuándo, qué había antes y motivo | MVP |
| Sello de tiempo del servidor, zona horaria por sede | MVP |
| Geocercas circulares por sede (radio configurable) | MVP |
| Varias geocercas por empleado (sucursal, obra, domicilio para home office) | v2 |
| Horarios y turnos: fijos, rotativos, nocturnos, partidos, flexibles | MVP |
| Tolerancia de retardo y de salida anticipada configurable | MVP |
| Pausas y comidas descontables o no | MVP |
| Cálculo de horas ordinarias, dobles y triples según la LFT | v2 |
| Horas extra con aprobación previa y topes de semáforo | v2 |
| Calendario de días festivos y descansos obligatorios | MVP |
| Cierre de periodo: bloquea cambios después de la fecha de corte | v2 |
| Evidencia exportable ante la STPS: registros con sello, traza de correcciones y conservación mínima de un año | MVP |
| Detección de señales de fraude (ubicación repetida, saltos imposibles, mismo dispositivo para varios empleados) | v3 |

---

## 3. Panel web (administrador, RH, supervisor)

### 3.1 Estructura y roles
| Función | Prioridad |
|---|---|
| Multiempresa y multisede desde el inicio | MVP |
| Roles: dueño, administrador, supervisor por sede, consulta, empleado | MVP |
| Permisos por sede o departamento: el supervisor solo ve a su gente | MVP |
| Inicio de sesión con correo y contraseña, y doble factor | v2 |
| Bitácora de acciones de los administradores | MVP |

### 3.2 Personas y configuración
| Función | Prioridad |
|---|---|
| Alta, edición y baja de empleados; importación masiva por Excel | MVP |
| Asignación de horario, sede y supervisor | MVP |
| Mapa para dibujar y ajustar geocercas | MVP |
| Configuración de reglas: tolerancias, pausas, redondeo | MVP |
| Configuración de plantillas de aviso | v2 |
| Aviso de privacidad y consentimientos por empleado | MVP |

### 3.3 Operación diaria
| Función | Prioridad |
|---|---|
| Tablero del día: presentes, ausentes, retardos, jornadas abiertas | MVP |
| Mapa de registros con ubicación y foto | MVP |
| Lista de registros con filtros por persona, sede, fecha y estado | MVP |
| Registro manual por el admin, con motivo y traza | MVP |
| Aprobación de correcciones, permisos, vacaciones, incapacidades | v2 |
| Calendario de ausencias y vacaciones | v2 |
| Alertas configurables (retardo, falta, fuera de zona) | v2 |
| Rastreo de ruta del personal en campo con consentimiento | v3 |

### 3.4 Reportes y exportaciones
| Función | Prioridad |
|---|---|
| Reporte de asistencia por periodo: entradas, salidas, retardos, faltas, horas | MVP |
| Exportación a Excel/CSV y PDF | MVP |
| Reporte de horas extra y de horas por clasificar (ordinarias, dobles, triples) | v2 |
| Prenómina no fiscal: días trabajados, extras, descuentos por falta | v2 |
| Exportación compatible con sistemas de nómina (NOI, Contpaqi, layout propio) | v2 |
| Reporte para inspección STPS | MVP |
| Indicadores de ausentismo y puntualidad | v3 |
| Análisis con IA de patrones de retardos | v3 |

### 3.5 Integraciones y plataforma
| Función | Prioridad |
|---|---|
| API REST y webhooks de salida | v2 |
| Importación de personal desde el sistema de nómina | v3 |
| Facturación y cobro de suscripción dentro del propio producto | MVP |
| Respaldo y exportación completa de datos del cliente | MVP |

---

## 4. App móvil (empleado y supervisor)

Un canal adicional, no un reemplazo de WhatsApp. Sirve donde WhatsApp es débil: identidad, GPS confiable, sin internet.

### 4.1 App del empleado
| Función | Prioridad |
|---|---|
| Registrar entrada, salida y pausas con un toque | v2 |
| GPS del dispositivo con precisión, y detección de ubicación falsa (mock location) | v2 |
| Selfie con prueba de vida al checar | v2 |
| Reconocimiento facial contra la foto de alta, con consentimiento | v3 |
| Modo sin internet: guarda el registro con sello del aparato y sincroniza después, marcado como diferido | v2 |
| Ver horario, historial y horas acumuladas | v2 |
| Solicitar vacaciones, permisos y correcciones; ver el estado | v2 |
| Notificaciones push de recordatorio | v2 |
| Vinculación del aparato al empleado (un empleado, un aparato; cambio con aprobación) | v2 |
| Pantalla de privacidad y consentimientos | v2 |

### 4.2 App del supervisor o administrador
| Función | Prioridad |
|---|---|
| Tablero del día en el celular | v2 |
| Aprobar solicitudes y correcciones | v2 |
| Mapa del equipo | v2 |
| Registrar en nombre de alguien o autorizar un registro fuera de zona | v2 |
| Alertas push de ausencias y retardos | v2 |

### 4.3 Kiosco (tablet fija en la sede)
| Función | Prioridad |
|---|---|
| Pantalla de recepción con QR dinámico para que el empleado lo escanee con su WhatsApp | v2 |
| Registro por número de empleado y NIP, o por rostro | v3 |
| Funcionamiento offline con sincronización | v3 |

Se puede construir una **PWA** (web instalable) primero, para validar antes de invertir en apps nativas de Android y iOS.

---

## 5. Web de empleado (autoservicio)

Página responsive a la que el empleado llega por un enlace del bot. No requiere instalar nada.

| Función | Prioridad |
|---|---|
| Enlace de un solo uso que expira, enviado por el bot | v2 |
| Registro con selfie y GPS del navegador | v2 |
| Historial y horario propios | v2 |
| Solicitudes de permiso, vacaciones y correcciones | v2 |
| Descarga de su propio reporte | v3 |

---

## 6. Cumplimiento y privacidad

Los datos de asistencia, ubicación y fotos son datos personales. Los biométricos son sensibles.

- **LFT, fracción XXXIV del artículo 132**: FiscoClic, BotChecador, Bizneo y Lenox HR dicen que desde el 1 de enero de 2027 será obligatorio un registro electrónico de la jornada. **No lo verifiqué en el DOF**; confirmarlo con una fuente oficial o un asesor laboral antes de usarlo en nuestro marketing.
- **Aviso de privacidad y consentimiento** (LFPDPPP): finalidad, quién ve los datos, plazo de conservación, derechos ARCO.
- **Ubicación**: capturarla solo al registrar, sin rastreo en segundo plano. Es lo que prometen BotChecador y Bizneo y facilita el consentimiento.
- **Biométricos**: guardar un vector, no la foto, y solo con consentimiento expreso, reversible (así lo plantea WhatsTime). Valorar un análisis jurídico antes de lanzar facial.
- **Conservación**: conservar los registros al menos un año; configurar el plazo máximo y el borrado al finalizar.
- **Evidencia**: registro inmutable, sello de tiempo del servidor, traza de correcciones.
- **Seguridad**: cifrado en tránsito y en reposo, acceso por rol, bitácora, respaldos, separación entre empresas (RLS en Postgres).

---

## 7. No funcionales

- **Disponibilidad del webhook**: si el servicio cae, se pierden mensajes o se retrasan. Meta reintenta durante un tiempo limitado.
- **Rendimiento**: confirmación al empleado en pocos segundos (los competidores prometen unos 5).
- **Escala**: el pico es a la hora de entrada; probar cientos de registros en el mismo minuto.
- **Observabilidad**: logs, métricas y alertas sobre el webhook y la cola.
- **Pruebas**: simular el webhook de Meta localmente.
- **Costos**: medir costo por empleado al mes (mensajes de Meta + infraestructura) antes de fijar precio.

---

## 8. Supabase y el NAS: replicación

### Respuesta corta
**Sí, se puede**, con una dirección clara: **Supabase en la nube como principal y la base del NAS como réplica** (suscriptora). Replicar en ambos sentidos con escritura en los dos lados es lo que conviene evitar.

### Qué dice la documentación
- Supabase documenta la replicación lógica de Postgres **con Supabase como publicador y otra base de datos Postgres externa como suscriptora**: se crea una publicación y una ranura de replicación en Supabase, y en la base externa se ejecuta `CREATE SUBSCRIPTION` ([guía oficial](https://supabase.com/docs/guides/database/postgres/setup-replication-external)).
- Requiere una **conexión directa**, no el pooler de conexiones, y que el destino soporte **IPv6** (o activar el complemento IPv4 de pago en el proyecto).
- El nombre `supabase_realtime` está reservado para la publicación de Realtime; hay que crear otra con un nombre propio.
- La base del **Supabase autoalojado en Docker** es Postgres, por lo que puede actuar como suscriptora. Supabase autoalojado se despliega con Docker Compose ([guía](https://supabase.com/docs/guides/hosting/docker)).

### Lo que no pude confirmar
- **El sentido contrario** (NAS publica y la nube de Supabase se suscribe). No encontré documentación; la nube administrada limita los privilegios de superusuario, y `CREATE SUBSCRIPTION` requiere un rol con `pg_create_subscription`. Habría que probarlo o preguntar a Supabase antes de depender de eso.
- **Si el plan de Supabase que contratemos permite las ranuras de replicación** y cuántas. Revisar en el plan.

### Arquitectura recomendada
```
WhatsApp (Meta) ──webhook──> Supabase nube (Edge Function / API)  ← siempre en línea, IP pública estable
                                   │  escribe
                                   ▼
                           Postgres de Supabase (PRINCIPAL)
                                   │  replicación lógica (publicación)
                                   ▼  (el NAS inicia la conexión, solo salida)
                           Postgres en el NAS (RÉPLICA)
                                   │
                           respaldos (Hyper Backup), reportes internos, panel de respaldo
```

Por qué así:
- El **webhook de Meta necesita una URL pública con HTTPS siempre disponible**. En un NAS casero eso depende de IP dinámica, puertos abiertos, el módem del proveedor y cortes de luz. En la nube es más confiable.
- Con el NAS como suscriptor, la conexión **sale** del NAS hacia la nube. No hace falta abrir puertos en el NAS.
- Escribir en un solo lado evita conflictos. La replicación lógica de Postgres **no resuelve conflictos** si dos lados modifican la misma fila.

### Limitaciones de la replicación lógica que hay que planear
| Tema | Qué pasa | Qué hacer |
|---|---|---|
| Cambios de esquema (DDL) | **No se replican.** Una columna nueva en la nube rompe la suscripción hasta crearla en el NAS | Aplicar las mismas migraciones (`supabase db push`) en ambos lados, primero en la réplica |
| Secuencias | No se sincronizan los valores | Usar `uuid` como llave primaria |
| Archivos (Storage) | Los archivos están en un almacén aparte, no en Postgres | Respaldar fotos por separado (rclone o sincronización del bucket) |
| Usuarios (Auth) | El esquema `auth` se puede publicar, pero requiere cuidado con contraseñas y sesiones | Decidir si la réplica es solo de lectura o si debe poder levantar el sistema completo |
| Realtime | No se replica el servicio, solo los datos | Es un servicio aparte en cada lado |
| Retraso | La réplica puede ir atrasada segundos o minutos | No usarla como fuente de verdad para el registro en vivo |
| Ranura sin consumir | Si el NAS se apaga mucho tiempo, la ranura acumula WAL y puede llenar el disco de la nube | Monitorear y poner un límite de retención (`max_slot_wal_keep_size`) |
| Tablas sin llave primaria | No se pueden replicar actualizaciones | Toda tabla con llave primaria |

### Para qué sirve la réplica en el NAS
1. **Respaldo vivo** de los registros, fuera del proveedor.
2. **Reportes pesados** sin cargar la base principal.
3. **Plan de contingencia**: levantar el servicio desde el NAS si la nube falla. Eso exige práctica y es un **cambio manual**, no automático.
4. **Cumplimiento y propiedad de los datos**: una copia bajo control del cliente o nuestro.

### Alternativas más simples
- **Respaldos programados** (`pg_dump` diario más Hyper Backup del NAS). Menos piezas y suficiente al principio.
- **Todo en el NAS** con Supabase autoalojado y un **túnel de Cloudflare** para exponer el webhook sin abrir puertos. Más barato, pero una sola falla (luz, internet, disco) deja de recibir registros.

### Recomendación
Empezar con **Supabase en la nube como único principal** y **respaldos programados al NAS**. Agregar la réplica lógica en la fase siguiente, cuando haya clientes y una necesidad concreta. Si se quiere contingencia automática, eso es otro proyecto aparte y de mayor costo.

---

## 9. Pendientes para decidir

1. ¿Número de WhatsApp compartido o uno por cliente?
2. ¿Qué nivel de verificación de identidad entra al MVP: solo ubicación, o ubicación más selfie por el chat?
3. ¿PWA primero o app nativa directo?
4. ¿Nómina propia o solo exportación? (FiscoClic y AppChecar la venden; WhatsTime, Prodisap y BotChecador no.)
5. Modelo de precio: por empleado al mes, por tramos, o por registro.
6. Confirmar la reforma de la LFT con una fuente oficial.
7. Probar con una prueba piloto la replicación lógica de Supabase a la base del NAS.
