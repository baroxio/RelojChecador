// Prueba de la función "administrar" con una base de datos simulada (sin red).
// Ejecutar desde la raíz del proyecto: node tests/funciones/administrar.prueba.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const raiz = new URL("../../supabase/functions/", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "administrar-"));
cpSync(join(raiz, "_shared"), join(tmp, "_shared"), { recursive: true });
mkdirSync(join(tmp, "administrar"));
// Se sustituye solo la importación de supabase-js (npm:) por el doble de prueba.
writeFileSync(join(tmp, "administrar", "index.ts"),
  readFileSync(join(raiz, "administrar", "index.ts"), "utf8").replace('"npm:@supabase/supabase-js@2"', '"./doble.mjs"'));

// ---------- Base de datos simulada ----------
const MID = { dueno: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001", admin: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002", sup: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003", b: "aaaaaaaa-aaaa-4aaa-8aaa-000000000004" };
const datos = {};
let seq = 1;
const reiniciar = () => {
  for (const k of Object.keys(datos)) delete datos[k];
  Object.assign(datos, {
    auth_users: [
      { id: "u-dueno", email: "dueno@a.mx" }, { id: "u-admin", email: "admin@a.mx" },
      { id: "u-sup", email: "sup@a.mx" }, { id: "u-plat", email: "plat@x.mx" }, { id: "u-b", email: "dueno@b.mx" },
    ],
    empresas: [{ id: "11111111-1111-4111-8111-111111111111", nombre: "Empresa A", creado_at: "2026-01-01" },
               { id: "22222222-2222-4222-8222-222222222222", nombre: "Empresa B", creado_at: "2026-01-02" }],
    sedes: [{ id: "33333333-3333-4333-8333-333333333333", empresa_id: "11111111-1111-4111-8111-111111111111", nombre: "Centro" }],
    miembros: [
      { id: MID.dueno, empresa_id: "11111111-1111-4111-8111-111111111111", user_id: "u-dueno", rol: "dueno", activo: true },
      { id: MID.admin, empresa_id: "11111111-1111-4111-8111-111111111111", user_id: "u-admin", rol: "admin", activo: true },
      { id: MID.sup, empresa_id: "11111111-1111-4111-8111-111111111111", user_id: "u-sup", rol: "supervisor", activo: true },
      { id: MID.b, empresa_id: "22222222-2222-4222-8222-222222222222", user_id: "u-b", rol: "dueno", activo: true },
    ],
    empleados: [{ empresa_id: "11111111-1111-4111-8111-111111111111", estado: "activo" }],
    plataforma_admins: [{ user_id: "u-plat" }], miembro_sedes: [], bitacora: [],
  });
};
const M = (k) => MID[k];

function tabla(nombre) {
  const filtros = []; let op = "select"; let carga = null;
  const filas = () => (datos[nombre] ??= []);
  const b = {
    select() { return b; }, order() { return b; },
    eq(c, v) { filtros.push((r) => r[c] === v); return b; },
    in(c, vs) { filtros.push((r) => vs.includes(r[c])); return b; },
    insert(v) { op = "insert"; carga = v; return b; },
    update(v) { op = "update"; carga = v; return b; },
    delete() { op = "delete"; return b; },
    maybeSingle() { return ejecutar("maybe"); },
    single() { return ejecutar("single"); },
    then(ok, mal) { return ejecutar().then(ok, mal); },
  };
  async function ejecutar(uno) {
    const coincide = () => filas().filter((r) => filtros.every((f) => f(r)));
    if (op === "insert") {
      const nuevos = (Array.isArray(carga) ? carga : [carga]).map((r) => ({ id: `${nombre}-${seq++}`, activo: true, ...r }));
      if (nombre === "miembros" && nuevos.some((n) => filas().some((x) => x.empresa_id === n.empresa_id && x.user_id === n.user_id))) {
        return { data: null, error: { code: "23505", message: "duplicado" } };
      }
      filas().push(...nuevos);
      return { data: uno ? nuevos[0] : nuevos, error: null };
    }
    if (op === "update") { coincide().forEach((r) => Object.assign(r, carga)); return { data: null, error: null }; }
    if (op === "delete") { datos[nombre] = filas().filter((r) => !filtros.every((f) => f(r))); return { data: null, error: null }; }
    const r = coincide();
    if (uno === "single") return r.length ? { data: r[0], error: null } : { data: null, error: { message: "sin filas" } };
    if (uno === "maybe") return { data: r[0] ?? null, error: null };
    return { data: r, error: null };
  }
  return b;
}
globalThis.__doble = {
  createClient: () => ({
    from: tabla,
    rpc: async (n, a) => ({ data: n === "usuario_id_por_correo" ? (datos.auth_users.find((u) => u.email === a.p_correo)?.id ?? null) : null, error: null }),
    auth: {
      getUser: async (token) => { const u = datos.auth_users.find((x) => token === `tok-${x.id}`); return u ? { data: { user: u }, error: null } : { data: null, error: { message: "x" } }; },
      admin: {
        createUser: async ({ email, password, user_metadata }) => {
          if (datos.auth_users.some((u) => u.email === email)) return { data: null, error: { message: "ya registrado" } };
          const u = { id: `u-nuevo-${seq++}`, email, password, user_metadata }; datos.auth_users.push(u); return { data: { user: u }, error: null };
        },
        updateUserById: async (id, v) => { Object.assign(datos.auth_users.find((u) => u.id === id), v); return { error: null }; },
      },
    },
  }),
};
writeFileSync(join(tmp, "administrar", "doble.mjs"), "export const createClient = (...a) => globalThis.__doble.createClient(...a);\n");

// Deno falso: variables de entorno y servidor.
let atender;
globalThis.Deno = { env: { get: () => "x" }, serve: (f) => { atender = f; } };
await import(pathToFileURL(join(tmp, "administrar", "index.ts")).href);

async function llamar(usuario, cuerpo, { sinToken = false } = {}) {
  const r = await atender(new Request("http://x/", {
    method: "POST", headers: { "Content-Type": "application/json", ...(sinToken ? {} : { Authorization: `Bearer tok-${usuario}` }) },
    body: JSON.stringify(cuerpo),
  }));
  return { estado: r.status, cuerpo: await r.json() };
}
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", SEDE = "33333333-3333-4333-8333-333333333333";
let n = 0; const ok = (t) => console.log(`OK ${++n}. ${t}`);

reiniciar();
let r = await llamar("u-admin", { accion: "crear_usuario" }, { sinToken: true });
assert.equal(r.estado, 401); ok("sin sesión: 401");

r = await llamar("u-admin", { accion: "crear_usuario", empresa_id: A, correo: "Nueva@A.mx", nombre: "Nora Ruiz", rol: "supervisor", sede_ids: [SEDE] });
assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
assert.equal(r.cuerpo.clave_temporal.length, 14);
assert.equal(r.cuerpo.correo, "nueva@a.mx");
assert.ok(datos.miembros.some((m) => m.rol === "supervisor" && m.empresa_id === A && m.user_id.startsWith("u-nuevo")));
assert.equal(datos.miembro_sedes.length, 1);
assert.ok(datos.auth_users.at(-1).user_metadata.debe_cambiar_clave);
assert.ok(datos.bitacora.some((b) => b.accion === "crear_usuario" && b.actor === "u-admin"));
ok("el administrador da de alta a un supervisor: clave temporal, sede y bitácora");

r = await llamar("u-admin", { accion: "crear_usuario", empresa_id: A, correo: "otro@a.mx", nombre: "Otro Admin", rol: "admin" });
assert.equal(r.estado, 403); ok("el administrador NO puede crear otro administrador");

r = await llamar("u-dueno", { accion: "crear_usuario", empresa_id: A, correo: "otro@a.mx", nombre: "Otro Admin", rol: "admin" });
assert.equal(r.estado, 200); ok("el dueño sí puede nombrar administradores");

r = await llamar("u-dueno", { accion: "crear_usuario", empresa_id: A, correo: "plat@x.mx", nombre: "Plataforma", rol: "consulta" });
assert.equal(r.estado, 200); assert.equal(r.cuerpo.ya_existia, true); assert.equal(r.cuerpo.clave_temporal, null);
ok("un correo que ya existe se agrega sin tocar su contraseña");

r = await llamar("u-dueno", { accion: "crear_usuario", empresa_id: A, correo: "sup@a.mx", nombre: "Sup", rol: "consulta" });
assert.equal(r.estado, 409); ok("no se duplica a alguien que ya está en la empresa");

r = await llamar("u-sup", { accion: "crear_usuario", empresa_id: A, correo: "x@a.mx", nombre: "Xavier", rol: "consulta" });
assert.equal(r.estado, 403); ok("un supervisor no puede dar de alta usuarios");

r = await llamar("u-admin", { accion: "crear_usuario", empresa_id: B, correo: "x@b.mx", nombre: "Xavier", rol: "consulta" });
assert.equal(r.estado, 403); ok("un administrador no puede operar en otra empresa");

r = await llamar("u-admin", { accion: "crear_usuario", empresa_id: A, correo: "mal", nombre: "Xavier", rol: "consulta" });
assert.equal(r.estado, 403); assert.match(r.cuerpo.error, /correo/); ok("correo inválido: mensaje en español");

r = await llamar("u-admin", { accion: "cambiar_rol", miembro_id: M("sup"), rol: "consulta" });
assert.equal(r.estado, 200); assert.equal(datos.miembros.find((m) => m.id === MID.sup).rol, "consulta");
assert.equal(datos.miembro_sedes.length, 0 + datos.miembro_sedes.length);
ok("el administrador cambia un supervisor a consulta");

r = await llamar("u-admin", { accion: "cambiar_rol", miembro_id: M("dueno"), rol: "consulta" });
assert.equal(r.estado, 403); ok("el administrador no puede tocar al dueño");

r = await llamar("u-dueno", { accion: "cambiar_rol", miembro_id: M("dueno"), rol: "admin" });
assert.equal(r.estado, 403); assert.match(r.cuerpo.error, /propio rol/); ok("nadie cambia su propio rol");

r = await llamar("u-admin", { accion: "cambiar_activo", miembro_id: M("sup"), activo: false });
assert.equal(r.estado, 200); assert.equal(datos.miembros.find((m) => m.id === MID.sup).activo, false); ok("baja de un usuario");
r = await llamar("u-admin", { accion: "cambiar_activo", miembro_id: M("sup"), activo: true });
assert.equal(datos.miembros.find((m) => m.id === MID.sup).activo, true); ok("reactivación de un usuario");

r = await llamar("u-admin", { accion: "reiniciar_clave", miembro_id: M("sup") });
assert.equal(r.estado, 200); assert.equal(r.cuerpo.clave_temporal.length, 14);
assert.equal(datos.auth_users.find((u) => u.id === "u-sup").password, r.cuerpo.clave_temporal); ok("reiniciar clave de un supervisor");
r = await llamar("u-admin", { accion: "reiniciar_clave", miembro_id: M("dueno") });
assert.equal(r.estado, 403); ok("un administrador no reinicia la clave del dueño");

// ---- baja de un usuario desactivado no debe poder actuar
datos.miembros.find((m) => m.id === MID.admin).activo = false;
r = await llamar("u-admin", { accion: "crear_usuario", empresa_id: A, correo: "z@a.mx", nombre: "Zoe", rol: "consulta" });
assert.equal(r.estado, 403); ok("un administrador dado de baja ya no puede hacer nada");
datos.miembros.find((m) => m.id === MID.admin).activo = true;

// ---- plataforma
r = await llamar("u-admin", { accion: "listar_empresas" });
assert.equal(r.estado, 403); ok("un administrador de empresa no ve la plataforma");

r = await llamar("u-plat", { accion: "listar_empresas" });
assert.equal(r.estado, 200); assert.equal(r.cuerpo.empresas.length, 2);
assert.equal(r.cuerpo.empresas.find((e) => e.id === A).empleados, 1); ok("el administrador de la plataforma lista las empresas con sus cuentas");

r = await llamar("u-plat", { accion: "crear_empresa", nombre: "Empresa C", correo_dueno: "nuevo@c.mx", nombre_dueno: "Carla" });
assert.equal(r.estado, 200); assert.equal(r.cuerpo.clave_temporal.length, 14);
const c = datos.empresas.find((e) => e.nombre === "Empresa C");
assert.ok(c && datos.miembros.some((m) => m.empresa_id === c.id && m.rol === "dueno") && datos.sedes.some((s) => s.empresa_id === c.id));
ok("crear empresa: dueño, clave temporal y sede inicial");

const antes = datos.empresas.length;
r = await llamar("u-plat", { accion: "crear_empresa", nombre: "Empresa D", correo_dueno: "mal", nombre_dueno: "Dora" });
assert.equal(r.estado, 400); assert.equal(datos.empresas.length, antes); ok("datos inválidos no crean nada");

r = await llamar("u-plat", { accion: "renombrar_empresa", empresa_id: B, nombre: "Empresa Be" });
assert.equal(r.estado, 200); assert.equal(datos.empresas.find((e) => e.id === B).nombre, "Empresa Be"); ok("renombrar empresa");

r = await llamar("u-plat", { accion: "unirme_a_empresa", empresa_id: B });
assert.equal(r.estado, 200); assert.ok(datos.miembros.some((m) => m.empresa_id === B && m.user_id === "u-plat" && m.rol === "admin"));
assert.ok(datos.bitacora.some((b) => b.accion === "unirme_a_empresa" && b.actor === "u-plat")); ok("unirse a una empresa deja constancia");

r = await llamar("u-admin", { accion: "unirme_a_empresa", empresa_id: B });
assert.equal(r.estado, 403); ok("un administrador común no puede unirse a otras empresas");

r = await llamar("u-dueno", { accion: "borrar_todo" });
assert.equal(r.estado, 400); ok("una acción desconocida se rechaza");
process.exit(0);
