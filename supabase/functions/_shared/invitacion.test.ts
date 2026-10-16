// Ejecutar: node --test supabase/functions/_shared/
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALFABETO_CODIGO, enlaceWhatsapp, esUuid, expiraEn, generarCodigo } from "./invitacion.ts";
import { extraerCodigoInvitacion } from "./logic.ts";

test("el alfabeto tiene 32 símbolos únicos y sin caracteres ambiguos", () => {
  assert.equal(ALFABETO_CODIGO.length, 32);
  assert.equal(new Set(ALFABETO_CODIGO).size, 32);
  for (const prohibido of "01IO") assert.ok(!ALFABETO_CODIGO.includes(prohibido));
});

test("los códigos tienen 8 símbolos del alfabeto y los reconoce el webhook", () => {
  for (let i = 0; i < 2000; i++) {
    const c = generarCodigo();
    assert.equal(c.length, 8);
    assert.ok([...c].every((ch) => ALFABETO_CODIGO.includes(ch)));
    assert.equal(extraerCodigoInvitacion(`ALTA ${c}`), c);
    assert.equal(extraerCodigoInvitacion(`alta ${c.toLowerCase()}`), c);
  }
});

test("los códigos no se repiten y usan todo el alfabeto", () => {
  const vistos = new Set<string>();
  const simbolos = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    const c = generarCodigo();
    vistos.add(c);
    for (const ch of c) simbolos.add(ch);
  }
  assert.equal(vistos.size, 5000);
  assert.equal(simbolos.size, 32);
});

test("enlace de WhatsApp", () => {
  assert.equal(
    enlaceWhatsapp("+52 55 1234 5678", "K7M2Q9XA"),
    "https://wa.me/525512345678?text=ALTA%20K7M2Q9XA",
  );
  assert.throws(() => enlaceWhatsapp("123", "K7M2Q9XA"));
  assert.throws(() => enlaceWhatsapp("", "K7M2Q9XA"));
});

test("vigencia", () => {
  const ahora = new Date("2026-10-16T00:00:00Z");
  assert.equal(expiraEn(ahora).toISOString(), "2026-10-19T00:00:00.000Z");
  assert.equal(expiraEn(ahora, 1).toISOString(), "2026-10-16T01:00:00.000Z");
});

test("validación de uuid", () => {
  assert.equal(esUuid("123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(esUuid("123e4567"), false);
  assert.equal(esUuid(null), false);
  assert.equal(esUuid("123e4567-e89b-12d3-a456-42661417400g"), false);
});
