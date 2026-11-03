// Ejecutar: node --test docs/panel/logic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aUTCdesdeLocal, contarGrupos, diaSemana, enlaceMensajeEmpleado, fechaLocal, formatearDistancia,
  formatearDuracion, formatearTelefono, horaLocal, horarioDelDia, iniciales, minutosDeRetardo,
  normalizarTelefonoMx, parsearVigencia, resumenDelDia, etiquetaSenal, rolesAsignables, puedeGestionarRol,
  parsearCoordenadas, errorDeGeocerca, errorDeHorario, resumenHorario, planearCambioHorario,
  sumarDias, rangoDeFechas, periodoPredefinido, errorDePeriodo, armarJornadas, reporteAsistencia, totalesGenerales,
  validarDatosEmpleado, diferenciasEmpleado, celdaCSV, aCSV, horasDecimales, formatearHoras, filasCSVDetalle, ENCABEZADOS_CSV_DETALLE,
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

test("coordenadas y geocercas", () => {
  assert.deepEqual(parsearCoordenadas("20.6597, -103.3496"), { lat: 20.6597, lng: -103.3496 });
  assert.deepEqual(parsearCoordenadas(" 20.6597 -103.3496 "), { lat: 20.6597, lng: -103.3496 });
  assert.equal(parsearCoordenadas("91, 10"), null);
  assert.equal(parsearCoordenadas("hola"), null);
  assert.equal(errorDeGeocerca({ lat: 20.6, lng: -103.3, radio: 100 }), null);
  assert.match(errorDeGeocerca({ lat: NaN, lng: -103.3, radio: 100 }), /ubicación/);
  assert.match(errorDeGeocerca({ lat: 20.6, lng: -103.3, radio: 5 }), /radio/);
  assert.match(errorDeGeocerca({ lat: 20.6, lng: -103.3, radio: 100.5 }), /radio/);
});

const dia = (n, e = "09:00", s = "18:00", p = 60) => ({ dia_semana: n, hora_entrada: e, hora_salida: s, minutos_pausa: p });

test("validación y resumen de horarios", () => {
  const base = { nombre: "Oficina", tolerancia_retardo_min: 10, tolerancia_salida_min: 0 };
  assert.equal(errorDeHorario({ ...base, dias: [dia(1)] }), null);
  assert.match(errorDeHorario({ ...base, nombre: " ", dias: [dia(1)] }), /nombre/);
  assert.match(errorDeHorario({ ...base, dias: [] }), /al menos un día/);
  assert.match(errorDeHorario({ ...base, dias: [dia(2, "09:00", "09:00")] }), /martes/);
  assert.match(errorDeHorario({ ...base, tolerancia_retardo_min: -1, dias: [dia(1)] }), /tolerancia/);
  assert.equal(errorDeHorario({ ...base, dias: [dia(5, "22:00", "06:00")] }), null); // turno nocturno
  assert.equal(resumenHorario([1, 2, 3, 4, 5].map((n) => dia(n))), "Lun–Vie 09:00–18:00");
  assert.equal(resumenHorario([...[1, 2, 3, 4, 5].map((n) => dia(n)), dia(6, "09:00", "14:00")]), "Lun–Vie 09:00–18:00 · Sáb 09:00–14:00");
  assert.equal(resumenHorario([dia(1), dia(3)]), "Lun 09:00–18:00 · Mié 09:00–18:00");
  assert.equal(resumenHorario([dia(0), dia(6)]), "Sáb–Dom 09:00–18:00");
});

test("cambio de horario cierra lo vigente", () => {
  const hoy = "2026-10-19";
  const plan = planearCambioHorario([
    { id: "a", vigencia: "[2026-01-01,)" },
    { id: "b", vigencia: "[2026-10-19,)" },
    { id: "c", vigencia: "[2026-12-01,)" },
    { id: "d", vigencia: "[2025-01-01,2026-01-01)" },
  ], hoy);
  assert.deepEqual(plan, { borrar: ["b", "c"], cerrar: [{ id: "a", desde: "2026-01-01" }] });
});

// --- Reportes ---------------------------------------------------------------

test("fechas y periodos", () => {
  assert.equal(sumarDias("2026-10-31", 1), "2026-11-01");
  assert.equal(sumarDias("2026-03-01", -1), "2026-02-28");
  assert.deepEqual(rangoDeFechas("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  // 2026-11-04 es miércoles
  assert.deepEqual(periodoPredefinido("semana", "2026-11-04"), { desde: "2026-11-02", hasta: "2026-11-04" });
  assert.deepEqual(periodoPredefinido("semana", "2026-11-01"), { desde: "2026-10-26", hasta: "2026-11-01" }); // domingo
  assert.deepEqual(periodoPredefinido("semana_pasada", "2026-11-04"), { desde: "2026-10-26", hasta: "2026-11-01" });
  assert.deepEqual(periodoPredefinido("quincena", "2026-11-04"), { desde: "2026-11-01", hasta: "2026-11-04" });
  assert.deepEqual(periodoPredefinido("quincena", "2026-11-20"), { desde: "2026-11-16", hasta: "2026-11-20" });
  assert.deepEqual(periodoPredefinido("mes", "2026-11-20"), { desde: "2026-11-01", hasta: "2026-11-20" });
  assert.deepEqual(periodoPredefinido("mes_pasado", "2026-01-10"), { desde: "2025-12-01", hasta: "2025-12-31" });
  assert.deepEqual(periodoPredefinido("mes_pasado", "2026-03-10"), { desde: "2026-02-01", hasta: "2026-02-28" });
  assert.equal(periodoPredefinido("otro", "2026-11-04"), null);
  assert.match(errorDePeriodo("2026-11-05", "2026-11-01"), /anterior/);
  assert.match(errorDePeriodo("2026-01-01", "2026-12-31"), /62 días/);
  assert.match(errorDePeriodo("", "2026-11-01"), /Elige/);
  assert.equal(errorDePeriodo("2026-11-01", "2026-11-15"), null);
});

const rg = (tipo, utc, extra = {}) => ({ empleado_id: "e1", tipo, hora_efectiva: utc, senales: [], corregido: false, ...extra });

test("jornadas: horas netas de pausa, turno nocturno y registros sueltos", () => {
  // CDMX es UTC-6 (sin horario de verano desde 2022): 14:00Z = 08:00 local
  const ahora = new Date("2026-11-04T23:00:00Z");
  const { jornadas, sueltos } = armarJornadas([
    rg("entrada", "2026-11-02T14:00:00Z"), rg("pausa_inicio", "2026-11-02T18:00:00Z"),
    rg("pausa_fin", "2026-11-02T18:30:00Z"), rg("salida", "2026-11-03T00:00:00Z"), // 08:00–18:00 con 30 min de pausa
    rg("salida", "2026-11-03T15:00:00Z"),                                        // salida sin entrada
    rg("entrada", "2026-11-04T04:00:00Z"), rg("salida", "2026-11-04T12:00:00Z"), // 22:00 → 06:00, empezó el día 3
  ], MX, ahora);
  assert.equal(sueltos.length, 1);
  assert.equal(jornadas.length, 2);
  assert.equal(jornadas[0].fecha, "2026-11-02");
  assert.equal(jornadas[0].minutos, 570);
  assert.equal(jornadas[0].pausaMin, 30);
  assert.equal(jornadas[1].fecha, "2026-11-03");
  assert.equal(jornadas[1].minutos, 480);
});

test("jornadas: una entrada sin salida reciente está en curso y una vieja queda abierta", () => {
  const ahora = new Date("2026-11-04T20:00:00Z");
  const a = armarJornadas([rg("entrada", "2026-11-04T14:00:00Z")], MX, ahora).jornadas[0];
  assert.equal(a.enCurso, true); assert.equal(a.abierta, false); assert.equal(a.minutos, null);
  const b = armarJornadas([rg("entrada", "2026-11-02T14:00:00Z")], MX, ahora).jornadas[0];
  assert.equal(b.enCurso, false); assert.equal(b.abierta, true);
  // dos entradas seguidas: la primera queda abierta
  const c = armarJornadas([rg("entrada", "2026-11-03T14:00:00Z"), rg("entrada", "2026-11-03T15:00:00Z"), rg("salida", "2026-11-03T23:00:00Z")], MX, ahora).jornadas;
  assert.equal(c.length, 2); assert.equal(c[0].abierta, true); assert.equal(c[1].minutos, 480);
});

const datosHorario = {
  horarios: [{ id: "h1", tolerancia_retardo_min: 10 }],
  horarioDias: [1, 2, 3, 4, 5].map((d) => ({ horario_id: "h1", dia_semana: d, hora_entrada: "09:00:00" })),
  empleadoHorarios: [{ empleado_id: "e1", horario_id: "h1", vigencia: "[2026-01-01,)" }],
};
const ana = { id: "e1", nombre: "Ana López", sede_id: "s1", estado: "activo", fecha_ingreso: "2026-01-01", num_empleado: "7" };
const tzs = { s1: MX };

test("reporte: asistencia, retardo, falta, descanso y horas", () => {
  // Semana lun 2 nov – vie 6 nov 2026 (hoy: viernes 6, 20:00 local)
  const ahora = new Date("2026-11-07T02:00:00Z");
  const r = reporteAsistencia({
    empleados: [ana], desde: "2026-11-02", hasta: "2026-11-08", ahora, tzPorSede: tzs, datos: datosHorario,
    registros: [
      rg("entrada", "2026-11-02T15:00:00Z"), rg("salida", "2026-11-03T00:00:00Z"),           // lun 09:00–18:00
      rg("entrada", "2026-11-03T15:25:00Z", { senales: ["foto_repetida"] }), rg("salida", "2026-11-04T00:00:00Z"), // mar 09:25 retardo
      // miércoles: falta
      rg("entrada", "2026-11-05T15:00:00Z"), rg("pausa_inicio", "2026-11-05T19:00:00Z"), rg("pausa_fin", "2026-11-05T20:00:00Z"), rg("salida", "2026-11-06T00:00:00Z", { corregido: true }), // jue, 1 h de pausa
      // viernes: sin registros, ya pasó la hora
    ],
  });
  const f = r.filas[0];
  assert.deepEqual(f.dias.map((d) => d.estado), ["asistio", "retardo", "falta", "asistio", "falta", "descanso", "descanso"]);
  assert.equal(f.dias[1].retardoMin, 25);
  assert.equal(f.dias[0].minutos, 540);
  assert.equal(f.dias[3].minutos, 480); // 9 h menos 1 h de pausa
  assert.equal(f.dias[3].corregido, true);
  assert.deepEqual(f.dias[1].senales, ["foto_repetida"]);
  assert.equal(f.totales.faltas, 2);
  assert.equal(f.totales.retardos, 1);
  assert.equal(f.totales.minutosRetardo, 25);
  assert.equal(f.totales.asistencias, 3);
  assert.equal(f.totales.minutos, 540 + 515 + 480);
  assert.deepEqual(totalesGenerales(r.filas), { empleados: 1, asistencias: 3, faltas: 2, retardos: 1, minutos: 1535, sinSalida: 0 });
});

test("reporte: hoy no es falta hasta una hora después de la entrada, y el futuro queda pendiente", () => {
  const casos = [["2026-11-04T15:30:00Z", "pendiente"], ["2026-11-04T16:30:00Z", "falta"]]; // 09:30 y 10:30 locales
  for (const [ahoraIso, esperado] of casos) {
    const r = reporteAsistencia({ empleados: [ana], registros: [], desde: "2026-11-04", hasta: "2026-11-05", ahora: new Date(ahoraIso), tzPorSede: tzs, datos: datosHorario });
    assert.equal(r.filas[0].dias[0].estado, esperado);
    assert.equal(r.filas[0].dias[1].estado, "pendiente");
  }
});

test("reporte: no cuenta faltas antes del ingreso ni después de la baja, ni sin horario", () => {
  const ahora = new Date("2026-11-07T02:00:00Z");
  const nuevo = { ...ana, fecha_ingreso: "2026-11-04", fecha_baja: "2026-11-06" };
  const r = reporteAsistencia({ empleados: [nuevo], registros: [], desde: "2026-11-02", hasta: "2026-11-06", ahora, tzPorSede: tzs, datos: datosHorario });
  assert.deepEqual(r.filas[0].dias.map((d) => d.estado), ["sin_alta", "sin_alta", "falta", "falta", "sin_alta"]);
  const sinHorario = reporteAsistencia({ empleados: [ana], registros: [], desde: "2026-11-02", hasta: "2026-11-03", ahora, tzPorSede: tzs, datos: {} });
  assert.deepEqual(sinHorario.filas[0].dias.map((d) => d.estado), ["sin_horario", "sin_horario"]);
  assert.equal(sinHorario.filas[0].totales.faltas, 0);
});

test("reporte: descanso trabajado, sin salida, invitados y bajas sin registros", () => {
  const ahora = new Date("2026-11-10T02:00:00Z");
  const r = reporteAsistencia({
    empleados: [ana, { ...ana, id: "e2", nombre: "Beto", estado: "invitado" }, { ...ana, id: "e3", nombre: "Carla", estado: "baja", fecha_baja: "2026-10-01" }],
    desde: "2026-11-02", hasta: "2026-11-08", ahora, tzPorSede: tzs, datos: datosHorario,
    registros: [
      rg("entrada", "2026-11-07T15:00:00Z"), rg("salida", "2026-11-07T20:00:00Z"), // sábado
      rg("entrada", "2026-11-03T15:00:00Z"),                                      // martes sin salida (ya viejo)
    ],
  });
  assert.equal(r.filas.length, 1); // el invitado y la baja sin registros no aparecen
  const f = r.filas[0];
  assert.equal(f.dias[5].estado, "descanso_trabajado");
  assert.equal(f.dias[1].estado, "incompleto");
  assert.equal(f.totales.sinSalida, 1);
  assert.equal(f.totales.descansosTrabajados, 1);
});

test("reporte: turno nocturno cuenta en el día de la entrada", () => {
  const nocturno = { ...ana, id: "e1" };
  const ahora = new Date("2026-11-10T02:00:00Z");
  const r = reporteAsistencia({
    empleados: [nocturno], desde: "2026-11-02", hasta: "2026-11-03", ahora, tzPorSede: tzs, datos: datosHorario,
    registros: [rg("entrada", "2026-11-03T04:00:00Z"), rg("salida", "2026-11-03T12:00:00Z")], // 22:00 lun → 06:00 mar
  });
  assert.equal(r.filas[0].dias[0].minutos, 480);
  assert.equal(r.filas[0].dias[0].salida, "06:00");
  assert.equal(r.filas[0].dias[1].minutos, 0);
});

test("CSV: comillas, BOM y protección contra fórmulas", () => {
  assert.equal(celdaCSV("Ana, López"), '"Ana, López"');
  assert.equal(celdaCSV('di "hola"'), '"di ""hola"""');
  assert.equal(celdaCSV("=SUMA(A1)"), "'=SUMA(A1)");
  assert.equal(celdaCSV("+5255"), "'+5255");
  assert.equal(celdaCSV("-3"), "-3");
  assert.equal(celdaCSV(null), "");
  assert.equal(celdaCSV(0), "0");
  const csv = aCSV(["a", "b"], [["x", "y,z"]]);
  assert.ok(csv.startsWith("\ufeffa,b\r\n"));
  assert.ok(csv.endsWith('x,"y,z"\r\n'));
  assert.equal(horasDecimales(90), "1.50");
  assert.equal(formatearHoras(0), "0 h");
  assert.equal(formatearHoras(125), "2 h 05 min");
});

test("CSV de detalle: una fila por día salvo los pendientes", () => {
  const ahora = new Date("2026-11-04T20:00:00Z");
  const r = reporteAsistencia({ empleados: [ana], desde: "2026-11-04", hasta: "2026-11-05", ahora, tzPorSede: tzs, datos: datosHorario,
    registros: [rg("entrada", "2026-11-04T15:20:00Z", { senales: ["foto_repetida", "ubicacion_elegida"] }), rg("salida", "2026-11-05T00:00:00Z")] });
  const filas = filasCSVDetalle(r, () => "Centro");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].length, ENCABEZADOS_CSV_DETALLE.length);
  assert.deepEqual(filas[0].slice(0, 8), ["2026-11-04", "7", "Ana López", "Centro", "Retardo", "09:20", "18:00", 20]);
  assert.match(filas[0][10], /idéntica.*; .*mapa/);
});

// --- Edición de empleados ---------------------------------------------------

test("empleado: validación y normalización del formulario", () => {
  const ok = validarDatosEmpleado({ nombre: "  Ana   López ", telefono: "33 1234 5678", sede_id: "s1", num_empleado: " 12 ", fecha_ingreso: "2026-03-01" });
  assert.deepEqual(ok.errores, {});
  assert.deepEqual(ok.valores, { nombre: "Ana López", telefono: "+523312345678", sede_id: "s1", num_empleado: "12", fecha_ingreso: "2026-03-01" });
  const vacios = validarDatosEmpleado({ nombre: "", telefono: "123", sede_id: "", num_empleado: "", fecha_ingreso: "" });
  assert.deepEqual(Object.keys(vacios.errores).sort(), ["nombre", "sede", "telefono"]);
  assert.equal(vacios.valores.num_empleado, null);
  assert.equal(vacios.valores.fecha_ingreso, null);
  assert.match(validarDatosEmpleado({ nombre: "Ana", telefono: "3312345678", sede_id: "s1", fecha_ingreso: "2026-13-45" }).errores.fecha, /no es válida/);
  assert.match(validarDatosEmpleado({ nombre: "Ana", telefono: "3312345678", sede_id: "s1", fecha_ingreso: "01/03/2026" }).errores.fecha, /no es válida/);
});

test("empleado: solo se actualiza lo que cambió", () => {
  const actual = { nombre: "Ana López", telefono: "+523312345678", sede_id: "s1", num_empleado: null, fecha_ingreso: "2026-03-01" };
  const mismo = validarDatosEmpleado({ nombre: "Ana López", telefono: "33 1234 5678", sede_id: "s1", num_empleado: "", fecha_ingreso: "2026-03-01" }).valores;
  assert.deepEqual(diferenciasEmpleado(actual, mismo), {});
  const cambio = validarDatosEmpleado({ nombre: "Ana L. Ruiz", telefono: "33 9999 0000", sede_id: "s2", num_empleado: "45", fecha_ingreso: "" }).valores;
  assert.deepEqual(diferenciasEmpleado(actual, cambio), { nombre: "Ana L. Ruiz", telefono: "+523399990000", sede_id: "s2", num_empleado: "45", fecha_ingreso: null });
});
