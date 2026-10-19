// Arranque: usa la librería de Supabase guardada en vendor/ (sin depender de internet),
// registra el service worker y entrega la interfaz.
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { iniciarApp } from "./ui.js";

const sinConfigurar = !SUPABASE_KEY || SUPABASE_KEY.startsWith("PEGAR_");
const sb = sinConfigurar || !window.supabase
  ? null
  : window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

// ---------- App instalable y actualizaciones ----------
const RC = {
  version: "desconocida",
  hayActualizacion: false,
  puedeInstalar: false,
  instalada: matchMedia("(display-mode: standalone)").matches,
  enSegundoPlano: null,
  _instalador: null,
  _espera: null,
  _reg: null,
  avisar() { window.dispatchEvent(new CustomEvent("rc:estado")); },
  async buscarActualizacion() {
    if (!this._reg) return "no-disponible";
    await this._reg.update();
    await new Promise((r) => setTimeout(r, 1200));
    return this.hayActualizacion ? "nueva" : "al-dia";
  },
  aplicarActualizacion() {
    if (this._espera) this._espera.postMessage("SKIP_WAITING");
    else location.reload();
  },
  async instalar() {
    if (!this._instalador) return false;
    this._instalador.prompt();
    const { outcome } = await this._instalador.userChoice;
    this._instalador = null; this.puedeInstalar = false; this.avisar();
    return outcome === "accepted";
  },
};
window.RC = RC;

window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); RC._instalador = e; RC.puedeInstalar = true; RC.avisar(); });
window.addEventListener("appinstalled", () => { RC.instalada = true; RC.puedeInstalar = false; RC.avisar(); });

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.tipo === "version") { RC.version = e.data.version; RC.avisar(); }
  });
  navigator.serviceWorker.register("sw.js").then((reg) => {
    RC._reg = reg;
    const marcar = (worker) => { RC._espera = worker; RC.hayActualizacion = true; RC.avisar(); };
    // Una versión nueva que ya esperaba al abrir la app se activa sola: aún no hay nada sin guardar.
    if (reg.waiting && navigator.serviceWorker.controller) { reg.waiting.postMessage("SKIP_WAITING"); }
    reg.addEventListener("updatefound", () => {
      const nuevo = reg.installing;
      nuevo?.addEventListener("statechange", () => {
        if (nuevo.state === "installed" && navigator.serviceWorker.controller) marcar(nuevo);
      });
    });
    const pedirVersion = () => navigator.serviceWorker.controller?.postMessage("GET_VERSION");
    navigator.serviceWorker.ready.then(pedirVersion);
    // Busca versiones nuevas al abrir, al volver a la app y cada hora.
    const buscar = () => reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") buscar(); });
    setInterval(buscar, 60 * 60 * 1000);
  }).catch(() => {});
  // En la primera visita aún no había un service worker controlando la página: no hay nada que recargar.
  const habiaControlador = Boolean(navigator.serviceWorker.controller);
  let recargando = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (recargando || !habiaControlador) return;
    recargando = true;
    location.reload();
  });
}

iniciarApp({
  sb,
  url: SUPABASE_URL,
  key: SUPABASE_KEY,
  raiz: document.getElementById("app"),
  avisos: document.getElementById("avisos"),
});
