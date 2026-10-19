// Prueba de humo de la interfaz con una base de datos simulada. Requiere jsdom (npm install jsdom@24).
// Ejecutar desde esta carpeta: node ui.prueba.mjs
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";

const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div><div id="avisos"></div></body></html>`, { url: "https://ejemplo.test/panel/", pretendToBeVisual: true });
for (const k of ["window", "document", "location", "navigator", "HTMLElement", "URLSearchParams"]) {
  try { globalThis[k] = dom.window[k]; } catch { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true }); }
}
dom.window.scrollTo = () => {};
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {} } }, configurable: true });

const { iniciarApp } = await import("../../docs/panel/ui.js");

const ahora = Date.now();
const hace = (min) => new Date(ahora - min * 60000).toISOString();
const datos = {
  miembros: [{ id: "m1", empresa_id: "emp", rol: "dueno", user_id: "u1", activo: true }],
  empresas: [{ id: "emp", nombre: "Empresa de prueba" }],
  sedes: [{ id: "s1", nombre: "Sede Centro", zona_horaria: "America/Mexico_City", activa: true }],
  empleados: [
    { id: "e1", nombre: "Ana López", telefono: "+523312840590", estado: "activo", sede_id: "s1" },
    { id: "e2", nombre: "Luis Martínez", telefono: "+528120407645", estado: "activo", sede_id: "s1" },
    { id: "e3", nombre: "Rosa Pérez", telefono: "+523399990000", estado: "invitado", sede_id: "s1" },
  ],
  registros_efectivos: [
    { origen: "registro", fuente_id: "r1", empleado_id: "e2", sede_id: "s1", tipo: "entrada", hora_efectiva: hace(30), hora_original: hace(30), canal: "whatsapp", senales: ["ubicacion_elegida", "foto_repetida"], medio_id: "med1", corregido: false },
  ],
  registros: [{ id: "r1", lat: 20.6, lng: -103.4, distancia_m: 42, dentro_geocerca: true, medio_id: "med1", tipo: "entrada", ocurrido_at: hace(30), empleado_id: "e2" }],
  medios: [{ id: "med1", ruta_storage: "emp/e2/med1.jpg" }],
  horarios: [], horario_dias: [], empleado_horarios: [],
  correcciones: [{ id: "c1", empleado_id: "e2", registro_id: "r1", tipo: "modificar_hora", nuevo_tipo: null, nueva_hora: hace(10), motivo: "Se equivocó de hora", origen: "supervisor", estado: "pendiente", creada_at: hace(5), resuelto_at: null, comentario_resolucion: null }],
};
const llamadas = [];

function crearSb(sesion) {
  function tabla(nombre) {
    const filtros = []; let modo = "select"; let carga = null; let cabeza = false;
    const b = {
      select(_c, o) { if (o?.head) cabeza = true; return b; },
      eq(c, v) { filtros.push((r) => r[c] === v); return b; },
      neq(c, v) { filtros.push((r) => r[c] !== v); return b; },
      gte(c, v) { filtros.push((r) => String(r[c]) >= String(v)); return b; },
      in(c, vs) { filtros.push((r) => vs.includes(r[c])); return b; },
      order() { return b; }, limit() { return b; },
      insert(v) { modo = "insert"; carga = v; return b; },
      update(v) { modo = "update"; carga = v; return b; },
      then(ok, mal) { return ejecutar().then(ok, mal); },
    };
    async function ejecutar() {
      const filas = (datos[nombre] ?? []).filter((r) => filtros.every((f) => f(r)));
      if (modo === "insert") { llamadas.push(["insert", nombre, carga]); (datos[nombre] ??= []).push({ id: "nuevo", ...carga }); return { data: null, error: null }; }
      if (modo === "update") { llamadas.push(["update", nombre, carga]); filas.forEach((r) => Object.assign(r, carga)); return { data: null, error: null }; }
      return cabeza ? { data: null, count: filas.length, error: null } : { data: filas, error: null };
    }
    return b;
  }
  return {
    from: tabla,
    rpc: async (n, a) => { llamadas.push(["rpc", n, a]); datos.correcciones.forEach((c) => { if (c.id === a.p_id) c.estado = a.p_aprobar ? "aprobada" : "rechazada"; }); return { data: null, error: null }; },
    auth: {
      getSession: async () => ({ data: { session: sesion } }),
      onAuthStateChange() {},
      signInWithPassword: async ({ password }) => (password === "bien" ? { error: null } : { error: { message: "x" } }),
      signOut: async () => {},
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://ejemplo.test/selfie.jpg" }, error: null }) }) },
  };
}

const esperar = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const texto = () => document.getElementById("app").textContent.replace(/\s+/g, " ");

// 1. Sin sesión: pantalla de acceso
let raiz = document.getElementById("app");
await iniciarApp({ sb: crearSb(null), url: "https://x.supabase.co", key: "k", raiz, avisos: document.getElementById("avisos") });
assert.match(texto(), /Entrar al panel/);
const form = raiz.querySelector("form");
raiz.querySelector("#correo").value = "a@b.c"; raiz.querySelector("#clave").value = "mal";
form.dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
await esperar();
assert.match(texto(), /Correo o contraseña incorrectos/);
console.log("OK acceso: pantalla y error de credenciales");

// 2. Con sesión: Hoy
document.getElementById("app").replaceChildren();
location.hash = "";
await iniciarApp({ sb: crearSb({ user: { id: "u1", email: "dueno@prueba.mx" } }), url: "https://x.supabase.co", key: "k", raiz: document.getElementById("app"), avisos: document.getElementById("avisos") });
await esperar(80);
let t = texto();
assert.match(t, /Empresa de prueba/);
assert.match(t, /Hoy/);
assert.match(t, /Faltan/);
assert.match(t, /Ana López/);
assert.match(t, /En turno/);
assert.match(t, /Luis Martínez/);
assert.match(t, /2 señales/);
assert.ok(!/Rosa Pérez/.test(t), "los invitados no salen en Hoy");
assert.equal(document.querySelectorAll(".sello").length >= 1, true);
console.log("OK Hoy: grupos Faltan y En turno, sello, señales");

// 3. Detalle de Luis
const botonLuis = [...document.querySelectorAll("button.fila")].find((b) => b.textContent.includes("Luis"));
botonLuis.click();
await esperar(80);
t = texto();
assert.match(t, /Señales para revisar/);
assert.match(t, /La ubicación se eligió en el mapa/);
assert.match(t, /a 42 m de la sede/);
const botonSelfie = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Ver selfie"));
assert.ok(botonSelfie, "hay botón de selfie");
botonSelfie.click();
await esperar(50);
const img = document.querySelector("img.selfie");
assert.ok(img && img.src.startsWith("https://ejemplo.test/selfie.jpg"));
assert.match(img.alt, /Selfie de Luis Martínez/);
console.log("OK detalle: cronología, señales con texto, selfie con URL firmada");

// 4. Equipo
location.hash = "#/equipo";
window.dispatchEvent(new dom.window.Event("hashchange"));
await esperar(80);
t = texto();
assert.match(t, /Rosa Pérez/);
assert.match(t, /Invitado/);
assert.match(t, /\+52 33 9999 0000/);
[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Agregar")).click();
await esperar();
const f2 = document.querySelector("form.formulario");
f2.dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
await esperar();
assert.match(texto(), /Escribe el nombre del empleado/);
assert.match(texto(), /celular de 10 dígitos/);
document.getElementById("n-nombre").value = "Pedro Ruiz"; document.getElementById("n-tel").value = "81 1234 5678";
f2.dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
await esperar(80);
const ins = llamadas.find((c) => c[0] === "insert" && c[1] === "empleados");
assert.ok(ins, "se insertó el empleado");
assert.equal(ins[2].telefono, "+528112345678");
assert.equal(ins[2].empresa_id, "emp");
console.log("OK Equipo: lista, validación en español, alta con teléfono normalizado");

// 5. Correcciones
location.hash = "#/correcciones";
window.dispatchEvent(new dom.window.Event("hashchange"));
await esperar(100);
t = texto();
assert.match(t, /Luis Martínez/);
assert.match(t, /Cambiar entrada/);
assert.match(t, /Motivo: Se equivocó de hora/);
[...document.querySelectorAll("button")].find((b) => b.textContent === "Aprobar").click();
await esperar(100);
const rpc = llamadas.find((c) => c[0] === "rpc");
assert.ok(rpc && rpc[1] === "resolver_correccion" && rpc[2].p_aprobar === true && rpc[2].p_id === "c1");
console.log("OK Correcciones: pendiente visible y aprobación por la función del servidor");

// 6. Texto de la base no se interpreta como HTML
datos.empleados.push({ id: "e9", nombre: '<img src=x onerror="window.pwned=1">', telefono: "+523300000000", estado: "activo", sede_id: "s1" });
location.hash = "#/hoy";
window.dispatchEvent(new dom.window.Event("hashchange"));
await esperar(100);
assert.equal(document.querySelectorAll('img[src="x"]').length, 0);
assert.ok(!window.pwned);
assert.match(texto(), /<img src=x/);
console.log("OK seguridad: un nombre con HTML se muestra como texto");

process.exit(0);
