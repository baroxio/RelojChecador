import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  crearXlsx, crearZip, diasEntre, errorDeRango, nombreDeArchivo, periodosRapidos, reporteAsistencia, sumarDias, tablasDelReporte, ventanaDeConsulta,
} from "./reportes.js";

const TZ = "America/Mexico_City"; // UTC-6 todo el año desde 2022
const utc = (fecha, hhmm) => new Date(`${fecha}T${hhmm}:00-06:00`).toISOString();
const reg = (empleado_id, tipo, fecha, hhmm, extra = {}) => ({ empleado_id, tipo, hora_efectiva: utc(fecha, hhmm), corregido: false, senales: [], ...extra });

// Horario "Oficina": lunes a viernes 09:00-18:00, tolerancia 10 min. 2026-11-02 es lunes.
const datos = {
  horarios: [{ id: "h1", tolerancia_retardo_min: 10 }],
  horarioDias: [1, 2, 3, 4, 5].map((d) => ({ horario_id: "h1", dia_semana: d, hora_entrada: "09:00" })),
  empleadoHorarios: [{ empleado_id: "e1", horario_id: "h1", vigencia: "[2026-01-01,)" }, { empleado_id: "e2", horario_id: "h1", vigencia: "[2026-01-01,)" }],
};
const empleados = [
  { id: "e2", nombre: "Luis Martínez", estado: "activo", sede_id: "s1" },
  { id: "e1", nombre: "Ana López", estado: "activo", sede_id: "s1" },
  { id: "e3", nombre: "Rosa Pérez", estado: "invitado", sede_id: "s1" },
];
const ahora = new Date(utc("2026-11-06", "12:00")); // viernes

test("fechas del periodo", () => {
  assert.equal(sumarDias("2026-02-28", 1), "2026-03-01");
  assert.deepEqual(diasEntre("2026-11-01", "2026-11-03"), ["2026-11-01", "2026-11-02", "2026-11-03"]);
  assert.equal(errorDeRango("2026-11-05", "2026-11-01"), "La fecha de fin no puede ser anterior a la de inicio.");
  assert.match(errorDeRango("2026-01-01", "2026-12-31"), /62 días/);
  assert.equal(errorDeRango("2026-11-01", "2026-11-30"), null);
  assert.match(errorDeRango("", "2026-11-30"), /Elige/);
});

test("periodos rápidos", () => {
  const p = periodosRapidos("2026-11-06"); // viernes
  assert.deepEqual([p.semana.desde, p.semana.hasta], ["2026-11-02", "2026-11-06"]);
  assert.deepEqual([p.semana_pasada.desde, p.semana_pasada.hasta], ["2026-10-26", "2026-11-01"]);
  assert.deepEqual([p.mes.desde, p.mes.hasta], ["2026-11-01", "2026-11-06"]);
  assert.deepEqual([p.mes_pasado.desde, p.mes_pasado.hasta], ["2026-10-01", "2026-10-31"]);
  assert.equal(periodosRapidos("2026-11-01").semana.desde, "2026-10-26"); // domingo
});

test("ventana de consulta con margen", () => {
  const v = ventanaDeConsulta("2026-11-02", "2026-11-03", TZ);
  assert.equal(v.inicio, "2026-11-01T06:00:00.000Z");
  assert.equal(v.fin, "2026-11-05T06:00:00.000Z");
});

test("horas, retardos, faltas y sin salida", () => {
  const registros = [
    reg("e1", "entrada", "2026-11-02", "09:00"), reg("e1", "pausa_inicio", "2026-11-02", "14:00"), reg("e1", "pausa_fin", "2026-11-02", "15:00"), reg("e1", "salida", "2026-11-02", "18:00"),
    reg("e1", "entrada", "2026-11-03", "09:25", { senales: ["registro_diferido"] }), reg("e1", "salida", "2026-11-03", "17:25"),
    reg("e1", "entrada", "2026-11-04", "09:10", { corregido: true }), // dentro de la tolerancia, sin salida y ya pasó
    // e1 no vino el jueves 5 (falta); el viernes 6 todavía no termina
    reg("e2", "entrada", "2026-11-02", "08:55"), reg("e2", "salida", "2026-11-02", "18:05"),
  ];
  const r = reporteAsistencia({ empleados, registros, desde: "2026-11-02", hasta: "2026-11-06", tzPorSede: { s1: TZ }, datos, ahora, nombreSede: () => "Centro" });
  const ana = r.resumen.find((x) => x.empleado === "Ana López");
  assert.deepEqual(ana, { empleado: "Ana López", sede: "Centro", dias_asistidos: 3, faltas: 1, retardos: 1, minutos_retardo: 25, sin_salida: 1, horas: 16 });
  const dia1 = r.detalle.find((f) => f.empleado === "Ana López" && f.fecha === "2026-11-02");
  assert.equal(dia1.minutos, 480); // 9 h menos 1 h de pausa
  assert.equal(dia1.pausa_min, 60);
  assert.equal(dia1.situacion, "Completa");
  const dia2 = r.detalle.find((f) => f.empleado === "Ana López" && f.fecha === "2026-11-03");
  assert.equal(dia2.situacion, "Retardo");
  assert.equal(dia2.registro_diferido, true);
  assert.equal(r.detalle.find((f) => f.fecha === "2026-11-04" && f.empleado === "Ana López").situacion, "Sin salida");
  assert.equal(r.detalle.find((f) => f.fecha === "2026-11-04" && f.empleado === "Ana López").corregido, true);
  assert.equal(r.detalle.find((f) => f.fecha === "2026-11-05" && f.empleado === "Ana López").situacion, "Falta");
  assert.equal(r.detalle.some((f) => f.fecha === "2026-11-06" && f.empleado === "Ana López"), false);
  const luis = r.resumen.find((x) => x.empleado === "Luis Martínez");
  assert.equal(luis.dias_asistidos, 1);
  assert.equal(luis.faltas, 3); // martes, miércoles y jueves
  assert.equal(r.resumen.some((x) => x.empleado === "Rosa Pérez"), false, "los invitados no aparecen");
  assert.deepEqual(r.resumen.map((x) => x.empleado), ["Ana López", "Luis Martínez"]);
});

test("no hay faltas en descanso, sin horario ni para quien ya se dio de baja", () => {
  const baja = [{ id: "e1", nombre: "Ana López", estado: "baja", sede_id: "s1" }, { id: "e9", nombre: "Sin horario", estado: "activo", sede_id: "s1" }];
  const r = reporteAsistencia({ empleados: baja, registros: [], desde: "2026-11-02", hasta: "2026-11-08", tzPorSede: { s1: TZ }, datos, ahora: new Date(utc("2026-11-20", "12:00")) });
  assert.equal(r.detalle.length, 0);
  const activo = reporteAsistencia({ empleados: [{ id: "e1", nombre: "Ana", estado: "activo", sede_id: "s1" }], registros: [], desde: "2026-11-02", hasta: "2026-11-08", tzPorSede: { s1: TZ }, datos, ahora: new Date(utc("2026-11-20", "12:00")) });
  assert.equal(activo.resumen[0].faltas, 5); // lunes a viernes; sábado y domingo son descanso
});

test("turno nocturno: la salida de madrugada cuenta en el día de la entrada", () => {
  const registros = [reg("e1", "entrada", "2026-11-02", "22:00"), reg("e1", "salida", "2026-11-03", "06:00")];
  const r = reporteAsistencia({ empleados: [empleados[1]], registros, desde: "2026-11-02", hasta: "2026-11-03", tzPorSede: { s1: TZ }, datos, ahora });
  const filas = r.detalle.filter((f) => f.situacion !== "Falta");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].fecha, "2026-11-02");
  assert.equal(filas[0].minutos, 480);
});

test("una entrada reciente sin salida está en turno, no incompleta", () => {
  const registros = [reg("e1", "entrada", "2026-11-06", "09:00")];
  const r = reporteAsistencia({ empleados: [empleados[1]], registros, desde: "2026-11-06", hasta: "2026-11-06", tzPorSede: { s1: TZ }, datos, ahora });
  assert.equal(r.detalle[0].situacion, "En turno");
  assert.equal(r.resumen[0].sin_salida, 0);
});

test("tablas del reporte", () => {
  const registros = [reg("e1", "entrada", "2026-11-02", "09:00"), reg("e1", "salida", "2026-11-02", "17:30")];
  const t = tablasDelReporte(reporteAsistencia({ empleados: [empleados[1]], registros, desde: "2026-11-02", hasta: "2026-11-02", tzPorSede: { s1: TZ }, datos, ahora, nombreSede: () => "Centro" }));
  assert.deepEqual(t.detalle.filas[0].slice(0, 9), ["02/11/2026", "Ana López", "Centro", "09:00", "17:30", 0, 8.5, 0, "Completa"]);
  assert.equal(t.resumen.columnas.length, t.resumen.filas[0].length);
  assert.equal(t.detalle.columnas.length, t.detalle.filas[0].length);
  assert.equal(nombreDeArchivo("2026-11-02", "2026-11-06", "xlsx"), "asistencia_2026-11-02_a_2026-11-06.xlsx");
});

test("el zip y el xlsx tienen la estructura correcta", () => {
  const zip = crearZip([["a.txt", "hola"], ["b/c.txt", "mundo"]]);
  assert.equal(zip[0], 0x50); assert.equal(zip[1], 0x4b);
  const tablas = [{ nombre: "Hoja <1>", columnas: [["Nombre", "texto", 20], ["Valor", "numero", 10]], filas: [["=SUMA(1)&\"x\" <b>", 2.5], ["Ñandú", ""]] }];
  const bytes = crearXlsx(tablas);
  const texto = Buffer.from(bytes).toString("utf8");
  assert.ok(texto.includes("[Content_Types].xml") && texto.includes("xl/worksheets/sheet1.xml"));
  assert.ok(texto.includes("&lt;b&gt;") && !texto.includes("<b>x"));
  assert.ok(texto.includes('name="Hoja &lt;1&gt;"'));
  if (process.env.RC_XLSX_SALIDA) {
    const t = tablasDelReporte(reporteAsistencia({ empleados, registros: [reg("e1", "entrada", "2026-11-02", "09:00"), reg("e1", "salida", "2026-11-02", "17:30")], desde: "2026-11-02", hasta: "2026-11-06", tzPorSede: { s1: TZ }, datos, ahora, nombreSede: () => "Centro" }));
    writeFileSync(process.env.RC_XLSX_SALIDA, crearXlsx([t.resumen, t.detalle]));
  }
});
