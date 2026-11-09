// Reporte de asistencia por periodo y exportación a Excel (.xlsx). Sin DOM ni red: se prueba con
// node --test docs/panel/reportes.test.mjs
import { aUTCdesdeLocal, fechaLocal, horaLocal, horarioDelDia, minutosDeRetardo } from "./logic.js";

export const MAX_DIAS_REPORTE = 62;
const HORAS_TURNO_ABIERTO = 18;

export function sumarDias(fechaStr, n) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function diasEntre(desde, hasta) {
  const dias = [];
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) dias.push(f);
  return dias;
}

/** Errores del rango pedido, o null si es válido. */
export function errorDeRango(desde, hasta) {
  const ok = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f ?? "");
  if (!ok(desde) || !ok(hasta)) return "Elige la fecha de inicio y la de fin.";
  if (hasta < desde) return "La fecha de fin no puede ser anterior a la de inicio.";
  if (diasEntre(desde, hasta).length > MAX_DIAS_REPORTE) return `El periodo no puede pasar de ${MAX_DIAS_REPORTE} días.`;
  return null;
}

/** Periodos rápidos a partir de la fecha de hoy (semana de lunes a domingo). */
export function periodosRapidos(hoy) {
  const [y, m] = hoy.split("-").map(Number);
  const lunes = sumarDias(hoy, -((new Date(Date.UTC(y, m - 1, Number(hoy.slice(8)))).getUTCDay() + 6) % 7));
  const primeroMes = `${hoy.slice(0, 8)}01`;
  const finMesPasado = sumarDias(primeroMes, -1);
  return {
    semana: { etiqueta: "Esta semana", desde: lunes, hasta: hoy },
    semana_pasada: { etiqueta: "Semana pasada", desde: sumarDias(lunes, -7), hasta: sumarDias(lunes, -1) },
    mes: { etiqueta: "Este mes", desde: primeroMes, hasta: hoy },
    mes_pasado: { etiqueta: "Mes pasado", desde: `${finMesPasado.slice(0, 8)}01`, hasta: finMesPasado },
  };
}

/** Ventana UTC [desde, hasta) que hay que consultar: un día de margen por los turnos que cruzan la medianoche. */
export function ventanaDeConsulta(desde, hasta, tz) {
  return {
    inicio: aUTCdesdeLocal(sumarDias(desde, -1), "00:00", tz).toISOString(),
    fin: aUTCdesdeLocal(sumarDias(hasta, 2), "00:00", tz).toISOString(),
  };
}

const redondear = (n) => Math.round(n * 100) / 100;

/** Jornadas (entrada a salida) de un empleado a partir de sus registros ordenados. */
function armarJornadas(registros, tz, ahora) {
  const jornadas = [];
  let abierta = null;
  const cerrar = (salida) => {
    if (salida) {
      if (abierta.pausaDesde) abierta.pausaMs += salida.instante - abierta.pausaDesde;
      abierta.salida = salida.instante;
      abierta.corregido ||= salida.corregido;
      abierta.senales = [...new Set([...abierta.senales, ...salida.senales])];
    }
    jornadas.push(abierta);
    abierta = null;
  };
  for (const r of registros) {
    if (r.tipo === "entrada") {
      if (abierta) cerrar(null);
      abierta = { entrada: r.instante, salida: null, pausaMs: 0, pausaDesde: null, corregido: r.corregido, senales: r.senales };
    } else if (r.tipo === "pausa_inicio" && abierta && !abierta.pausaDesde) {
      abierta.pausaDesde = r.instante;
      abierta.corregido ||= r.corregido;
    } else if (r.tipo === "pausa_fin" && abierta?.pausaDesde) {
      abierta.pausaMs += r.instante - abierta.pausaDesde;
      abierta.pausaDesde = null;
      abierta.corregido ||= r.corregido;
    } else if (r.tipo === "salida") {
      if (abierta) cerrar(r);
      else jornadas.push({ entrada: null, salida: r.instante, pausaMs: 0, corregido: r.corregido, senales: r.senales });
    }
  }
  if (abierta) cerrar(null);
  for (const j of jornadas) j.enCurso = !j.salida && j.entrada && ahora - j.entrada < HORAS_TURNO_ABIERTO * 3600_000;
  return jornadas;
}

/**
 * Reporte de asistencia. Devuelve { detalle, resumen }.
 *  empleados: {id, nombre, estado, sede_id}; registros: filas de registros_efectivos;
 *  desde/hasta: 'YYYY-MM-DD' (hora local de cada sede); datos: horarios, horarioDias, empleadoHorarios.
 * Una jornada pertenece al día local de su entrada. Una falta es un día laboral ya terminado sin entrada.
 */
export function reporteAsistencia({ empleados, registros, desde, hasta, tzPorSede, datos = {}, ahora = new Date(), nombreSede = () => "" }) {
  const porEmpleado = new Map();
  for (const r of registros) {
    if (!porEmpleado.has(r.empleado_id)) porEmpleado.set(r.empleado_id, []);
    porEmpleado.get(r.empleado_id).push({
      tipo: r.tipo, instante: new Date(r.hora_efectiva), corregido: !!r.corregido, senales: r.senales ?? [],
    });
  }
  const dias = diasEntre(desde, hasta);
  const detalle = [];
  const resumen = [];

  for (const emp of [...empleados].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))) {
    if (emp.estado === "invitado") continue;
    const tz = tzPorSede[emp.sede_id] ?? "America/Mexico_City";
    const hoy = fechaLocal(ahora, tz);
    const propios = (porEmpleado.get(emp.id) ?? []).sort((a, b) => a.instante - b.instante);
    const jornadas = armarJornadas(propios, tz, ahora);
    const filas = [];
    const conEntrada = new Set();

    for (const j of jornadas) {
      const base = j.entrada ?? j.salida;
      const fecha = fechaLocal(base, tz);
      if (fecha < desde || fecha > hasta) continue;
      const horario = horarioDelDia(emp.id, fecha, datos);
      const entrada = j.entrada ? horaLocal(j.entrada, tz) : null;
      const retardo = entrada ? minutosDeRetardo(entrada, horario) : 0;
      const minutos = j.entrada && j.salida ? Math.max(0, Math.round((j.salida - j.entrada - j.pausaMs) / 60000)) : 0;
      let situacion;
      if (!j.entrada) situacion = "Sin entrada";
      else if (!j.salida) situacion = j.enCurso ? "En turno" : "Sin salida";
      else situacion = retardo > 0 ? "Retardo" : "Completa";
      if (j.entrada) conEntrada.add(fecha);
      filas.push({
        fecha, empleado: emp.nombre, sede: nombreSede(emp.sede_id),
        entrada, salida: j.salida ? horaLocal(j.salida, tz) : null,
        pausa_min: Math.round(j.pausaMs / 60000), minutos, retardo_min: retardo, situacion,
        corregido: j.corregido, registro_diferido: j.senales.includes("registro_diferido"),
      });
    }

    let faltas = 0;
    if (emp.estado === "activo") {
      for (const fecha of dias) {
        if (fecha >= hoy || conEntrada.has(fecha)) continue; // el día de hoy aún no termina
        if (!horarioDelDia(emp.id, fecha, datos)?.laboral) continue;
        faltas += 1;
        filas.push({
          fecha, empleado: emp.nombre, sede: nombreSede(emp.sede_id), entrada: null, salida: null,
          pausa_min: 0, minutos: 0, retardo_min: 0, situacion: "Falta", corregido: false, registro_diferido: false,
        });
      }
    }
    filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.entrada ?? "").localeCompare(b.entrada ?? ""));
    detalle.push(...filas);

    const conRetardo = filas.filter((f) => f.retardo_min > 0);
    resumen.push({
      empleado: emp.nombre, sede: nombreSede(emp.sede_id),
      dias_asistidos: conEntrada.size, faltas,
      retardos: conRetardo.length, minutos_retardo: conRetardo.reduce((s, f) => s + f.retardo_min, 0),
      sin_salida: filas.filter((f) => f.situacion === "Sin salida").length,
      horas: redondear(filas.reduce((s, f) => s + f.minutos, 0) / 60),
    });
  }
  detalle.sort((a, b) => a.empleado.localeCompare(b.empleado, "es") || a.fecha.localeCompare(b.fecha) || (a.entrada ?? "").localeCompare(b.entrada ?? ""));
  return { detalle, resumen };
}

const fechaCorta = (f) => `${f.slice(8)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

/** Las dos tablas que se imprimen y se exportan: columnas con tipo y filas de valores. */
export function tablasDelReporte({ detalle, resumen }) {
  return {
    resumen: {
      nombre: "Resumen",
      columnas: [
        ["Empleado", "texto", 28], ["Sede", "texto", 20], ["Días con asistencia", "numero", 12], ["Faltas", "numero", 8],
        ["Retardos", "numero", 10], ["Minutos de retardo", "numero", 12], ["Jornadas sin salida", "numero", 12], ["Horas trabajadas", "numero", 12],
      ],
      filas: resumen.map((r) => [r.empleado, r.sede, r.dias_asistidos, r.faltas, r.retardos, r.minutos_retardo, r.sin_salida, r.horas]),
    },
    detalle: {
      nombre: "Detalle",
      columnas: [
        ["Fecha", "texto", 12], ["Empleado", "texto", 28], ["Sede", "texto", 20], ["Entrada", "texto", 9], ["Salida", "texto", 9],
        ["Pausa (min)", "numero", 11], ["Horas trabajadas", "numero", 12], ["Retardo (min)", "numero", 12], ["Situación", "texto", 14], ["Observaciones", "texto", 34],
      ],
      filas: detalle.map((f) => [
        fechaCorta(f.fecha), f.empleado, f.sede, f.entrada ?? "", f.salida ?? "", f.pausa_min, redondear(f.minutos / 60), f.retardo_min, f.situacion,
        [f.corregido && "Hora corregida", f.registro_diferido && "Registro sin internet"].filter(Boolean).join("; "),
      ]),
    },
  };
}

export function nombreDeArchivo(desde, hasta, extension) {
  return `asistencia_${desde}_a_${hasta}.${extension}`;
}

// --- XLSX sin dependencias ------------------------------------------------

const enc = new TextEncoder();
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP sin compresión (método "store"): suficiente para un .xlsx y sin código de terceros. */
export function crearZip(archivos) {
  const locales = [];
  const centrales = [];
  let posicion = 0;
  for (const [nombre, contenido] of archivos) {
    const n = enc.encode(nombre);
    const datos = typeof contenido === "string" ? enc.encode(contenido) : contenido;
    const crc = crc32(datos);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8
    local.setUint32(14, crc, true); local.setUint32(18, datos.length, true); local.setUint32(22, datos.length, true);
    local.setUint16(26, n.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true);
    central.setUint32(16, crc, true); central.setUint32(20, datos.length, true); central.setUint32(24, datos.length, true);
    central.setUint16(28, n.length, true); central.setUint32(42, posicion, true);
    locales.push(new Uint8Array(local.buffer), n, datos);
    centrales.push(new Uint8Array(central.buffer), n);
    posicion += 30 + n.length + datos.length;
  }
  const tamCentral = centrales.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, posicion, true);
  const partes = [...locales, ...centrales, new Uint8Array(fin.buffer)];
  const salida = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of partes) { salida.set(p, o); o += p.length; }
  return salida;
}

const escaparXml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function letraColumna(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function xmlHoja({ columnas, filas }) {
  const celda = (valor, i, r, estilo) => {
    const ref = `${letraColumna(i)}${r}`;
    if (typeof valor === "number" && Number.isFinite(valor)) return `<c r="${ref}"${estilo ? ` s="${estilo}"` : ""}><v>${valor}</v></c>`;
    if (valor == null || valor === "") return "";
    return `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ""}><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`;
  };
  const encabezado = `<row r="1">${columnas.map((c, i) => celda(c[0], i, 1, 1)).join("")}</row>`;
  const cuerpo = filas.map((fila, k) => `<row r="${k + 2}">${fila.map((v, i) => celda(v, i, k + 2, 0)).join("")}</row>`).join("");
  const anchos = columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c[2]}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${anchos}</cols><sheetData>${encabezado}${cuerpo}</sheetData></worksheet>`;
}

/** Libro de Excel (bytes) con una hoja por tabla. */
export function crearXlsx(tablas) {
  const nombres = tablas.map((t) => escaparXml(t.nombre));
  const tipos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + tablas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
    + `</Types>`;
  const raiz = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const libro = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`
    + nombres.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + `</sheets></workbook>`;
  const relLibro = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + tablas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
    + `<Relationship Id="rId${tablas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
    + `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
    + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return crearZip([
    ["[Content_Types].xml", tipos], ["_rels/.rels", raiz], ["xl/workbook.xml", libro], ["xl/_rels/workbook.xml.rels", relLibro],
    ["xl/styles.xml", estilos], ...tablas.map((t, i) => [`xl/worksheets/sheet${i + 1}.xml`, xmlHoja(t)]),
  ]);
}
