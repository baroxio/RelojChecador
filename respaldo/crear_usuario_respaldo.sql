-- Usuario de SOLO LECTURA para el respaldo del NAS (se corre una vez, en el SQL Editor de Supabase).
-- Así, si alguien roba la contraseña guardada en el NAS, puede leer pero no cambiar ni borrar nada.
--
-- 1. Cambia PON_AQUI_UNA_CONTRASENA_LARGA por una contraseña larga y aleatoria, de solo letras y números
--    (así no hay que codificarla en la URL de conexión).
-- 2. Corre todo el archivo.
-- 3. Si el primer comando da error por BYPASSRLS, avísame: no te quedes sin respaldo; la alternativa
--    es usar el usuario postgres en SUPABASE_DB_URL (más permisos, mismo respaldo).
--
-- BYPASSRLS es necesario: las tablas tienen reglas por empresa y, sin él, pg_dump no podría leerlas todas.

create role respaldo login password 'PON_AQUI_UNA_CONTRASENA_LARGA' bypassrls;

grant usage on schema public, auth to respaldo;
grant select on all tables in schema public to respaldo;
grant select on auth.users, auth.identities to respaldo;
grant select on all sequences in schema public to respaldo;

-- Lo que se cree después en public también queda legible.
alter default privileges for role postgres in schema public grant select on tables to respaldo;
alter default privileges for role postgres in schema public grant select on sequences to respaldo;

-- Comprobación: debe decir  respaldo | t
select rolname, rolbypassrls from pg_roles where rolname = 'respaldo';
