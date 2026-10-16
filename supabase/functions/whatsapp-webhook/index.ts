// Webhook de la WhatsApp Cloud API. SIN PROBAR contra Meta ni Supabase.
// Despliegue: supabase functions deploy whatsapp-webhook --no-verify-jwt
// (Meta no envía un JWT de Supabase; la autenticidad se comprueba con la firma X-Hub-Signature-256.)

import { createClient } from "npm:@supabase/supabase-js@2";
import { extraerMensajes, firmaValida } from "./lib/logic.ts";
import { procesarMensaje } from "./lib/flujo.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  // Verificación inicial del webhook (la pide Meta al configurarlo).
  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    if (
      q.get("hub.mode") === "subscribe" &&
      q.get("hub.verify_token") === Deno.env.get("WHATSAPP_VERIFY_TOKEN") &&
      q.get("hub.challenge")
    ) {
      return new Response(q.get("hub.challenge"), { status: 200 });
    }
    return new Response("prohibido", { status: 403 });
  }
  if (req.method !== "POST") return new Response("método no permitido", { status: 405 });

  const cuerpo = await req.text(); // la firma se calcula sobre el cuerpo crudo
  const secreto = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
  if (!(await firmaValida(cuerpo, req.headers.get("x-hub-signature-256"), secreto))) {
    return new Response("firma inválida", { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(cuerpo);
  } catch {
    return new Response("json inválido", { status: 400 });
  }

  for (const m of extraerMensajes(payload)) {
    // La restricción única de wamid vuelve idempotente el webhook: un reenvío de Meta no duplica nada.
    const { data: nuevo, error } = await db.from("mensajes_whatsapp").upsert({
      wamid: m.wamid,
      wa_id: m.de,
      direccion: "entrante",
      tipo: m.tipo === "button" ? "interactive" : m.tipo,
      payload: m.crudo,
      ts_whatsapp: m.ts?.toISOString() ?? null,
    }, { onConflict: "wamid", ignoreDuplicates: true }).select("id");
    if (error) {
      console.error("no se pudo guardar el mensaje", m.wamid, error.message);
      return new Response("error", { status: 500 }); // Meta reintentará
    }
    if (!nuevo?.length) continue; // duplicado

    try {
      await procesarMensaje(db, m, nuevo[0].id);
    } catch (e) {
      console.error("error procesando", m.wamid, e);
      await db.from("mensajes_whatsapp").update({
        estado: "error",
        error: String(e instanceof Error ? e.message : e).slice(0, 500),
        intentos: 1,
      }).eq("id", nuevo[0].id);
    }
  }
  return new Response("ok", { status: 200 });
});
