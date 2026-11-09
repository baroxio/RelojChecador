// Escritor de libros de Excel (.xlsx) sin dependencias. Sin DOM ni red: se prueba con node --test docs/panel/xlsx.test.mjs

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
