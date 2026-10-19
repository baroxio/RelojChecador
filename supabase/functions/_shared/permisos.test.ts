// Ejecutar: node --test supabase/functions/_shared/permisos.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  correoValido, errorAlCambiarActivo, errorAlCambiarRol, errorAlCrearUsuario, generarClaveTemporal,
  normalizarCorreo, puedeGestionar, rolesAsignables, type Miembro,
} from "./permisos.ts";

const m = (id: string, user_id: string, rol: Miembro["rol"], activo = true): Miembro => ({ id, user_id, rol, activo });

test("qué roles puede asignar cada quién", () => {
  assert.deepEqual(rolesAsignables("dueno"), ["dueno", "admin", "supervisor", "consulta"]);
  assert.deepEqual(rolesAsignables("admin"), ["supervisor", "consulta"]);
  assert.deepEqual(rolesAsignables("supervisor"), []);
  assert.deepEqual(rolesAsignables("consulta"), []);
});

test("a quién puede gestionar cada rol", () => {
  assert.equal(puedeGestionar("dueno", "dueno"), true);
  assert.equal(puedeGestionar("admin", "admin"), false);
  assert.equal(puedeGestionar("admin", "dueno"), false);
  assert.equal(puedeGestionar("admin", "supervisor"), true);
  assert.equal(puedeGestionar("supervisor", "consulta"), false);
});

test("correos", () => {
  assert.equal(normalizarCorreo("  Eventos@MOBA.mx "), "eventos@moba.mx");
  assert.equal(correoValido("eventos@moba.mx"), true);
  for (const mal of ["", "a@b", "a b@c.mx", "@c.mx", "a@c.", "sin-arroba.mx"]) assert.equal(correoValido(mal), false, mal);
});

test("alta de usuarios: permisos y datos", () => {
  assert.equal(errorAlCrearUsuario({ actor: "admin", correo: "a@b.mx", nombre: "Ana", rol: "supervisor" }), null);
  assert.match(errorAlCrearUsuario({ actor: "admin", correo: "a@b.mx", nombre: "Ana", rol: "admin" })!, /permiso/);
  assert.match(errorAlCrearUsuario({ actor: "supervisor", correo: "a@b.mx", nombre: "Ana", rol: "consulta" })!, /permiso/);
  assert.match(errorAlCrearUsuario({ actor: "dueno", correo: "mal", nombre: "Ana", rol: "admin" })!, /correo/);
  assert.match(errorAlCrearUsuario({ actor: "dueno", correo: "a@b.mx", nombre: " ", rol: "admin" })!, /nombre/);
  assert.match(errorAlCrearUsuario({ actor: "dueno", correo: "a@b.mx", nombre: "Ana", rol: "root" })!, /rol/);
});

test("cambio de rol: reglas", () => {
  const miembros = [m("1", "u-dueno", "dueno"), m("2", "u-admin", "admin"), m("3", "u-sup", "supervisor")];
  const base = { actorUserId: "u-admin", miembros };
  assert.equal(errorAlCambiarRol({ ...base, actor: "admin", objetivo: miembros[2], nuevoRol: "consulta" }), null);
  assert.match(errorAlCambiarRol({ ...base, actor: "admin", objetivo: miembros[2], nuevoRol: "admin" })!, /asignar/);
  assert.match(errorAlCambiarRol({ ...base, actor: "admin", objetivo: miembros[0], nuevoRol: "consulta" })!, /permiso/);
  assert.match(errorAlCambiarRol({ ...base, actor: "admin", objetivo: miembros[1], nuevoRol: "consulta" })!, /propio rol/);
  // el dueño único no puede dejar de ser dueño
  assert.match(errorAlCambiarRol({ actor: "dueno", actorUserId: "otro", miembros, objetivo: miembros[0], nuevoRol: "admin" })!, /al menos un dueño/);
  // con dos dueños sí
  const dos = [...miembros, m("4", "u-dueno2", "dueno")];
  assert.equal(errorAlCambiarRol({ actor: "dueno", actorUserId: "u-dueno2", miembros: dos, objetivo: dos[0], nuevoRol: "admin" }), null);
  // un dueño inactivo no cuenta como dueño que quede
  const unoInactivo = [m("1", "u-dueno", "dueno"), m("4", "u-dueno2", "dueno", false)];
  assert.match(errorAlCambiarRol({ actor: "dueno", actorUserId: "x", miembros: unoInactivo, objetivo: unoInactivo[0], nuevoRol: "admin" })!, /al menos un dueño/);
});

test("baja y reactivación: reglas", () => {
  const miembros = [m("1", "u-dueno", "dueno"), m("2", "u-admin", "admin"), m("3", "u-sup", "supervisor", false)];
  assert.equal(errorAlCambiarActivo({ actor: "admin", actorUserId: "u-admin", miembros, objetivo: miembros[2], activo: true }), null);
  assert.match(errorAlCambiarActivo({ actor: "admin", actorUserId: "u-admin", miembros, objetivo: miembros[1], activo: false })!, /a ti mismo/);
  assert.match(errorAlCambiarActivo({ actor: "admin", actorUserId: "u-admin", miembros, objetivo: miembros[0], activo: false })!, /permiso/);
  assert.match(errorAlCambiarActivo({ actor: "dueno", actorUserId: "otro", miembros, objetivo: miembros[0], activo: false })!, /al menos un dueño/);
});

test("clave temporal: longitud, alfabeto y variedad", () => {
  const claves = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const c = generarClaveTemporal();
    assert.equal(c.length, 14);
    assert.ok(/^[A-HJ-NP-Za-km-z2-9]+$/.test(c), c);
    claves.add(c);
  }
  assert.equal(claves.size, 500);
  assert.equal(generarClaveTemporal(20).length, 20);
});
