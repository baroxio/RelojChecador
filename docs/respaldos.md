# Respaldo diario al NAS

Hasta ahora Supabase era el único lugar de los datos: su API no lista respaldos y no hay recuperación a un punto en el tiempo. Este respaldo copia cada día la base y las selfies a tu NAS Synology.

Archivos: [`respaldo/respaldar.sh`](../respaldo/respaldar.sh) (el script), [`respaldo/respaldo.env.ejemplo`](../respaldo/respaldo.env.ejemplo) (la configuración), [`respaldo/crear_usuario_respaldo.sql`](../respaldo/crear_usuario_respaldo.sql) (usuario de solo lectura). Prueba: `bash tests/respaldo/prueba.sh`.

## Qué respalda

| Qué | Dónde queda en el NAS | Contenido |
|---|---|---|
| La base | `db/base-AAAA-MM-DD.dump` | Estructura y datos de los esquemas `public` y `private`: empresas, sedes, empleados, registros, correcciones, bitácora, horarios y las reglas de seguridad |
| Usuarios del panel | `db/auth-AAAA-MM-DD.dump` | Solo los datos de `auth.users` y `auth.identities` |
| Selfies | `selfies/` | Copia del bucket privado. **Solo agrega:** si una selfie desaparece de Supabase, la copia del NAS se queda |
| Señal de vida | `ESTADO.txt` y `logs/` | Cuándo fue el último respaldo bueno y el detalle de cada corrida |

Se conservan **todos los respaldos de los últimos 30 días** y **el del día 1 de cada mes durante 12 meses**. Los valores se cambian en `respaldo.env`.

El script **verifica cada archivo antes de darlo por bueno**: que `pg_restore` lo pueda leer, que traiga las tablas importantes y que no esté casi vacío. Si algo falla, termina con error, no deja un respaldo falso y no actualiza `ESTADO.txt`.

## Lo que necesitas
- El NAS con **Container Manager** (DSM 7) y espacio libre. Por referencia, la base de hoy pesa poco; lo que crece son las selfies.
- Acceso de administrador a DSM y a tu proyecto de Supabase.
- Unos 30 minutos la primera vez.

## Paso a paso

### 1. Usuario de solo lectura en Supabase
Así, si alguien roba la contraseña guardada en el NAS, puede leer pero no cambiar ni borrar nada.
1. Abre [`respaldo/crear_usuario_respaldo.sql`](../respaldo/crear_usuario_respaldo.sql) y cambia `PON_AQUI_UNA_CONTRASENA_LARGA` por una contraseña larga de **solo letras y números**. Guárdala: la usarás en el paso 3.
2. Pégalo completo en el **SQL Editor** de Supabase y córrelo. Al final debe mostrar `respaldo | t`.
3. Si el primer comando da error por `BYPASSRLS`, no te quedes sin respaldo: usa el usuario `postgres` (con su contraseña) en el paso 3. Tiene más permisos, pero el respaldo es el mismo.

### 2. Llaves S3 para las selfies
En Supabase: **Project Settings > Storage > S3 Connection > New access key**. Copia el *Access key ID* y el *Secret access key* (el secreto solo se muestra una vez) y el *Endpoint*.

### 3. La cadena de conexión
En Supabase, botón **Connect** > **Session pooler** > URI. Reemplaza la contraseña por la del usuario `respaldo` (el usuario tiene la forma `respaldo.bclmvyifdxalnfxzjmyj`). Usa el pooler porque funciona por IPv4; la conexión directa puede requerir IPv6.

### 4. Preparar el NAS
1. **Panel de control > Carpeta compartida > Crear** una carpeta `respaldos`. Conviene **cifrarla** (opción al crearla): los respaldos tienen datos personales y contraseñas cifradas de los usuarios.
2. Dentro, crea la carpeta `relojchecador`. Copia ahí (File Station) `respaldar.sh` y `respaldo.env.ejemplo`; renombra este último a `respaldo.env`.
3. Edita `respaldo.env` con tus valores. **Sin comillas.** Si tu carpeta no está en `/volume1`, cambia `DESTINO`.
4. Por SSH, o desde una tarea de DSM, protege el archivo: `chmod 600 /volume1/respaldos/relojchecador/respaldo.env`. **Nunca lo subas a GitHub**: el repositorio es público.
5. En **Container Manager > Registro**, busca y descarga las imágenes `postgres` (etiqueta `17`) y `amazon/aws-cli`.

### 5. Probarlo a mano
**Panel de control > Programador de tareas > Crear > Tarea programada > Script definido por el usuario.** Usuario `root`, sin programación (o desactivada) y como comando:
```
sh /volume1/respaldos/relojchecador/respaldar.sh
```
Selecciónala y toca **Ejecutar**. Después revisa:
- `ESTADO.txt` debe tener la fecha de hoy y la línea `selfies=` con un número;
- `db/` debe tener `base-HOY.dump` y `auth-HOY.dump`;
- `logs/respaldo-AAAA-MM.log` debe terminar con «Respaldo terminado».

La primera vez tarda más porque baja todas las selfies. Si falla, el log dice por qué (contraseña mala, imagen sin descargar, sin espacio...).

### 6. Programarlo cada día
En esa tarea: **Programar > Diariamente** a una hora tranquila (por ejemplo 03:00). En **Configuración de la tarea**, marca **Enviar detalles de la ejecución por correo** y **Enviar solo cuando el script termine de forma anormal**; para eso DSM necesita tener el correo configurado en **Panel de control > Notificación**. El script termina con error siempre que algo falla, así que ese aviso es tu alarma.

### 7. Saber que sigue funcionando
Abre `ESTADO.txt` de vez en cuando: debe decir la fecha de ayer o de hoy. Si el NAS estuvo apagado o el correo no llega, esta es la señal de que algo se detuvo.

## Restaurar
Los comandos son de un equipo con Docker (puede ser el mismo NAS por SSH). Sustituye las fechas.

**Para consultar o recuperar datos** (por ejemplo una inspección): levanta un Postgres temporal y restaura ahí. No toques tu Supabase.
```
docker run -d --name rc-restaurada -e POSTGRES_PASSWORD=temporal -v /volume1/respaldos/relojchecador/db:/db:ro postgres:17
docker exec rc-restaurada psql -U postgres -c "create schema auth; create schema extensions; create extension btree_gist schema extensions; create table auth.users (id uuid primary key default gen_random_uuid(), aud text, role text, email text, raw_user_meta_data jsonb); create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users (id), provider text); create function auth.uid() returns uuid language sql stable as \$\$ select null::uuid \$\$; create role anon nologin; create role authenticated nologin; create role service_role nologin;"
docker exec rc-restaurada pg_restore -U postgres -d postgres --data-only --no-owner /db/auth-AAAA-MM-DD.dump
docker exec rc-restaurada pg_restore -U postgres -d postgres --no-owner /db/base-AAAA-MM-DD.dump
```
El único mensaje de error esperado es `schema "public" already exists`: es inofensivo. **No restaures solo los datos sobre una estructura ya creada:** los disparadores de la base volverían a escribir la bitácora y la duplicarían; el volcado completo los crea *después* de cargar los datos.

**Si Supabase se perdiera por completo:** se crea un proyecto nuevo, se restaura igual que arriba (sus usuarios `anon`, `authenticated` y `service_role` ya existen), se aplican las migraciones de Storage (`20261016000100`) y se vuelven a subir las selfies de `selfies/` al bucket. Esto **no se ha ensayado contra Supabase**: practícalo una vez con un proyecto de prueba, antes de necesitarlo.

## Seguridad y límites
- **Contraseñas:** `respaldo.env` solo lo lee su dueño (`chmod 600`); la URL de la base no aparece en los logs ni en la lista de procesos.
- **El NAS es ahora una pieza crítica:** si se rompe o se roba, se van los respaldos. Haz una segunda copia fuera de ahí (Hyper Backup hacia la nube o un disco USB que guardes en otro lugar).
- Los respaldos contienen datos personales de los empleados y las selfies: cifra la carpeta compartida y limita quién tiene acceso.
- Un respaldo que nunca se restauró no es de fiar: restaura uno cada tres meses en un Postgres temporal.

## Qué está probado y qué no
- **Probado** (`bash tests/respaldo/prueba.sh`, 29 comprobaciones): contra un PostgreSQL 16 real con las migraciones del repositorio y un `docker` simulado. Cubre el respaldo, la verificación, que se pueda **restaurar en una base vacía con los mismos datos** (empleados, empresas, usuarios, bitácora sin duplicados, funciones de seguridad, inmutabilidad de registros), que no borre selfies ya respaldadas, la limpieza (30 días y uno por mes), el bloqueo contra dos corridas a la vez y los fallos (base o selfies inaccesibles, S3 sin configurar).
- **Sin probar:** Docker real y el NAS, el Session pooler de Supabase con el usuario `respaldo` y la sincronización S3 con llaves reales. El protocolo S3 de tu proyecto sí responde (`Missing signature`). Por eso el primer paso a mano (paso 5) es obligatorio.
