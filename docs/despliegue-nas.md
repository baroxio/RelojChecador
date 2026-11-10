# Panel en tu NAS (con acceso desde fuera)

El panel son solo archivos estáticos (`docs/panel/`); los datos y el inicio de sesión siguen en Supabase. El NAS únicamente entrega esos archivos, y se actualiza con `git pull`.

## 1. Levantar el panel en el NAS
1. DSM > Container Manager (o Docker). SSH como administrador:
   ```bash
   cd /volume1/Docker/relojchecadorwhatsapp/deploy/nas
   docker compose up -d
   ```
2. Prueba en tu red: `http://IP-DEL-NAS:8095/panel/` debe mostrar la pantalla de acceso.
3. Para actualizar: `git pull` en la carpeta del repo. No hace falta reiniciar el contenedor.

## 2. Acceso desde fuera: dos caminos
**Instalar como app, usar el modo sin internet y el botón de ubicación exigen HTTPS con un dominio.** Con `http://` por IP solo carga la página.

### Camino A (recomendado): Cloudflare Tunnel, sin abrir puertos
No expones tu NAS ni tu IP: el NAS sale hacia Cloudflare y de ahí llega el tráfico.
1. Un dominio propio (con Cloudflare como DNS, plan gratuito).
2. Cloudflare Zero Trust > Networks > Tunnels > crear túnel y copiar el token.
3. En el NAS: `cd deploy/nas && cp .env.example .env`, pega el token en `TUNNEL_TOKEN=` y arranca con `docker compose --profile tunel up -d`. El contenedor `cloudflared` ya viene en el `docker-compose.yml`.
4. En Cloudflare, en el túnel > *Public hostname*: `panel.tudominio.com`, servicio `HTTP`, URL `panel:80` (comparten red de Docker).
5. Cloudflare pone el certificado HTTPS. Tu router no se toca. El panel queda en `https://panel.tudominio.com/panel/`.

### Camino B: DDNS de Synology + proxy inverso de DSM, abriendo el puerto 443
1. Panel de control > Acceso externo > DDNS: crea `tunombre.synology.me`.
2. Panel de control > Seguridad > Certificado: pide uno de Let's Encrypt para ese nombre.
3. Panel de control > Portal de inicio de sesión > Avanzado > Proxy inverso: origen `HTTPS tunombre.synology.me:443`, destino `HTTP localhost:8095`.
4. En el router: reenviar el puerto 443 al NAS. Activa en DSM el firewall y el bloqueo automático de IP (Seguridad > Protección).
5. No expongas el puerto de DSM (5000/5001) ni ningún otro servicio: solo el 443 hacia ese proxy.

## 3. Qué hace seguro este montaje
- El contenedor solo lee `docs/` (montaje `:ro`, sistema de archivos de solo lectura, sin privilegios) y solo acepta GET/HEAD.
- No hay claves en esos archivos: `config.js` tiene la URL de Supabase y la clave *publicable*, que ya es pública en GitHub Pages. La clave secreta y el token de WhatsApp viven solo como secretos de Supabase.
- Quien entra tiene que iniciar sesión en Supabase; los permisos los aplica la base de datos (RLS), no el NAS.

## 4. Qué cambia si usas otro dominio
- Nada en Supabase: el inicio de sesión es con correo y contraseña, sin redirecciones.
- La PWA instalada desde `panel.tudominio.com` es una app aparte de la instalada desde GitHub Pages (otro origen); tendrán que iniciar sesión por separado.
- Elige un solo sitio para que el personal instale la app y no mezcle los dos.
