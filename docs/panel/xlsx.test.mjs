import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { crearXlsx, crearZip } from "./xlsx.js";

test("el zip tiene la firma correcta", () => {
  const zip = crearZip([["a.txt", "hola"], ["b/c.txt", "mundo"]]);
  assert.equal(zip[0], 0x50); assert.equal(zip[1], 0x4b);
});

test("el xlsx escapa el XML, no interpreta fórmulas y declara las hojas", () => {
  const tablas = [{ nombre: "Hoja <1>", columnas: [["Nombre", "texto", 20], ["Valor", "numero", 10]], filas: [["=SUMA(1)&\"x\" <b>", 2.5], ["Ñandú", ""]] }];
  const texto = Buffer.from(crearXlsx(tablas)).toString("utf8");
  assert.ok(texto.includes("[Content_Types].xml") && texto.includes("xl/worksheets/sheet1.xml"));
  assert.ok(texto.includes("&lt;b&gt;") && !texto.includes("<b>x"));
  assert.ok(texto.includes('name="Hoja &lt;1&gt;"'));
  assert.ok(texto.includes("<v>2.5</v>"));
  assert.ok(texto.includes('t="inlineStr"'), "los textos van como cadenas, nunca como fórmulas");
  if (process.env.RC_XLSX_SALIDA) writeFileSync(process.env.RC_XLSX_SALIDA, crearXlsx(tablas));
});
