#!/bin/sh
# Respaldo diario de RelojChecador al NAS (Synology con Container Manager).
#
# Qué respalda, cada día:
#   db/base-FECHA.dump     estructura y datos de los esquemas public y private (empleados, registros,
#                          correcciones, bitácora, reglas de seguridad...)
#   db/auth-FECHA.dump     solo los datos de auth.users y auth.identities (los usuarios del panel)
#   selfies/               copia del bucket privado «selfies» (solo agrega; nunca borra lo que ya bajó)
#
# Cómo corre: el Programador de tareas de DSM lo ejecuta a diario como root. Todo se hace con
# contenedores (postgres para pg_dump y aws-cli para las selfies), así el NAS no necesita instalar nada.
# Si algo falla termina con código distinto de 0: DSM puede avisar por correo cuando eso pasa.
#
# Configuración: respaldo.env junto a este script (o la ruta en RC_CONFIG). Ver respaldo.env.ejemplo.

set -u

CONFIG="${RC_CONFIG:-$(dirname "$0")/respaldo.env}"
[ -f "$CONFIG" ] || { echo "Falta el archivo de configuración: $CONFIG" >&2; exit 2; }
# El archivo se lee como TEXTO (CLAVE=valor, una por línea), no se ejecuta: así una contraseña con
# caracteres como & $ # ? ! no se interpreta como código. Se aceptan comillas alrededor del valor.
CR=$(printf '\r')
while IFS= read -r linea || [ -n "$linea" ]; do
  linea=${linea%"$CR"}
  case "$linea" in ''|'#'*) continue ;; esac
  clave=${linea%%=*}; valor=${linea#*=}
  case "$clave" in ''|*[!A-Za-z0-9_]*) continue ;; esac
  case "$valor" in \'*\') valor=${valor#\'}; valor=${valor%\'} ;; \"*\") valor=${valor#\"}; valor=${valor%\"} ;; esac
  export "$clave=$valor"
done < "$CONFIG"

: "${DESTINO:?Falta DESTINO en $CONFIG}" "${SUPABASE_DB_URL:?Falta SUPABASE_DB_URL en $CONFIG}"
DOCKER="${DOCKER:-docker}"
IMAGEN_POSTGRES="${IMAGEN_POSTGRES:-postgres:17}"
IMAGEN_AWSCLI="${IMAGEN_AWSCLI:-amazon/aws-cli}"
BUCKET="${BUCKET:-selfies}"
DIAS_DIARIOS="${DIAS_DIARIOS:-30}"   # cuántos días se conservan todos los respaldos
MESES="${MESES:-12}"                 # cuántos respaldos del día 1 de cada mes se conservan
MIN_LIBRE_MB="${MIN_LIBRE_MB:-1024}" # espacio libre mínimo para empezar
TABLAS_CLAVE="${TABLAS_CLAVE:-empresas sedes empleados registros correcciones medios horarios bitacora}"

mkdir -p "$DESTINO/db" "$DESTINO/selfies" "$DESTINO/logs" || { echo "No pude crear $DESTINO" >&2; exit 2; }
LOG="$DESTINO/logs/respaldo-$(date +%Y-%m).log"
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }
fallar() { log "ERROR: $*"; printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# El archivo de configuración tiene contraseñas: que solo lo lea su dueño.
if [ -n "$(find "$CONFIG" -maxdepth 0 -perm -004 2>/dev/null)" ]; then
  log "AVISO: $CONFIG lo puede leer cualquier usuario del NAS; corre: chmod 600 $CONFIG"
fi

# Un solo respaldo a la vez. Un bloqueo de más de 6 horas es de un proceso que murió.
LOCK="$DESTINO/.respaldo.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +360 2>/dev/null)" ]; then
    rmdir "$LOCK" && mkdir "$LOCK" || fallar "no pude renovar el bloqueo viejo $LOCK"
  else
    fallar "ya hay un respaldo en curso (si no es así, borra la carpeta $LOCK)"
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null; rm -f "$DESTINO"/db/.tmp-* 2>/dev/null' EXIT

libre_mb=$(df -Pk "$DESTINO" | awk 'NR==2 { print int($4 / 1024) }')
[ "${libre_mb:-0}" -ge "$MIN_LIBRE_MB" ] || fallar "queda poco espacio en el NAS: ${libre_mb:-0} MB libres, se piden al menos $MIN_LIBRE_MB MB"

if [ -z "${S3_ENDPOINT:-}" ] && [ "${SALTAR_SELFIES:-0}" != "1" ]; then
  fallar "falta S3_ENDPOINT para respaldar las selfies (si no las quieres, pon SALTAR_SELFIES=1)"
fi

FECHA=$(date +%Y-%m-%d)
log "Inicio del respaldo $FECHA"

# --- Base de datos -----------------------------------------------------------
# dump NOMBRE "esquema:tabla ..." BYTES_MINIMOS argumentos-de-pg_dump
#   Las tablas indicadas deben aparecer en el respaldo; BYTES_MINIMOS descarta archivos casi vacíos
#   (cada volcado tiene el suyo: pocos usuarios pesan poco y aun así es un respaldo válido).
dump() {
  nombre=$1; requeridas=$2; minimo=$3; shift 3
  tmp_host="$DESTINO/db/.tmp-$nombre-$FECHA.dump"
  rm -f "$tmp_host"
  # La URL va por variable de entorno, no por argumentos: así no se ve en la lista de procesos.
  DBURL="$SUPABASE_DB_URL" "$DOCKER" run --rm -e DBURL -v "$DESTINO/db:/out" --entrypoint sh "$IMAGEN_POSTGRES" \
    -c 'out="$1"; shift; pg_dump "$DBURL" --format=custom --no-owner --file="$out" "$@"' \
    sh "/out/.tmp-$nombre-$FECHA.dump" "$@" >>"$LOG" 2>&1 || fallar "pg_dump falló en $nombre (detalles en $LOG)"

  [ -s "$tmp_host" ] || fallar "el respaldo $nombre quedó vacío"
  tamano=$(wc -c < "$tmp_host")
  [ "$tamano" -ge "$minimo" ] || fallar "el respaldo $nombre es sospechosamente chico ($tamano bytes; se esperaban al menos $minimo)"

  # Se comprueba que el archivo se pueda leer y que traiga las tablas importantes.
  listado=$("$DOCKER" run --rm -v "$DESTINO/db:/out:ro" --entrypoint sh "$IMAGEN_POSTGRES" \
    -c 'pg_restore --list "$1"' sh "/out/.tmp-$nombre-$FECHA.dump" 2>>"$LOG") || fallar "el respaldo $nombre no se puede leer con pg_restore"
  for t in $requeridas; do
    esquema=${t%%:*}; tabla=${t##*:}
    printf '%s\n' "$listado" | grep -Eq "TABLE DATA $esquema $tabla( |$)" || fallar "el respaldo $nombre no trae la tabla $esquema.$tabla"
  done

  mv -f "$tmp_host" "$DESTINO/db/$nombre-$FECHA.dump" || fallar "no pude guardar $nombre-$FECHA.dump"
  log "OK $nombre-$FECHA.dump ($tamano bytes)"
}

requeridas_public=""
for t in $TABLAS_CLAVE; do requeridas_public="$requeridas_public public:$t"; done
dump base "$requeridas_public" 20000 --schema=public --schema=private
dump auth "auth:users auth:identities" 300 --data-only --table=auth.users --table=auth.identities

# --- Selfies -------------------------------------------------------------------
if [ "${SALTAR_SELFIES:-0}" != "1" ]; then
  : "${S3_ACCESS_KEY_ID:?Falta S3_ACCESS_KEY_ID en $CONFIG}" "${S3_SECRET_ACCESS_KEY:?Falta S3_SECRET_ACCESS_KEY en $CONFIG}"
  # sync solo agrega y actualiza: nunca borra del NAS una selfie que ya se bajó, aunque desaparezca de Supabase.
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="${S3_REGION:-us-west-2}" \
    "$DOCKER" run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION -v "$DESTINO/selfies:/dest" "$IMAGEN_AWSCLI" \
    --endpoint-url "$S3_ENDPOINT" s3 sync "s3://$BUCKET" /dest --only-show-errors >>"$LOG" 2>&1 || fallar "no se pudieron respaldar las selfies (detalles en $LOG)"
  n_selfies=$(find "$DESTINO/selfies" -type f | wc -l | tr -d ' ')
  log "OK selfies: $n_selfies archivos en el NAS"
else
  n_selfies="omitidas"
  log "AVISO: selfies omitidas por configuración (SALTAR_SELFIES=1)"
fi

# --- Limpieza: todos los de los últimos N días y el del día 1 de cada mes ------
find "$DESTINO/db" -type f -name '*.dump' ! -name '*-01.dump' -mtime +"$DIAS_DIARIOS" -exec rm -f {} \;
find "$DESTINO/db" -type f -name '*-01.dump' -mtime +"$((MESES * 31))" -exec rm -f {} \;

# --- Señal de vida: cuándo fue el último respaldo bueno -------------------------
{
  echo "ultimo_respaldo_ok=$(date '+%Y-%m-%d %H:%M:%S')"
  echo "fecha=$FECHA"
  echo "selfies=$n_selfies"
  echo "libre_mb_al_empezar=$libre_mb"
  ls -l "$DESTINO/db" | grep -E "(base|auth)-$FECHA\.dump"
} > "$DESTINO/ESTADO.txt.tmp" && mv -f "$DESTINO/ESTADO.txt.tmp" "$DESTINO/ESTADO.txt"

log "Respaldo terminado"
exit 0
