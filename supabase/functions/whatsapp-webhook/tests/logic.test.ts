// Ejecutar: node --test supabase/functions/whatsapp-webhook/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  calcularSenales,
  extraerCodigoInvitacion,
  extraerMensajes,
  firmaValida,
  interpretarBoton,
  interpretarTexto,
  resolverTipoPausa,
  secuenciaValida,
  selfieRequerida,
  sha256Hex,
  tipoUbicacion,
  ultimos10,
} from "../lib/logic.ts";

test("firma válida, inválida y ausente", async () => {
  const cuerpo = '{"hola":"mundo"}';
  const buena = "sha256=" + createHmac("sha256", "secreto").update(cuerpo).digest("hex");
  assert.equal(await firmaValida(cuerpo, buena, "secreto"), true);
  assert.equal(await firmaValida(cuerpo, buena, "otro"), false);
  assert.equal(await firmaValida(cuerpo + " ", buena, "secreto"), false);
  assert.equal(await firmaValida(cuerpo, null, "secreto"), false);
  assert.equal(await firmaValida(cuerpo, "sha256=abc", "secreto"), false);
  assert.equal(await firmaValida(cuerpo, buena.replace("sha256=", ""), "secreto"), false);
  assert.equal(await firmaValida(cuerpo, buena, ""), false);
});

test("sha256Hex coincide con node", async () => {
  const esperado = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
  assert.equal(await sha256Hex("hello world"), esperado);
  assert.equal(await sha256Hex(new TextEncoder().encode("hello world")), esperado);
});

const payload = (mensajes: unknown[]) => ({
  entry: [{ changes: [{ value: { metadata: { phone_number_id: "PN1" }, messages: mensajes } }] }],
});

test("extrae texto, ubicación, imagen y botón", () => {
  const ms = extraerMensajes(payload([
    { id: "w1", from: "5215511111111", timestamp: "1760000000", type: "text", text: { body: "E" } },
    { id: "w2", from: "5215511111111", type: "location", location: { latitude: 19.43, longitude: -99.13 } },
    { id: "w3", from: "5215511111111", type: "image", image: { id: "M1", mime_type: "image/jpeg" } },
    { id: "w4", from: "5215511111111", type: "interactive", interactive: { button_reply: { id: "reg_entrada" } } },
    { id: "w5", from: "5215511111111", type: "audio" },
  ]));
  assert.deepEqual(ms.map((m) => m.tipo), ["text", "location", "image", "button", "otro"]);
  assert.equal(ms[0].texto, "E");
  assert.equal(ms[0].ts?.getTime(), 1760000000000);
  assert.equal(ms[1].ubicacion?.lat, 19.43);
  assert.equal(ms[2].imagen?.id, "M1");
  assert.equal(ms[3].botonId, "reg_entrada");
  assert.ok(ms.every((m) => m.phoneNumberId === "PN1"));
});

test("ignora estados y payloads incompletos", () => {
  assert.deepEqual(extraerMensajes({}), []);
  assert.deepEqual(extraerMensajes(null), []);
  assert.deepEqual(extraerMensajes({ entry: [{ changes: [{ value: { statuses: [{ id: "x" }] } }] }] }), []);
  const sinNumero = { entry: [{ changes: [{ value: { messages: [{ id: "a", from: "1", type: "text", text: { body: "E" } }] } }] }] };
  assert.deepEqual(extraerMensajes(sinNumero), []);
  const ubicacionRota = extraerMensajes(payload([{ id: "z", from: "1", type: "location", location: { latitude: "x", longitude: 1 } }]));
  assert.equal(ubicacionRota[0].tipo, "otro");
});

test("comandos de texto y botones", () => {
  assert.deepEqual(interpretarTexto(" E "), { accion: "registrar", tipo: "entrada" });
  assert.deepEqual(interpretarTexto("Entrada"), { accion: "registrar", tipo: "entrada" });
  assert.deepEqual(interpretarTexto("SALIDA"), { accion: "registrar", tipo: "salida" });
  assert.deepEqual(interpretarTexto("Llegué"), { accion: "registrar", tipo: "entrada" });
  assert.deepEqual(interpretarTexto("Comida"), { accion: "registrar", tipo: "pausa" });
  assert.deepEqual(interpretarTexto("Sí acepto"), { accion: "acepto" });
  assert.deepEqual(interpretarTexto("no acepto"), { accion: "no_acepto" });
  assert.deepEqual(interpretarTexto("hola buenas"), { accion: "menu" });
  assert.deepEqual(interpretarBoton("reg_salida"), { accion: "registrar", tipo: "salida" });
  assert.equal(interpretarBoton("desconocido"), null);
});

test("pausas y secuencia", () => {
  assert.equal(resolverTipoPausa(null), "pausa_inicio");
  assert.equal(resolverTipoPausa("entrada"), "pausa_inicio");
  assert.equal(resolverTipoPausa("pausa_inicio"), "pausa_fin");
  assert.equal(secuenciaValida(null, "entrada"), true);
  assert.equal(secuenciaValida(null, "salida"), false);
  assert.equal(secuenciaValida("entrada", "entrada"), false);
  assert.equal(secuenciaValida("entrada", "salida"), true);
  assert.equal(secuenciaValida("pausa_inicio", "salida"), false);
  assert.equal(secuenciaValida("salida", "entrada"), true);
});

test("selfie requerida hereda empleado, sede, empresa", () => {
  assert.equal(selfieRequerida(null, null, true), true);
  assert.equal(selfieRequerida(null, false, true), false);
  assert.equal(selfieRequerida(true, false, false), true);
  assert.equal(selfieRequerida(false, true, true), false);
});

test("código de invitación", () => {
  assert.equal(extraerCodigoInvitacion("ALTA K7M2Q9XA"), "K7M2Q9XA");
  assert.equal(extraerCodigoInvitacion("hola k7m2q9xa gracias"), "K7M2Q9XA");
  assert.equal(extraerCodigoInvitacion("entrada"), null);
  assert.equal(extraerCodigoInvitacion("ALTA 1234567"), null);
  assert.equal(extraerCodigoInvitacion("OOOO1111"), null);
  assert.equal(ultimos10("+52 1 55 1111 1111"), "5511111111");
  assert.equal(ultimos10("5215511111111"), "5511111111");
});

test("tipo de ubicación", () => {
  assert.equal(tipoUbicacion({}), "actual");
  assert.equal(tipoUbicacion({ nombre: "Oficina" }), "elegida");
  assert.equal(tipoUbicacion({ direccion: "Calle 1" }), "elegida");
});

const base = {
  ultimoTipo: null,
  tipoNuevo: "entrada" as const,
  ubicacion: { lat: 19.4326, lng: -99.1332 },
  ubicacionesPrevias: [],
  fotoRepetida: false,
  vinculadoAt: new Date("2026-01-01T00:00:00Z"),
  tuvoVinculoPrevio: false,
  tsWhatsapp: new Date("2026-10-16T08:00:00Z"),
  ahora: new Date("2026-10-16T08:00:10Z"),
};

test("sin anomalías no hay señales", () => {
  assert.deepEqual(calcularSenales(base), []);
});

test("señales de riesgo", () => {
  assert.deepEqual(calcularSenales({ ...base, ultimoTipo: "entrada" }), ["secuencia_inusual"]);
  assert.deepEqual(
    calcularSenales({ ...base, ubicacion: { lat: 19.4326, lng: -99.1332, nombre: "Oficina" } }),
    ["ubicacion_elegida"],
  );
  const misma = { lat: 19.432601, lng: -99.133199 };
  assert.deepEqual(calcularSenales({ ...base, ubicacionesPrevias: [misma, misma] }), ["ubicacion_repetida"]);
  assert.deepEqual(calcularSenales({ ...base, ubicacionesPrevias: [misma] }), []);
  assert.deepEqual(
    calcularSenales({ ...base, ubicacionesPrevias: [{ lat: 19.5, lng: -99.1 }, misma, { lat: 19.6, lng: -99.2 }] }),
    [],
  );
  assert.deepEqual(calcularSenales({ ...base, fotoRepetida: true }), ["foto_repetida"]);
  assert.deepEqual(
    calcularSenales({ ...base, tuvoVinculoPrevio: true, vinculadoAt: new Date("2026-10-14T00:00:00Z") }),
    ["cambio_numero_reciente"],
  );
  assert.deepEqual(
    calcularSenales({ ...base, tuvoVinculoPrevio: true, vinculadoAt: new Date("2026-09-01T00:00:00Z") }),
    [],
  );
  assert.deepEqual(
    calcularSenales({ ...base, tsWhatsapp: new Date("2026-10-16T07:50:00Z") }),
    ["hora_desfasada"],
  );
  assert.deepEqual(calcularSenales({ ...base, tsWhatsapp: null }), []);
});
