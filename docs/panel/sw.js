// Service worker del panel: deja abrir la app sin internet y avisa de las versiones nuevas.
// Sube VERSION en cada cambio del panel: así el navegador detecta la actualización.
// Formato mayor.menor.parche: mayor = funciones nuevas importantes, menor = mejoras, parche = arreglos.
const VERSION = "2.1.0";
const CACHE = `rc-panel-${VERSION}`;
const ARCHIVOS = [
  "./", "index.html", "styles.css", "main.js", "ui.js", "logic.js", "xlsx.js", "config.js",
  "vendor/supabase.js", "vendor/qrcode.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  // Los archivos se piden siempre a la red (cache: reload): así una versión nueva nunca guarda copias viejas del navegador.
  // No se llama a skipWaiting: la versión nueva espera a que el usuario (o el siguiente arranque) la active.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: "reload" })))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("rc-panel-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
  if (e.data === "GET_VERSION") e.source?.postMessage({ tipo: "version", version: VERSION });
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Solo los archivos del propio panel. Supabase, WhatsApp y todo lo demás van directo a la red:
  // nunca se guardan en caché datos de empleados, selfies ni sesiones.
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      if (req.mode === "navigate") return (await caches.match("index.html")) ?? Response.error();
      return Response.error();
    }
  })());
});
