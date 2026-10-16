// Generación de códigos de invitación y del enlace de WhatsApp. Lógica pura, con pruebas.

// 32 símbolos, sin 0, 1, I ni O. Debe coincidir con PATRON_CODIGO de logic.ts.
// 256 es múltiplo de 32, así que usar (byte & 31) no sesga la distribución.
export const ALFABETO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LONGITUD_CODIGO = 8;
export const VIGENCIA_HORAS = 72;

export function generarCodigo(longitud: number = LONGITUD_CODIGO): string {
  const bytes = crypto.getRandomValues(new Uint8Array(longitud));
  let codigo = "";
  for (const b of bytes) codigo += ALFABETO_CODIGO[b & 31];
  return codigo;
}

/** Enlace que abre WhatsApp con el mensaje "ALTA CODIGO" listo para enviar. */
export function enlaceWhatsapp(numeroVisible: string, codigo: string): string {
  const digitos = numeroVisible.replace(/\D/g, "");
  if (digitos.length < 8) throw new Error("número de WhatsApp inválido");
  return `https://wa.me/${digitos}?text=${encodeURIComponent(`ALTA ${codigo}`)}`;
}

export function expiraEn(ahora: Date, horas: number = VIGENCIA_HORAS): Date {
  return new Date(ahora.getTime() + horas * 3_600_000);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function esUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}
