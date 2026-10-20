// Lógica pura del webhook (sin red ni base de datos): se prueba con node --test.

export type TipoRegistro = "entrada" | "salida" | "pausa_inicio" | "pausa_fin";

export type MensajeEntrante = {
  wamid: string;
  de: string; // wa_id del remitente
  phoneNumberId: string; // número de WhatsApp de la plataforma que recibió el mensaje
  ts: Date | null; // hora que reporta Meta
  tipo: "text" | "location" | "image" | "button" | "otro";
  texto?: string;
  botonId?: string;
  ubicacion?: { lat: number; lng: number; nombre?: string; direccion?: string };
  imagen?: { id: string; mime?: string; sha256?: string };
  crudo: unknown;
};

// --- Firma de Meta ---------------------------------------------------------

const enc = new TextEncoder();

export async function sha256Hex(datos: string | Uint8Array): Promise<string> {
  const bytes = typeof datos === "string" ? enc.encode(datos) : datos;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Verifica X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, cuerpo crudo). */
export async function firmaValida(
  cuerpo: string,
  cabecera: string | null,
  secreto: string,
): Promise<boolean> {
  if (!cabecera || !secreto || !cabecera.startsWith("sha256=")) return false;
  const llave = await crypto.subtle.importKey(
    "raw",
    enc.encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", llave, enc.encode(cuerpo)));
  const esperado = [...firma].map((b) => b.toString(16).padStart(2, "0")).join("");
  const recibido = cabecera.slice("sha256=".length).toLowerCase();
  if (recibido.length !== esperado.length) return false;
  let diferencia = 0; // comparación en tiempo constante
  for (let i = 0; i < esperado.length; i++) {
    diferencia |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  }
  return diferencia === 0;
}

// --- Lectura del payload de Meta ------------------------------------------

// deno-lint-ignore no-explicit-any
export function extraerMensajes(payload: any): MensajeEntrante[] {
  const salida: MensajeEntrante[] = [];
  for (const entrada of payload?.entry ?? []) {
    for (const cambio of entrada?.changes ?? []) {
      const valor = cambio?.value;
      const phoneNumberId = valor?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      for (const msg of valor?.messages ?? []) {
        if (!msg?.id || !msg?.from) continue;
        const base = {
          wamid: String(msg.id),
          de: String(msg.from),
          phoneNumberId: String(phoneNumberId),
          ts: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : null,
          crudo: msg,
        };
        if (msg.type === "text") {
          salida.push({ ...base, tipo: "text", texto: String(msg.text?.body ?? "") });
        } else if (msg.type === "location" && msg.location) {
          const lat = Number(msg.location.latitude);
          const lng = Number(msg.location.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            salida.push({
              ...base,
              tipo: "location",
              ubicacion: { lat, lng, nombre: msg.location.name, direccion: msg.location.address },
            });
          } else salida.push({ ...base, tipo: "otro" });
        } else if (msg.type === "image" && msg.image?.id) {
          salida.push({
            ...base,
            tipo: "image",
            imagen: { id: String(msg.image.id), mime: msg.image.mime_type, sha256: msg.image.sha256 },
          });
        } else if (msg.type === "interactive" && msg.interactive?.button_reply?.id) {
          salida.push({ ...base, tipo: "button", botonId: String(msg.interactive.button_reply.id) });
        } else {
          salida.push({ ...base, tipo: "otro" });
        }
      }
    }
  }
  return salida;
}

// --- Comandos --------------------------------------------------------------

export type Comando =
  | { accion: "registrar"; tipo: "entrada" | "salida" | "pausa"; hora?: { h: number; m: number } }
  | { accion: "acepto" }
  | { accion: "no_acepto" }
  | { accion: "menu" };

export const BOTONES = {
  entrada: "reg_entrada",
  salida: "reg_salida",
  pausa: "reg_pausa",
  acepto: "aviso_acepto",
  noAcepto: "aviso_rechazo",
} as const;

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

export function interpretarBoton(id: string): Comando | null {
  switch (id) {
    case BOTONES.entrada: return { accion: "registrar", tipo: "entrada" };
    case BOTONES.salida: return { accion: "registrar", tipo: "salida" };
    case BOTONES.pausa: return { accion: "registrar", tipo: "pausa" };
    case BOTONES.acepto: return { accion: "acepto" };
    case BOTONES.noAcepto: return { accion: "no_acepto" };
    default: return null;
  }
}

const PALABRAS_ENTRADA = ["e", "entrada", "entro", "llegue", "checar entrada"];
const PALABRAS_SALIDA = ["s", "salida", "salgo", "me voy", "checar salida"];
const PALABRAS_PAUSA = ["p", "pausa", "comida", "r", "regreso", "reanudar"];

function tipoDePalabra(t: string): "entrada" | "salida" | "pausa" | null {
  if (PALABRAS_ENTRADA.includes(t)) return "entrada";
  if (PALABRAS_SALIDA.includes(t)) return "salida";
  if (PALABRAS_PAUSA.includes(t)) return "pausa";
  return null;
}

/**
 * "entrada", "salida 18:05", "entrada a las 8.55 am": la hora es la que el empleado dice que fue
 * (por ejemplo, cuando no tenía internet). Devuelve null si el texto no trae una hora válida.
 */
export function horaDeclarada(t: string): { palabra: string; h: number; m: number } | null {
  const x = t.match(/^(.+?)\s+(?:a\s+las\s+)?(\d{1,2})[:.](\d{2})\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!x) return null;
  let h = Number(x[2]);
  const m = Number(x[3]);
  const sufijo = x[4]?.[0];
  if (sufijo) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (sufijo === "p" ? 12 : 0);
  }
  if (h > 23 || m > 59) return null;
  return { palabra: x[1].trim(), h, m };
}

export function interpretarTexto(texto: string): Comando {
  const t = normalizar(texto);
  const tipo = tipoDePalabra(t);
  if (tipo) return { accion: "registrar", tipo };
  const dicha = horaDeclarada(t);
  const tipoConHora = dicha ? tipoDePalabra(dicha.palabra) : null;
  if (dicha && tipoConHora) return { accion: "registrar", tipo: tipoConHora, hora: { h: dicha.h, m: dicha.m } };
  if (["acepto", "si acepto", "si"].includes(t)) return { accion: "acepto" };
  if (["no acepto", "no"].includes(t)) return { accion: "no_acepto" };
  return { accion: "menu" };
}

/**
 * Instante (UTC) de la hora local `h:m` en la zona `tz`, referido a "hoy" según `ahora`.
 * Si esa hora aún no llega hoy, se entiende que fue ayer. Devuelve null si pasaron más de 24 horas
 * o si la hora declarada es del futuro cercano (más de 5 min adelante).
 */
export function resolverHoraDeclarada(hm: { h: number; m: number }, ahora: Date, tz: string): Date | null {
  const partes = (d: Date) => {
    const o: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d)) o[p.type] = p.value;
    return o;
  };
  const aUtc = (y: number, mes: number, dia: number): Date => {
    const objetivo = Date.UTC(y, mes - 1, dia, hm.h, hm.m);
    let utc = objetivo;
    for (let i = 0; i < 3; i++) {
      const o = partes(new Date(utc));
      const diff = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute) - objetivo;
      if (diff === 0) break;
      utc -= diff;
    }
    return new Date(utc);
  };
  const hoy = partes(ahora);
  let candidata = aUtc(+hoy.year, +hoy.month, +hoy.day);
  const CINCO_MIN = 5 * 60_000;
  if (candidata.getTime() - ahora.getTime() > CINCO_MIN) {
    const ayer = new Date(Date.UTC(+hoy.year, +hoy.month - 1, +hoy.day) - 86_400_000);
    candidata = aUtc(ayer.getUTCFullYear(), ayer.getUTCMonth() + 1, ayer.getUTCDate());
  }
  const atras = ahora.getTime() - candidata.getTime();
  return atras > 24 * 3_600_000 || atras < -CINCO_MIN ? null : candidata;
}

/** A partir de esta diferencia (min) entre la hora declarada y la del servidor se trata como registro diferido. */
export const MINUTOS_PARA_DIFERIDO = 3;

// --- Secuencia de registros ----------------------------------------------

export function resolverTipoPausa(ultimo: TipoRegistro | null): TipoRegistro {
  return ultimo === "pausa_inicio" ? "pausa_fin" : "pausa_inicio";
}

const SIGUIENTES_VALIDOS: Record<string, TipoRegistro[]> = {
  "": ["entrada"],
  entrada: ["salida", "pausa_inicio"],
  pausa_inicio: ["pausa_fin"],
  pausa_fin: ["salida", "pausa_inicio"],
  salida: ["entrada"],
};

export function secuenciaValida(ultimo: TipoRegistro | null, nuevo: TipoRegistro): boolean {
  return SIGUIENTES_VALIDOS[ultimo ?? ""].includes(nuevo);
}

// --- Selfie ----------------------------------------------------------------

/** Empleado, si no sede, si no empresa. */
export function selfieRequerida(
  empleado: boolean | null,
  sede: boolean | null,
  empresa: boolean,
): boolean {
  return empleado ?? sede ?? empresa;
}

// --- Destino de los mensajes ----------------------------------------------

/**
 * WhatsApp entrega los móviles de México como 521 + 10 dígitos, pero la API de envío (y la lista
 * de destinatarios de prueba) los espera como 52 + 10 dígitos. Se quita el "1" intermedio.
 */
export function destinoWhatsapp(waId: string): string {
  const digitos = waId.replace(/\D/g, "");
  return /^521\d{10}$/.test(digitos) ? "52" + digitos.slice(3) : digitos;
}

/** "850 metros" o "12.4 km": las distancias grandes se leen mejor en kilómetros. */
export function formatearDistancia(metros: number): string {
  if (!Number.isFinite(metros) || metros < 0) return "una distancia desconocida";
  if (metros < 1000) return `${Math.round(metros)} metros`;
  const km = metros / 1000;
  return `${km >= 100 ? Math.round(km) : km.toFixed(1)} km`;
}

// --- Invitaciones ------------------------------------------------------------

// Alfabeto sin 0, 1, I, O para evitar confusiones al teclear.
const PATRON_CODIGO = /\b([A-HJ-NP-Z2-9]{8})\b/;

/** Busca un código de invitación en un mensaje como "ALTA K7M2Q9XA". */
export function extraerCodigoInvitacion(texto: string): string | null {
  const m = texto.toUpperCase().match(PATRON_CODIGO);
  return m ? m[1] : null;
}

export function ultimos10(telefono: string): string {
  return telefono.replace(/\D/g, "").slice(-10);
}

// --- Ubicación y señales de riesgo ---------------------------------------

/** Heurística: los lugares elegidos en el mapa traen nombre o dirección; "ubicación actual" no. */
export function tipoUbicacion(u: { nombre?: string; direccion?: string }): "actual" | "elegida" {
  return u.nombre || u.direccion ? "elegida" : "actual";
}

export type ContextoSenales = {
  ultimoTipo: TipoRegistro | null;
  tipoNuevo: TipoRegistro;
  ubicacion: { lat: number; lng: number; nombre?: string; direccion?: string };
  ubicacionesPrevias: { lat: number; lng: number }[]; // las últimas del empleado, más reciente primero
  fotoRepetida: boolean;
  vinculadoAt: Date;
  tuvoVinculoPrevio: boolean;
  tsWhatsapp: Date | null;
  ahora: Date;
};

const DIAS_MS = 24 * 60 * 60 * 1000;

export function calcularSenales(c: ContextoSenales): string[] {
  const senales: string[] = [];
  if (!secuenciaValida(c.ultimoTipo, c.tipoNuevo)) senales.push("secuencia_inusual");
  if (tipoUbicacion(c.ubicacion) === "elegida") senales.push("ubicacion_elegida");

  const redondeo = (n: number) => n.toFixed(5); // ~1 m
  const repetidas = c.ubicacionesPrevias.slice(0, 3).filter((p) =>
    redondeo(p.lat) === redondeo(c.ubicacion.lat) && redondeo(p.lng) === redondeo(c.ubicacion.lng)
  ).length;
  if (repetidas >= 2) senales.push("ubicacion_repetida");

  if (c.fotoRepetida) senales.push("foto_repetida");
  if (c.tuvoVinculoPrevio && c.ahora.getTime() - c.vinculadoAt.getTime() < 7 * DIAS_MS) {
    senales.push("cambio_numero_reciente");
  }
  if (c.tsWhatsapp && Math.abs(c.ahora.getTime() - c.tsWhatsapp.getTime()) > 120_000) {
    senales.push("hora_desfasada");
  }
  return senales;
}
