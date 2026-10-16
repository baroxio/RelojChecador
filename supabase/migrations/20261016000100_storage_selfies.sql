-- Bucket privado para selfies. Ruta: {empresa_id}/{empleado_id}/{medio_id}.jpg
-- Solo escribe el servidor (service_role); el panel lee según el alcance del usuario.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('selfies', 'selfies', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Valida la forma de la ruta antes de convertir a uuid (evita errores de cast en la política).
create function public.puede_ver_ruta_selfie(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  partes text[] := string_to_array(p_ruta, '/');
begin
  if array_length(partes, 1) is null or array_length(partes, 1) < 3
     or partes[2] !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return public.puede_ver_empleado(partes[2]::uuid);
end $$;

revoke execute on function public.puede_ver_ruta_selfie(text) from public, anon;
grant execute on function public.puede_ver_ruta_selfie(text) to authenticated;

create policy selfies_lectura on storage.objects for select to authenticated
  using (bucket_id = 'selfies' and public.puede_ver_ruta_selfie(name));
