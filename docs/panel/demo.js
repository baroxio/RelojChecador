// Vista de ejemplo del panel con DATOS FICTICIOS y sin conexión a ninguna base de datos.
// Sirve para ver y revisar el diseño. Nada de lo que se hace aquí se guarda.
import { iniciarApp } from "./ui.js";
import { aUTCdesdeLocal, fechaLocal } from "./logic.js";

const TZ = "America/Mexico_City";
const ahora = new Date();
const hoy = fechaLocal(ahora, TZ);
const inicioDia = aUTCdesdeLocal(hoy, "00:01", TZ);
const a = (hhmm) => { const t = aUTCdesdeLocal(hoy, hhmm, TZ); return new Date(Math.min(t, ahora - 120_000)).toISOString(); };
const hace = (min) => new Date(Math.max(ahora - min * 60_000, +inicioDia)).toISOString();

const selfie = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#c9d4f0"/><circle cx="150" cy="150" r="62" fill="#17275a"/><path d="M40 400c0-90 50-140 110-140s110 50 110 140z" fill="#17275a"/><text x="150" y="375" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#fff">Selfie de ejemplo</text></svg>`);

const e = (id, nombre, tel) => ({ id, nombre, telefono: tel, estado: "activo", sede_id: "s1" });
const datos = {
  miembros: [{ id: "m1", empresa_id: "emp", rol: "dueno", user_id: "u1", activo: true }],
  empresas: [{ id: "emp", nombre: "Panadería La Espiga (ejemplo)" }],
  sedes: [{ id: "s1", nombre: "Sucursal Centro", zona_horaria: TZ, activa: true }],
  empleados: [
    e("e1", "Ana López Ruiz", "+523312345601"), e("e2", "Luis Martínez", "+523312345602"),
    e("e3", "Rosa Pérez Díaz", "+523312345603"), e("e4", "Pedro Ruiz", "+523312345604"),
    e("e5", "Marta Salas", "+523312345605"),
    { id: "e6", nombre: "Jorge Hernández", telefono: "+523312345606", estado: "invitado", sede_id: "s1" },
  ],
  horarios: [{ id: "h1", tolerancia_retardo_min: 10 }],
  horario_dias: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ horario_id: "h1", dia_semana: d, hora_entrada: "09:00:00" })),
  empleado_horarios: ["e1", "e2", "e3", "e4", "e5"].map((id) => ({ empleado_id: id, horario_id: "h1", vigencia: "[2026-01-01,)" })),
  registros_efectivos: [
    { origen: "registro", fuente_id: "r1", empleado_id: "e1", sede_id: "s1", tipo: "entrada", hora_efectiva: a("09:24"), hora_original: a("09:24"), canal: "whatsapp", senales: [], medio_id: "m1", corregido: false },
    { origen: "registro", fuente_id: "r2", empleado_id: "e2", sede_id: "s1", tipo: "entrada", hora_efectiva: a("08:56"), hora_original: a("08:56"), canal: "whatsapp", senales: ["ubicacion_elegida", "foto_repetida"], medio_id: "m1", corregido: false },
    { origen: "registro", fuente_id: "r3", empleado_id: "e3", sede_id: "s1", tipo: "entrada", hora_efectiva: a("08:50"), hora_original: a("08:50"), canal: "whatsapp", senales: [], medio_id: "m1", corregido: false },
    { origen: "registro", fuente_id: "r4", empleado_id: "e3", sede_id: "s1", tipo: "pausa_inicio", hora_efectiva: hace(25), hora_original: hace(25), canal: "whatsapp", senales: [], medio_id: "m1", corregido: false },
    { origen: "registro", fuente_id: "r5", empleado_id: "e4", sede_id: "s1", tipo: "entrada", hora_efectiva: hace(300), hora_original: hace(300), canal: "whatsapp", senales: [], medio_id: "m1", corregido: false },
    { origen: "registro", fuente_id: "r6", empleado_id: "e4", sede_id: "s1", tipo: "salida", hora_efectiva: hace(40), hora_original: hace(40), canal: "whatsapp", senales: ["secuencia_inusual"], medio_id: "m1", corregido: true },
  ],
  registros: ["r1", "r2", "r3", "r4", "r5", "r6"].map((id, i) => ({ id, lat: 20.67, lng: -103.35, distancia_m: [38, 120, 55, 60, 22, 47][i], dentro_geocerca: true, medio_id: "m1",
    tipo: ["entrada", "entrada", "entrada", "pausa_inicio", "entrada", "salida"][i], ocurrido_at: [a("09:24"), a("08:56"), a("08:50"), hace(25), hace(300), hace(40)][i] })),
  medios: [{ id: "m1", ruta_storage: "ejemplo/selfie.jpg" }],
  correcciones: [
    { id: "c1", empleado_id: "e1", registro_id: "r1", tipo: "modificar_hora", nuevo_tipo: null, nueva_hora: a("08:58"), motivo: "Llegó a tiempo pero se le fue la señal", origen: "supervisor", estado: "pendiente", creada_at: hace(90), resuelto_at: null, comentario_resolucion: null },
    { id: "c2", empleado_id: "e5", registro_id: null, tipo: "agregar", nuevo_tipo: "entrada", nueva_hora: hace(20), motivo: "Olvidó checar al llegar", origen: "admin", estado: "pendiente", creada_at: hace(30), resuelto_at: null, comentario_resolucion: null },
  ],
};

// Las consultas del panel filtran por la empresa activa.
for (const t of ["sedes", "empleados", "registros_efectivos", "horarios", "empleado_horarios", "correcciones"]) {
  for (const fila of datos[t]) fila.empresa_id = "emp";
}
datos.plataforma_admins = [{ user_id: "u1" }];
datos.usuarios = [
  { miembro_id: "m1", user_id: "u1", correo: "laura@laespiga.mx", nombre: "Laura Gómez", rol: "dueno", activo: true, sedes: [] },
  { miembro_id: "m2", user_id: "u2", correo: "rh@laespiga.mx", nombre: "Marcela Ríos", rol: "admin", activo: true, sedes: [] },
  { miembro_id: "m3", user_id: "u3", correo: "centro@laespiga.mx", nombre: "Sergio Ortega", rol: "supervisor", activo: true, sedes: ["s1"] },
  { miembro_id: "m4", user_id: "u4", correo: "consulta@laespiga.mx", nombre: null, rol: "consulta", activo: false, sedes: [] },
];

function tabla(nombre) {
  const filtros = []; let cabeza = false; let modo = "select";
  const b = {
    select(_c, o) { if (o?.head) cabeza = true; return b; },
    eq(c, v) { filtros.push((r) => r[c] === v); return b; },
    neq(c, v) { filtros.push((r) => r[c] !== v); return b; },
    gte() { return b; }, order() { return b; }, limit() { return b; },
    in(c, vs) { filtros.push((r) => vs.includes(r[c])); return b; },
    insert() { modo = "escritura"; return b; }, update() { modo = "escritura"; return b; },
    then(ok, mal) { return Promise.resolve().then(() => {
      if (modo === "escritura") return { data: null, error: null };
      const filas = (datos[nombre] ?? []).filter((r) => filtros.every((f) => f(r)));
      return cabeza ? { data: null, count: filas.length, error: null } : { data: filas, error: null };
    }).then(ok, mal); },
  };
  return b;
}

const sb = {
  from: tabla,
  rpc: async (n, a2) => { if (n === "miembros_de_empresa") return { data: datos.usuarios, error: null }; const c = datos.correcciones.find((x) => x.id === a2.p_id); if (c) c.estado = a2.p_aprobar ? "aprobada" : "rechazada"; return { data: null, error: null }; },
  auth: {
    getSession: async () => ({ data: { session: { user: { id: "u1", email: "dueno@ejemplo.mx", user_metadata: { nombre: "Laura Gómez" } }, access_token: "demo" } } }),
    onAuthStateChange() {}, signInWithPassword: async () => ({ error: null }), signOut: async () => { location.reload(); },
  },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: selfie }, error: null }) }) },
};

// Las invitaciones de ejemplo no llaman a ningún servidor.
const fetchReal = window.fetch.bind(window);
const resp = (c) => Promise.resolve(new Response(JSON.stringify(c), { status: 200 }));
window.fetch = (u, o) => String(u).includes("/functions/v1/administrar")
  ? ({ listar_empresas: () => resp({ empresas: [{ id: "emp", nombre: "Panadería La Espiga (ejemplo)", usuarios: 4, empleados: 5 }, { id: "x2", nombre: "Cafetería Sol (ejemplo)", usuarios: 2, empleados: 8 }] }),
       crear_usuario: () => resp({ correo: JSON.parse(o.body).correo, clave_temporal: "Tmp9Abc2Def3Gh", ya_existia: false }) }[JSON.parse(o.body).accion] ?? (() => resp({ ok: true })))()
  : String(u).includes("/functions/v1/crear-invitacion")
  ? Promise.resolve(new Response(JSON.stringify({ codigo: "K7M2Q9XA", enlace: "https://wa.me/15556428542?text=ALTA%20K7M2Q9XA", expira_at: new Date(Date.now() + 72 * 3600_000).toISOString() }), { status: 200 }))
  : fetchReal(u, o);

iniciarApp({ sb, url: "https://ejemplo.invalid", key: "demo", raiz: document.getElementById("app"), avisos: document.getElementById("avisos") });
