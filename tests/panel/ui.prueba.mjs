// Prueba de humo de la interfaz con una base de datos simulada. Requiere jsdom (npm install jsdom@24).
// Ejecutar desde esta carpeta: node ui.prueba.mjs
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";

const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div><div id="avisos"></div></body></html>`, { url: "https://ejemplo.test/panel/", pretendToBeVisual: true });
for (const k of ["window", "document", "location", "navigator", "HTMLElement", "URLSearchParams"]) {
  try { globalThis[k] = dom.window[k]; } catch { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true }); }
}
dom.window.scrollTo = () => {};
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {} }, onLine: true }, configurable: true });
globalThis.localStorage = dom.window.localStorage;

const { iniciarApp } = await import("../../docs/panel/ui.js");

const ahora = Date.now();
const hace = (min) => new Date(ahora - min * 60000).toISOString();
const datos = {
  miembros: [{ id: "m1", empresa_id: "emp", rol: "dueno", user_id: "u1", activo: true }],
  empresas: [{ id: "emp", nombre: "Empresa de prueba" }],
  sedes: [{ id: "s1", empresa_id: "emp", nombre: "Sede Centro", zona_horaria: "America/Mexico_City", activa: true }],
  empleados: [
    { empresa_id: "emp", id: "e1", nombre: "Ana López", telefono: "+523312840590", estado: "activo", sede_id: "s1" },
    { empresa_id: "emp", id: "e2", nombre: "Luis Martínez", telefono: "+528120407645", estado: "activo", sede_id: "s1" },
    { empresa_id: "emp", id: "e3", nombre: "Rosa Pérez", telefono: "+523399990000", estado: "invitado", sede_id: "s1" },
  ],
  registros_efectivos: [
    { empresa_id: "emp", origen: "registro", fuente_id: "r1", empleado_id: "e2", sede_id: "s1", tipo: "entrada", hora_efectiva: hace(30), hora_original: hace(30), canal: "whatsapp", senales: ["ubicacion_elegida", "foto_repetida"], medio_id: "med1", corregido: false },
  ],
  registros: [{ id: "r1", lat: 20.6, lng: -103.4, distancia_m: 42, dentro_geocerca: true, medio_id: "med1", tipo: "entrada", ocurrido_at: hace(30), empleado_id: "e2" }],
  medios: [{ id: "med1", ruta_storage: "emp/e2/med1.jpg" }],
  horarios: [], horario_dias: [], empleado_horarios: [],
  plataforma_admins: [{ user_id: "u1" }],
  usuarios: [
    { miembro_id: "m1", user_id: "u1", correo: "dueno@prueba.mx", nombre: "Dueño Prueba", rol: "dueno", activo: true, sedes: [] },
    { miembro_id: "m2", user_id: "u2", correo: "sup@prueba.mx", nombre: "Sara Supervisora", rol: "supervisor", activo: true, sedes: ["s1"] },
    { miembro_id: "m3", user_id: "u3", correo: "baja@prueba.mx", nombre: null, rol: "consulta", activo: false, sedes: [] },
  ],
  correcciones: [{ id: "c1", empresa_id: "emp", empleado_id: "e2", registro_id: "r1", tipo: "modificar_hora", nuevo_tipo: null, nueva_hora: hace(10), motivo: "Se equivocó de hora", origen: "supervisor", estado: "pendiente", creada_at: hace(5), resuelto_at: null, comentario_resolucion: null }],
};
const llamadas = [];

function crearSb(sesion) {
  function tabla(nombre) {
    const filtros = []; let modo = "select"; let carga = null; let cabeza = false; let unico = false;
    const b = {
      select(_c, o) { if (o?.head) cabeza = true; return b; },
      eq(c, v) { filtros.push((r) => r[c] === v); return b; },
      neq(c, v) { filtros.push((r) => r[c] !== v); return b; },
      gte(c, v) { filtros.push((r) => String(r[c]) >= String(v)); return b; },
      in(c, vs) { filtros.push((r) => vs.includes(r[c])); return b; },
      order() { return b; }, limit() { return b; },
      insert(v) { modo = "insert"; carga = v; return b; },
      update(v) { modo = "update"; carga = v; return b; },
      delete() { modo = "delete"; return b; },
      single() { unico = true; return b; },
      then(ok, mal) { return ejecutar().then(ok, mal); },
    };
    async function ejecutar() {
      if (globalThis.__sinRed) return { data: null, error: { message: "TypeError: Failed to fetch" } };
      const filas = (datos[nombre] ?? []).filter((r) => filtros.every((f) => f(r)));
      if (modo === "insert") {
        llamadas.push(["insert", nombre, carga]);
        const nuevas = [].concat(carga).map((c, i) => ({ id: `nuevo-${nombre}-${(datos[nombre] ?? []).length + i}`, ...c }));
        (datos[nombre] ??= []).push(...nuevas);
        return { data: unico ? nuevas[0] : null, error: null };
      }
      if (modo === "delete") { llamadas.push(["delete", nombre, filas.map((r) => r.id)]); datos[nombre] = (datos[nombre] ?? []).filter((r) => !filas.includes(r)); return { data: null, error: null }; }
      if (modo === "update") { llamadas.push(["update", nombre, carga]); filas.forEach((r) => Object.assign(r, carga)); return { data: null, error: null }; }
      return cabeza ? { data: null, count: filas.length, error: null } : { data: filas, error: null };
    }
    return b;
  }
  return {
    from: tabla,
    rpc: async (n, a) => { llamadas.push(["rpc", n, a]); if (n === "miembros_de_empresa") return { data: datos.usuarios, error: null }; datos.correcciones.forEach((c) => { if (c.id === a.p_id) c.estado = a.p_aprobar ? "aprobada" : "rechazada"; }); return { data: null, error: null }; },
    auth: {
      getSession: async () => ({ data: { session: sesion } }),
      onAuthStateChange() {},
      signInWithPassword: async ({ password }) => (password === "bien" ? { error: null } : { error: { message: "x" } }),
      signOut: async () => {},
      updateUser: async (v) => { llamadas.push(["updateUser", v]); return { error: null }; },
      refreshSession: async () => ({}),
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://ejemplo.test/selfie.jpg" }, error: null }) }) },
  };
}

globalThis.fetch = async (u, o) => {
  const cuerpo = JSON.parse(o.body);
  llamadas.push(["fetch", String(u), cuerpo]);
  const resp = (c, estado = 200) => ({ ok: estado < 400, status: estado, json: async () => c });
  switch (cuerpo.accion) {
    case "crear_usuario": return resp({ miembro_id: "m9", correo: cuerpo.correo.toLowerCase(), clave_temporal: "Tmp9Abc2Def3Gh", ya_existia: false });
    case "listar_empresas": return resp({ empresas: [{ id: "emp", nombre: "Empresa de prueba", usuarios: 3, empleados: 2 }, { id: "otra", nombre: "Otra Empresa", usuarios: 1, empleados: 0 }] });
    case "crear_empresa": return resp({ empresa_id: "nueva", correo: cuerpo.correo_dueno, clave_temporal: "Emp5Xyz7Wvu4Ts", ya_existia: false });
    default: return resp({ ok: true });
  }
};
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
assert.match(t, /Empresa de prueba · Dueño/, "la barra muestra empresa y rol");
assert.match(t, /Dueno/, "la barra muestra el usuario (sacado del correo)");
assert.ok(document.querySelector(".barra__nombre"), "hay nombre grande de usuario");
assert.ok([...document.querySelectorAll(".nav a")].some((a) => a.textContent.includes("Cuenta")), "el menú dice Cuenta");
assert.ok(![...document.querySelectorAll(".nav a")].some((a) => a.textContent.trim() === "Más"), "ya no hay un menú Más");
assert.match(t, /Hoy/);
assert.ok(!/\bnull\b|undefined/.test(t), "no se cuela ningún null ni undefined en pantalla");
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

// 5b. Cuenta y ayuda
for (const ruta of ["#/cuenta", "#/mas"]) {
  location.hash = ruta;
  window.dispatchEvent(new dom.window.Event("hashchange"));
  await esperar(60);
  t = texto();
  assert.match(t, /Ayuda y aplicación/);
  assert.match(t, /Versión de la aplicación/);
  assert.match(t, /Jose Rigoberto Barocio Sida/);
  assert.match(t, /Cómo se usa/);
  assert.match(t, /Cerrar sesión/);
}
console.log("OK Cuenta: usuario, ayuda, actualización y datos del desarrollador (también por #/mas)");

// 5c. Sin internet: Hoy muestra lo último que cargó
location.hash = "#/hoy";
window.dispatchEvent(new dom.window.Event("hashchange"));
await esperar(100); // carga con red y guarda la copia
globalThis.__sinRed = true;
Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
window.dispatchEvent(new dom.window.Event("offline"));
location.hash = "#/equipo"; window.dispatchEvent(new dom.window.Event("hashchange")); await esperar(40);
location.hash = "#/hoy"; window.dispatchEvent(new dom.window.Event("hashchange")); await esperar(100);
t = texto();
assert.match(t, /Sin conexión\. Esto es lo último que cargaste/);
assert.match(t, /Luis Martínez/);
assert.ok(!document.getElementById("franja").hidden, "la franja de sin conexión está visible");
globalThis.__sinRed = false;
Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
window.dispatchEvent(new dom.window.Event("online"));
console.log("OK sin internet: se muestra la última copia y el aviso");

// 5d. Administrar: usuarios
location.hash = "#/administrar";
window.dispatchEvent(new dom.window.Event("hashchange"));
await esperar(120);
t = texto();
assert.match(t, /Usuarios, sedes y horarios de Empresa de prueba/);
assert.match(t, /Sara Supervisora/);
assert.match(t, /baja@prueba\.mx/, "sin nombre se muestra el correo");
assert.ok([...document.querySelectorAll(".nav a")].some((a) => a.textContent.includes("Administrar")), "el menú tiene Administrar");
[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Agregar usuario")).click();
await esperar();
const fu = document.querySelector("form.formulario");
fu.dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
await esperar();
assert.match(texto(), /Escribe el nombre de la persona/);
document.getElementById("u-nombre").value = "Nora Ruiz"; document.getElementById("u-correo").value = "Nora@Prueba.mx";
document.getElementById("u-rol").value = "consulta";
fu.dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
await esperar(100);
const crear = llamadas.find((c) => c[0] === "fetch" && c[2].accion === "crear_usuario");
assert.ok(crear, "se llamó a la función del servidor");
assert.equal(crear[2].empresa_id, "emp"); assert.equal(crear[2].rol, "consulta");
assert.match(crear[1], /\/functions\/v1\/administrar$/);
assert.match(texto(), /Contraseña temporal: Tmp9Abc2Def3Gh/);
assert.match(texto(), /Se muestra una sola vez/);
console.log("OK Administrar: lista de usuarios, alta y clave temporal de un solo uso");

// detalle de un usuario: cambiar rol
const filaSara = [...document.querySelectorAll("button.fila")].find((b) => b.textContent.includes("Sara"));
filaSara.click(); await esperar(30);
const selRol = document.getElementById("rol-m2");
assert.ok(selRol, "hay selector de rol");
selRol.value = "consulta"; selRol.dispatchEvent(new dom.window.Event("change"));
[...document.querySelectorAll("button")].find((b) => b.textContent === "Guardar cambios").click();
await esperar(80);
const cambio = llamadas.find((c) => c[0] === "fetch" && c[2].accion === "cambiar_rol");
assert.ok(cambio && cambio[2].miembro_id === "m2" && cambio[2].rol === "consulta");
// el dueño no se puede modificar a sí mismo
[...document.querySelectorAll("button.fila")].find((b) => b.textContent.includes("Dueño Prueba")).click(); await esperar(30);
assert.match(texto(), /Eres tú/);
console.log("OK Administrar: cambio de rol y protección de la propia cuenta");

// 5d-bis. Lugares: sedes y geocercas
[...document.querySelectorAll("button")].find((b) => b.textContent === "Lugares").click();
await esperar(100);
t = texto();
assert.match(t, /Sede Centro/);
assert.match(t, /Falta geocerca/, "una sede sin geocerca se marca");
[...document.querySelectorAll("button.fila")].find((b) => b.textContent.includes("Sede Centro")).click(); await esperar(30);
[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Agregar geocerca")).click(); await esperar();
document.getElementById("gc-nueva").value = "no son coordenadas";
let fg = document.getElementById("gc-nueva").closest("form");
fg.dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true })); await esperar();
assert.match(texto(), /Pon la ubicación/);
document.getElementById("gc-nueva").value = "20.6597, -103.3496"; document.getElementById("gr-nueva").value = "9";
fg.dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true })); await esperar();
assert.match(texto(), /entre 10 y 5000/);
document.getElementById("gr-nueva").value = "150";
fg.dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true })); await esperar(100);
const geo = llamadas.find((c) => c[0] === "insert" && c[1] === "geocercas");
assert.ok(geo && geo[2].sede_id === "s1" && geo[2].empresa_id === "emp" && geo[2].radio_m === 150 && geo[2].lat === 20.6597 && geo[2].lng === -103.3496);
assert.match(texto(), /1 geocerca activa/);
// nueva sede
[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Agregar sede")).click(); await esperar();
document.getElementById("ns-nombre").value = "Bodega Norte"; document.getElementById("ns-zona").value = "America/Hermosillo";
document.getElementById("ns-nombre").closest("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true })); await esperar(100);
const sedeNueva = llamadas.find((c) => c[0] === "insert" && c[1] === "sedes");
assert.ok(sedeNueva && sedeNueva[2].nombre === "Bodega Norte" && sedeNueva[2].zona_horaria === "America/Hermosillo");
console.log("OK Lugares: sede nueva y geocerca con validación");

// 5d-ter. Horarios
[...document.querySelectorAll("button")].find((b) => b.textContent === "Horarios").click();
await esperar(100);
assert.match(texto(), /Aún no hay horarios/);
[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Nuevo horario")).click(); await esperar();
document.getElementById("h-nombre").value = "Oficina";
const fh = document.getElementById("h-nombre").closest("form");
fh.dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true })); await esperar(100);
const cab = llamadas.find((c) => c[0] === "insert" && c[1] === "horarios");
assert.ok(cab && cab[2].tolerancia_retardo_min === 10);
const diasIns = llamadas.find((c) => c[0] === "insert" && c[1] === "horario_dias");
assert.equal(diasIns[2].length, 5, "por defecto lunes a viernes");
assert.deepEqual(diasIns[2].map((d) => d.dia_semana), [1, 2, 3, 4, 5]);
assert.ok(diasIns[2].every((d) => d.hora_entrada === "09:00" && d.hora_salida === "18:00"));
assert.match(texto(), /Oficina/);
assert.match(texto(), /Lun–Vie 09:00–18:00/);
console.log("OK Horarios: alta con días y resumen");

// Equipo: asignar el horario a un empleado
location.hash = "#/equipo"; window.dispatchEvent(new dom.window.Event("hashchange")); await esperar(100);
[...document.querySelectorAll("button.fila")].find((b) => b.textContent.includes("Ana López")).click(); await esperar(120);
const selH = document.getElementById("eh-e1");
assert.ok(selH, "hay selector de horario");
selH.value = datos.horarios[0].id;
[...document.querySelectorAll("button")].find((b) => b.textContent === "Cambiar horario").click(); await esperar(100);
const asig = llamadas.find((c) => c[0] === "insert" && c[1] === "empleado_horarios");
assert.ok(asig && asig[2].empleado_id === "e1" && asig[2].horario_id === datos.horarios[0].id && /^\[\d{4}-\d{2}-\d{2},\)$/.test(asig[2].vigencia));
console.log("OK Equipo: horario por empleado");
location.hash = "#/administrar"; window.dispatchEvent(new dom.window.Event("hashchange")); await esperar(100);

// 5e. Administrar: empresas (administrador de la plataforma)
[...document.querySelectorAll("button")].find((b) => b.textContent === "Empresas").click();
await esperar(100);
t = texto();
assert.match(t, /Otra Empresa/);
assert.match(t, /3 usuarios · 2 empleados/);
assert.match(t, /Activa/);
[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Nueva empresa")).click(); await esperar();
document.getElementById("e-nombre").value = "Cafetería Sol"; document.getElementById("e-dueno").value = "Carla Soto"; document.getElementById("e-correo").value = "carla@sol.mx";
document.querySelector("form.formulario").dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
await esperar(100);
assert.ok(llamadas.find((c) => c[0] === "fetch" && c[2].accion === "crear_empresa" && c[2].correo_dueno === "carla@sol.mx"));
assert.match(texto(), /Contraseña temporal: Emp5Xyz7Wvu4Ts/);
console.log("OK Administrar: empresas de la plataforma y alta con dueño");

// 6. Texto de la base no se interpreta como HTML
datos.empleados.push({ empresa_id: "emp", id: "e9", nombre: '<img src=x onerror="window.pwned=1">', telefono: "+523300000000", estado: "activo", sede_id: "s1" });
location.hash = "#/hoy";
window.dispatchEvent(new dom.window.Event("hashchange"));
await esperar(100);
assert.equal(document.querySelectorAll('img[src="x"]').length, 0);
assert.ok(!window.pwned);
assert.match(texto(), /<img src=x/);
console.log("OK seguridad: un nombre con HTML se muestra como texto");

// 5f. Cambio de contraseña obligatorio con clave temporal
document.getElementById("app").replaceChildren();
location.hash = "";
await iniciarApp({ sb: crearSb({ user: { id: "u1", email: "nuevo@prueba.mx", user_metadata: { debe_cambiar_clave: true } } }), url: "https://x.supabase.co", key: "k", raiz: document.getElementById("app"), avisos: document.getElementById("avisos") });
await esperar(80);
assert.match(texto(), /Elige tu contraseña/);
document.getElementById("cl-nueva").value = "abc"; document.getElementById("cl-rep").value = "abc";
document.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true })); await esperar();
assert.match(texto(), /al menos 8 caracteres/);
document.getElementById("cl-nueva").value = "claveNueva123"; document.getElementById("cl-rep").value = "otraDistinta1";
document.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true })); await esperar();
assert.match(texto(), /no coinciden/);
document.getElementById("cl-rep").value = "claveNueva123";
document.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true })); await esperar(100);
const act = llamadas.find((c) => c[0] === "updateUser");
assert.ok(act && act[1].password === "claveNueva123" && act[1].data.debe_cambiar_clave === false);
console.log("OK contraseña temporal: se obliga a elegir una propia");

process.exit(0);
