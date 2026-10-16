// Cliente mínimo de la WhatsApp Cloud API (Graph API de Meta).
// SIN PROBAR contra Meta: verificar versión de la API y formatos con la documentación vigente.

const VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v21.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

function token(): string {
  const t = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!t) throw new Error("falta WHATSAPP_ACCESS_TOKEN");
  return t;
}

async function enviar(phoneNumberId: string, cuerpo: Record<string, unknown>): Promise<string | null> {
  const r = await fetch(`${BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...cuerpo }),
  });
  if (!r.ok) throw new Error(`WhatsApp respondió ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j?.messages?.[0]?.id ?? null; // wamid del mensaje saliente
}

export function enviarTexto(phoneNumberId: string, para: string, texto: string) {
  return enviar(phoneNumberId, { to: para, type: "text", text: { body: texto } });
}

/** Hasta 3 botones; título de máximo 20 caracteres. */
export function enviarBotones(
  phoneNumberId: string,
  para: string,
  texto: string,
  botones: { id: string; titulo: string }[],
) {
  return enviar(phoneNumberId, {
    to: para,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: texto },
      action: {
        buttons: botones.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.titulo.slice(0, 20) },
        })),
      },
    },
  });
}

/** Mensaje con botón "Enviar ubicación". */
export function pedirUbicacion(phoneNumberId: string, para: string, texto: string) {
  return enviar(phoneNumberId, {
    to: para,
    type: "interactive",
    interactive: { type: "location_request_message", body: { text: texto }, action: { name: "send_location" } },
  });
}

/** Devuelve la URL temporal del archivo. Hay que descargarlo pronto: caduca. */
export async function obtenerMedio(mediaId: string): Promise<{ url: string; mime: string; bytes?: number }> {
  const r = await fetch(`${BASE}/${mediaId}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) throw new Error(`no se pudo obtener el medio ${mediaId}: ${r.status}`);
  const j = await r.json();
  return { url: j.url, mime: j.mime_type, bytes: j.file_size };
}

export async function descargarMedio(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) throw new Error(`no se pudo descargar el medio: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
