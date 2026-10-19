// Ejecutar: node --test docs/panel/logic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aUTCdesdeLocal, contarGrupos, diaSemana, enlaceMensajeEmpleado, fechaLocal, formatearDistancia,
  formatearDuracion, formatearTelefono, horaLocal, horarioDelDia, iniciales, minutosDeRetardo,
  normalizarTelefonoMx, parsearVigencia, resumenDelDia, etiquetaSenal, rolesAsignables, puedeGestionarRol,
} from "./logic.js";

const MX = "America/Mexico_City";

test("teléfonos mexicanos", () => {
  assert.equal(normalizarTelefonoMx("33 1284 0590"), "+523312840590");
  assert.equal(normalizarTelefonoMx("+52 1 33 1284 0590"), "+523312840590");
  assert.equal(normalizarTelefonoMx("5213312840590"), "+523312840590");
  assert.equal(normalizarTelefonoMx("523312840590"), "+523312840590");
  assert.equal(normalizarTelefonoMx("12345"), null);
  assert.equal(normalizarTelefonoMx(""), null);
  assert.equal(formatearTelefono("+523312840590"), "+52 33 1284 0590");
  assert.equal(formatearTelefono("+15556428542"), "+15556428542");
});

test("iniciales", () => {
  assert.equal(iniciales("Ana López"), "AL");
  assert.equal(iniciales("Jose Rigoberto Barocio Sida"), "JS");
  assert.equal(iniciales("  luis "), "L");
  assert.equal(iniciales(""), "?");
});

test("fechas locales y conversión a UTC", () => {
  const d = new Date("2026-10-19T14:13:00Z"); // 08:13 en CDMX (UTC-6)
  assert.equal(horaLocal(d, MX), "08:13");
  assert.equal(fechaLocal(d, MX), "2026-10-19");
  assert.equal(fechaLocal(new Date("2026-10-19T03:00:00Z"), MX), "2026-10-18");
  assert.equal(aUTCdesdeLocal("2026-10-19", "08:13", MX).toISOString(), "2026-10-19T14:13:00.000Z");
  assert.equal(aUTCdesdeLocal("2026-10-19", "23:30", MX).toISOString(), "2026-10-20T05:30:00.000Z");
  // Sonora no cambia de horario y está en UTC-7
  assert.equal(aUTCdesdeLocal("2026-07-01", "09:00", "America/Hermosillo").toISOString(), "2026-07-01T16:00:00.000Z");
  assert.equal(diaSemana("2026-10-19"), 1); // lunes
  assert.equal(diaSemana("2026-10-18"), 0); // domingo
});

test("vigencia de horarios", () => {
  assert.deepEqual(parsearVigencia("[2026-10-01,)"), { desde: "2026-10-01", hasta: null });
  assert.deepEqual(parsearVigencia("[2026-10-01,2026-12-31)"), { desde: "2026-10-01", hasta: "2026-12-31" });
  assert.equal(parsearVigencia("basura"), null);
});

const datos = {
  horarios: [{ id: "h1", tolerancia_retardo_min: 10 }],
  horarioDias: [1, 2, 3, 4, 5].map((n) => ({ horario_id: "h1", dia_semana: n, hora_entrada: "09:00:00" })),
  empleadoHorarios: [{ empleado_id: "e1", horario_id: "h1", vigencia: "[2026-01-01,)" }],
};

test("horario del día y retardos", () => {
  const lun = horarioDelDia("e1", "2026-10-19", datos);
  assert.deepEqual(lun, { laboral: true, entradas: ["09:00"], tolerancia: 10 });
  assert.equal(horarioDelDia("e1", "2026-10-18", datos).laboral, false); // domingo
  assert.equal(horarioDelDia("e2", "2026-10-19", datos), null);
  assert.equal(minutosDeRetardo("09:10", lun), 0); // dentro de la tolerancia
  assert.equal(minutosDeRetardo("09:11", lun), 11);
  assert.equal(minutosDeRetardo("08:30", lun), 0);
  assert.equal(minutosDeRetardo("09:30", null), 0);
});

const emp = (id, nombre, estado = "activo") => ({ id, nombre, estado, sede_id: "s1" });
const reg = (empleado_id, tipo, iso, senales = []) => ({ empleado_id, tipo, hora_efectiva: iso, senales });

test("resumen del día agrupa por situación", () => {
  const ahora = new Date("2026-10-19T20:00:00Z"); // 14:00 CDMX, lunes
  const tz = { s1: MX };
  const empleados = [
    emp("e1", "Ana"), emp("e2", "Luis"), emp("e3", "Rosa"), emp("e4", "Pedro"), emp("e5", "Baja", "baja"),
  ];
  const registros = [
    reg("e1", "entrada", "2026-10-19T15:20:00Z"), // 09:20 -> retardo de 20 min
    reg("e3", "entrada", "2026-10-19T14:00:00Z"),
    reg("e3", "pausa_inicio", "2026-10-19T18:00:00Z"),
    reg("e4", "entrada", "2026-10-19T14:50:00Z", ["foto_repetida"]),
    reg("e4", "salida", "2026-10-19T19:00:00Z", ["secuencia_inusual"]),
  ];
  const filas = resumenDelDia(empleados, registros, ahora, tz, datos);
  const por = Object.fromEntries(filas.map((f) => [f.empleado.id, f]));
  assert.equal(filas.length, 4); // la baja no cuenta
  assert.equal(por.e1.grupo, "en_turno");
  assert.equal(por.e1.retardo, 20);
  assert.equal(por.e2.grupo, "faltan");
  assert.equal(por.e3.grupo, "en_pausa");
  assert.equal(por.e4.grupo, "salieron");
  assert.deepEqual(por.e4.senales.sort(), ["foto_repetida", "secuencia_inusual"]);
  assert.deepEqual(contarGrupos(filas), { en_turno: 1, faltan: 1, en_pausa: 1, salieron: 1 });
});

test("antes de la hora de entrada no se marca falta", () => {
  const ahora = new Date("2026-10-19T13:00:00Z"); // 07:00 CDMX
  const filas = resumenDelDia([emp("e1", "Ana")], [], ahora, { s1: MX }, datos);
  assert.equal(filas[0].grupo, "por_llegar");
});

test("domingo sin horario laboral es descanso, sin horario es falta", () => {
  const domingo = new Date("2026-10-18T20:00:00Z");
  assert.equal(resumenDelDia([emp("e1", "Ana")], [], domingo, { s1: MX }, datos)[0].grupo, "descanso");
  assert.equal(resumenDelDia([emp("e2", "Luis")], [], domingo, { s1: MX }, datos)[0].grupo, "faltan");
});

test("turno nocturno abierto desde ayer sigue en turno", () => {
  const ahora = new Date("2026-10-19T09:00:00Z"); // 03:00 CDMX del lunes
  const filas = resumenDelDia(
    [emp("e1", "Ana")], [reg("e1", "entrada", "2026-10-19T03:00:00Z")], ahora, { s1: MX }, {},
  );
  assert.equal(filas[0].grupo, "en_turno");
  assert.equal(filas[0].desdeAyer, true);
});

test("formatos", () => {
  assert.equal(formatearDuracion(12), "12 min");
  assert.equal(formatearDuracion(65), "1 h 05 min");
  assert.equal(formatearDuracion(120), "2 h");
  assert.equal(formatearDistancia(849.6), "850 m");
  assert.equal(formatearDistancia(12400), "12.4 km");
  assert.equal(formatearDistancia(NaN), "distancia desconocida");
  assert.equal(etiquetaSenal("foto_repetida"), "La selfie es idéntica a una anterior");
  assert.equal(etiquetaSenal("otra_cosa"), "otra cosa");
});

test("mensaje de invitación por WhatsApp al empleado", () => {
  const url = enlaceMensajeEmpleado("+523312840590", "Ana López", "https://wa.me/15556428542?text=ALTA%20ABC");
  assert.ok(url.startsWith("https://wa.me/523312840590?text="));
  const texto = decodeURIComponent(url.split("?text=")[1]);
  assert.ok(texto.startsWith("Hola Ana,"));
  assert.ok(texto.includes("https://wa.me/15556428542?text=ALTA%20ABC"));
});

test("roles: qué ve cada quien", () => {
  assert.deepEqual(rolesAsignables("admin"), ["supervisor", "consulta"]);
  assert.deepEqual(rolesAsignables("supervisor"), []);
  assert.equal(puedeGestionarRol("dueno", "dueno"), true);
  assert.equal(puedeGestionarRol("admin", "admin"), false);
  assert.equal(puedeGestionarRol("admin", "consulta"), true);
});
