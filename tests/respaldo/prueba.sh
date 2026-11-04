#!/bin/bash
# Prueba de respaldo/respaldar.sh contra un PostgreSQL real, sin Docker ni NAS.
#
# Requiere: ejecutarse como root en una máquina con PostgreSQL 16 instalado (servidor y cliente,
# por ejemplo el paquete postgresql-16 de Ubuntu). Crea un clúster temporal en /var/tmp/rc-respaldo-test,
# aplica las migraciones del repositorio, siembra datos, corre el script con un "docker" de mentira
# (ejecuta localmente lo que correría dentro del contenedor) y borra todo al terminar.
# Uso:  bash tests/respaldo/prueba.sh        (CONSERVAR=1 deja los archivos de la prueba para depurar)
set -u
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
T=/var/tmp/rc-respaldo-test
BIN=/usr/lib/postgresql/16/bin
export PATH="$BIN:$PATH"
fallas=0
ok()    { echo "OK: $*"; }
falla() { echo "FALLA: $*"; fallas=$((fallas + 1)); }
espera() { if eval "$2"; then ok "$1"; else falla "$1"; [ -n "${ULTIMA:-}" ] && [ -f "$ULTIMA" ] && sed "s/^/    | /" "$ULTIMA" | head -15; fi; }

limpiar() { [ "${CONSERVAR:-0}" = 1 ] && { echo "(se conservó $T)"; return; }; runuser -u postgres -- "$BIN/pg_ctl" -D "$T/data" -m fast stop >/dev/null 2>&1; rm -rf "$T"; }
trap limpiar EXIT
rm -rf "$T"; mkdir -p "$T/nas" "$T/bucket"; chown postgres:postgres "$T"
runuser -u postgres -- "$BIN/initdb" -D "$T/data" -A trust >/dev/null || exit 2
runuser -u postgres -- "$BIN/pg_ctl" -D "$T/data" -o "-p 5545 -k $T -c listen_addresses=''" -l "$T/log" -w start >/dev/null || exit 2
P="psql -h $T -p 5545 -U postgres -v ON_ERROR_STOP=1 -q -d postgres"
$P -c "create database rc" || exit 2
P="psql -h $T -p 5545 -U postgres -v ON_ERROR_STOP=1 -q -d rc"
$P <<'SQL' || exit 2
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth; create schema extensions; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), aud text, role text, email text, raw_user_meta_data jsonb);
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users (id), provider text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
SQL
for f in "$RAIZ"/supabase/migrations/*.sql; do $P -f "$f" >/dev/null 2>&1 || { echo "No se pudo aplicar $f"; exit 2; }; done
$P <<'SQL' || exit 2
insert into auth.users (id, aud, role, email) values ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'dueno@prueba.local');
insert into auth.identities (user_id, provider) values ('00000000-0000-0000-0000-0000000000a1', 'email');
insert into public.empresas (id, nombre) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa de prueba');
insert into public.sedes (id, empresa_id, nombre) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'Sede');
insert into public.empleados (empresa_id, sede_id, nombre, telefono, estado)
  select '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'Empleado ' || g, '+52331234' || lpad(g::text, 4, '0'), 'activo' from generate_series(1, 40) g;
SQL

# --- "docker" de mentira: ejecuta localmente lo que correría dentro del contenedor ---------------
cat > "$T/docker" <<'FAKE'
#!/bin/bash
[ "$1" = run ] || exit 99
shift
vols=()
while [ $# -gt 0 ]; do
  case "$1" in
    --rm) shift ;;
    -e) shift; shift ;;                # -e VARIABLE: ya viene en el entorno
    -v) shift; vols+=("$1"); shift ;;
    --entrypoint) shift; shift ;;
    *) break ;;
  esac
done
imagen="$1"; shift
traducir() { local a="$1" v host cont; for v in "${vols[@]}"; do host="${v%%:*}"; cont="${v#*:}"; cont="${cont%%:*}"; case "$a" in "$cont"|"$cont"/*) a="$host${a#"$cont"}" ;; esac; done; printf '%s' "$a"; }
case "$imagen" in
  *aws-cli*)
    # ... --endpoint-url URL s3 sync s3://bucket /dest --only-show-errors   (copia solo lo nuevo, sin borrar)
    [ "${FAKE_FALLA_S3:-0}" = 1 ] && { echo "S3 caído (simulado)" >&2; exit 1; }
    while [ "${1:-}" != sync ] && [ $# -gt 0 ]; do shift; done; shift
    origen="${1#s3://}"; destino="$(traducir "$2")"
    cp -rn "$FAKE_BUCKET/." "$destino/" ;;
  *)
    # sh -c SCRIPT sh ARGS...  (con los argumentos traducidos a rutas del anfitrión)
    [ "$1" = -c ] || exit 98
    script="$2"; shift 2; shift   # quita el "sh" que hace de $0
    args=(); for a in "$@"; do args+=("$(traducir "$a")"); done
    exec sh -c "$script" sh "${args[@]}" ;;
esac
FAKE
chmod +x "$T/docker"

DB_URL="postgresql://postgres@/rc?host=$T&port=5545"
cat > "$T/respaldo.env" <<ENV
DESTINO=$T/nas
SUPABASE_DB_URL=$DB_URL
S3_ENDPOINT=https://ejemplo.invalid/s3
S3_ACCESS_KEY_ID=x
S3_SECRET_ACCESS_KEY=y
MIN_LIBRE_MB=1
ENV
chmod 600 "$T/respaldo.env"
export RC_CONFIG="$T/respaldo.env" DOCKER="$T/docker" FAKE_BUCKET="$T/bucket"
mkdir -p "$T/bucket/emp/e1"; echo "foto1" > "$T/bucket/emp/e1/m1.jpg"; echo "foto2" > "$T/bucket/emp/e1/m2.jpg"
HOY=$(date +%Y-%m-%d)
R="$RAIZ/respaldo/respaldar.sh"

echo "=== 1. Respaldo normal ==="
ULTIMA="$T/salida1.txt"; sh "$R" > "$ULTIMA" 2>&1; cod=$?
espera "termina con código 0" "[ $cod -eq 0 ]"
espera "crea base-$HOY.dump" "[ -s $T/nas/db/base-$HOY.dump ]"
espera "crea auth-$HOY.dump" "[ -s $T/nas/db/auth-$HOY.dump ]"
espera "no deja archivos temporales ni bloqueo" "[ -z \"\$(ls -A $T/nas/db | grep '^\.tmp')\" ] && [ ! -d $T/nas/.respaldo.lock ]"
espera "baja las 2 selfies" "[ -f $T/nas/selfies/emp/e1/m1.jpg ] && [ -f $T/nas/selfies/emp/e1/m2.jpg ]"
espera "escribe ESTADO.txt con la señal de vida" "grep -q '^ultimo_respaldo_ok=' $T/nas/ESTADO.txt && grep -q '^selfies=2' $T/nas/ESTADO.txt"
espera "escribe el registro en logs/" "grep -q 'Respaldo terminado' $T/nas/logs/respaldo-*.log"
espera "la URL de la base (con su contraseña) no aparece en los logs" "! grep -rq 'postgresql://' $T/nas/logs $T/salida1.txt"

echo "=== 2. El respaldo se restaura en una base vacía (como en un desastre) con los mismos datos ==="
RS="runuser -u postgres -- psql -h $T -p 5545 -q"
runuser -u postgres -- "$BIN/createdb" -h "$T" -p 5545 restaurada
$RS -d restaurada -v ON_ERROR_STOP=1 <<'SQL'
create schema auth; create schema extensions;
create extension btree_gist schema extensions;
create table auth.users (id uuid primary key default gen_random_uuid(), aud text, role text, email text, raw_user_meta_data jsonb);
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users (id), provider text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
SQL
cp "$T/nas/db/base-$HOY.dump" "$T/nas/db/auth-$HOY.dump" /var/tmp/
chmod a+r "/var/tmp/base-$HOY.dump" "/var/tmp/auth-$HOY.dump"
runuser -u postgres -- pg_restore -h "$T" -p 5545 -d restaurada --data-only --no-owner "/var/tmp/auth-$HOY.dump" 2>"$T/restaura.err"
runuser -u postgres -- pg_restore -h "$T" -p 5545 -d restaurada --no-owner "/var/tmp/base-$HOY.dump" 2>>"$T/restaura.err"
rm -f "/var/tmp/base-$HOY.dump" "/var/tmp/auth-$HOY.dump"
cuenta() { runuser -u postgres -- psql -h "$T" -p 5545 -d "$1" -Atc "$2"; }
# El único mensaje esperado: el esquema public ya existe en cualquier base nueva. Cualquier otro es un fallo.
grep -v -e 'schema "public" already exists' -e 'Command was: CREATE SCHEMA public;' -e 'errors ignored on restore: 1' -e '^$' "$T/restaura.err" > "$T/restaura.otros" || true
espera "la restauración no da más error que «schema public already exists»" "[ ! -s $T/restaura.otros ]"
[ -s "$T/restaura.otros" ] && sed 's/^/    | /' "$T/restaura.otros" | head -8
espera "empleados: 40 en el original y 40 en la restauración" "[ \"\$(cuenta rc 'select count(*) from public.empleados')\" = 40 ] && [ \"\$(cuenta restaurada 'select count(*) from public.empleados')\" = 40 ]"
espera "empresas y sedes restauradas" "[ \"\$(cuenta restaurada 'select count(*) from public.empresas')\" = 1 ] && [ \"\$(cuenta restaurada 'select count(*) from public.sedes')\" = 1 ]"
espera "usuarios del panel restaurados (auth.users)" "[ \"\$(cuenta restaurada 'select count(*) from auth.users')\" = 1 ]"
espera "la bitácora restaurada es idéntica (los disparadores no la duplicaron)" "[ \"\$(cuenta restaurada 'select count(*) from public.bitacora')\" = \"\$(cuenta rc 'select count(*) from public.bitacora')\" ]"
espera "las funciones de seguridad del esquema private viajan en el respaldo" "[ \"\$(cuenta restaurada \"select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'\")\" -ge 4 ]"
espera "los disparadores y la inmutabilidad de registros siguen en la base restaurada" "[ \"\$(cuenta restaurada \"select count(*) from pg_trigger where tgname like 'registros%' and not tgisinternal\")\" -ge 1 ]"

echo "=== 3. Repetir el mismo día y no borrar selfies que ya bajaron ==="
rm -f "$T/bucket/emp/e1/m1.jpg"; echo "foto3" > "$T/bucket/emp/e1/m3.jpg"
sh "$R" > "$T/salida3.txt" 2>&1; cod=$?
espera "segunda corrida termina con 0" "[ $cod -eq 0 ]"
espera "la selfie borrada del origen sigue en el NAS" "[ -f $T/nas/selfies/emp/e1/m1.jpg ]"
espera "la selfie nueva se agregó" "[ -f $T/nas/selfies/emp/e1/m3.jpg ]"

echo "=== 4. Limpieza: 30 días y un respaldo por mes ==="
D="$T/nas/db"
touch -d '40 days ago' "$D/base-viejo.dump"
touch -d '40 days ago' "$D/base-2026-01-01.dump"
touch -d '400 days ago' "$D/base-2025-01-01.dump"
touch -d '10 days ago' "$D/base-reciente.dump"
sh "$R" > /dev/null 2>&1
espera "borra el diario de 40 días" "[ ! -e $D/base-viejo.dump ]"
espera "conserva el del día 1 de hace 40 días" "[ -e $D/base-2026-01-01.dump ]"
espera "borra el del día 1 de hace más de 12 meses" "[ ! -e $D/base-2025-01-01.dump ]"
espera "conserva el de hace 10 días" "[ -e $D/base-reciente.dump ]"

echo "=== 5. Fallos: salen con error y no dejan un respaldo falso ==="
rm -f "$D/base-$HOY.dump" "$D/auth-$HOY.dump" "$T/nas/ESTADO.txt"
RC_CONFIG="$T/malo.env"; sed "s#^SUPABASE_DB_URL=.*#SUPABASE_DB_URL=postgresql://postgres@/rc_no_existe?host=$T\&port=5545#" "$T/respaldo.env" > "$T/malo.env"
RC_CONFIG="$T/malo.env" sh "$R" > "$T/salida5.txt" 2>&1; cod=$?
espera "base inaccesible: sale con código distinto de 0" "[ $cod -ne 0 ]"
espera "base inaccesible: no queda respaldo de hoy ni ESTADO.txt falso" "[ ! -e $D/base-$HOY.dump ] && [ ! -e $T/nas/ESTADO.txt ] && [ -z \"\$(ls -A $D | grep '^\.tmp')\" ]"
espera "base inaccesible: el error queda en el log" "grep -q 'ERROR: pg_dump falló' $T/nas/logs/respaldo-*.log"
FAKE_FALLA_S3=1 sh "$R" > "$T/salida5b.txt" 2>&1; cod=$?
espera "selfies inaccesibles: sale con código distinto de 0" "[ $cod -ne 0 ]"
espera "selfies inaccesibles: no escribe ESTADO.txt" "[ ! -e $T/nas/ESTADO.txt ]"
mkdir "$T/nas/.respaldo.lock"
sh "$R" > "$T/salida5c.txt" 2>&1; cod=$?
espera "bloqueo reciente: no corre dos respaldos a la vez" "[ $cod -ne 0 ] && grep -q 'ya hay un respaldo en curso' $T/salida5c.txt"
rmdir "$T/nas/.respaldo.lock"
sed '/^S3_ENDPOINT/d' "$T/respaldo.env" > "$T/sin_s3.env"
RC_CONFIG="$T/sin_s3.env" sh "$R" > "$T/salida5d.txt" 2>&1; cod=$?
espera "sin S3 configurado y sin SALTAR_SELFIES: falla en vez de omitir en silencio" "[ $cod -ne 0 ] && grep -q 'S3_ENDPOINT' $T/salida5d.txt"
echo "SALTAR_SELFIES=1" >> "$T/sin_s3.env"
RC_CONFIG="$T/sin_s3.env" sh "$R" > "$T/salida5e.txt" 2>&1; cod=$?
espera "SALTAR_SELFIES=1: respalda la base y avisa que omitió las selfies" "[ $cod -eq 0 ] && grep -q 'selfies=omitidas' $T/nas/ESTADO.txt"

echo "=== 6. Con el usuario de solo lectura de crear_usuario_respaldo.sql (el que se crea en Supabase) ==="
sed "s/PON_AQUI_UNA_CONTRASENA_LARGA/clavePrueba123/" "$RAIZ/respaldo/crear_usuario_respaldo.sql" | $P >/dev/null 2>"$T/rol.err"
espera "el archivo SQL del usuario de respaldo se aplica sin errores" "[ ! -s $T/rol.err ]"
[ -s "$T/rol.err" ] && sed 's/^/    | /' "$T/rol.err" | head -5
rm -f "$D/base-$HOY.dump" "$D/auth-$HOY.dump" "$T/nas/ESTADO.txt"
sed "s#^SUPABASE_DB_URL=.*#SUPABASE_DB_URL=postgresql://respaldo@/rc?host=$T\&port=5545#" "$T/respaldo.env" > "$T/solo_lectura.env"
chmod 600 "$T/solo_lectura.env"
ULTIMA="$T/salida6.txt"; RC_CONFIG="$T/solo_lectura.env" sh "$R" > "$ULTIMA" 2>&1; cod=$?
espera "el respaldo completo funciona con el usuario de solo lectura (sin acceso al esquema private)" "[ $cod -eq 0 ] && [ -s $D/base-$HOY.dump ] && [ -s $D/auth-$HOY.dump ]"
rs() { psql -h "$T" -p 5545 -U respaldo -d rc -Atc "$1" 2>&1; }
espera "el usuario de solo lectura puede leer empleados y usuarios del panel" "[ \"\$(rs 'select count(*) from public.empleados')\" = 40 ] && [ \"\$(rs 'select count(*) from auth.users')\" = 1 ]"
espera "el usuario de solo lectura NO puede modificar ni borrar" "rs \"update public.empleados set nombre = 'x'\" | grep -q 'permission denied' && rs 'delete from public.empresas' | grep -q 'permission denied' && rs 'update auth.users set email = null' | grep -q 'permission denied'"
espera "el usuario de solo lectura no es superusuario ni crea roles" "[ \"\$(rs \"select rolsuper or rolcreaterole or rolcreatedb from pg_roles where rolname = 'respaldo'\")\" = f ]"

echo
[ "$fallas" -eq 0 ] && echo "Resultado: TODO OK" || echo "Resultado: HAY $fallas FALLAS"
exit "$fallas"
