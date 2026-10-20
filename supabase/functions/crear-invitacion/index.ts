// Crea una invitación para vincular el WhatsApp de un empleado. SIN PROBAR contra Supabase.
// La llama el panel con la sesión del usuario:
//   POST /functions/v1/crear-invitacion   { "empleado_id": "<uuid>" }
//   -> { codigo, enlace, expira_at, empleado: { nombre, telefono }, aviso: "enviado" | "no_configurado" | "fallo" }
// Si existe el secreto WHATSAPP_PLANTILLA_ALTA (nombre de una plantilla aprobada por Meta con 3 variables:
// {{1}} nombre, {{2}} empresa, {{3}} enlace), también se avisa al empleado por WhatsApp.
// El código se devuelve UNA vez; en la base solo se guarda su hash (sha-256).
// Despliegue: supabase functions deploy crear-invitacion   (con verificación de JWT activada)

import { createClient } from "npm:@supabase/supabase-js@2";
import { sha256Hex } from "../_shared/logic.ts";
import { enlaceWhatsapp, esUuid, expiraEn, generarCodigo } from "../_shared/invitacion.ts";
import { enviarPlantilla } from "../whatsapp-webhook/lib/whatsapp.ts";

const URL_SUPABASE = Deno.env.get("SUPABASE_URL")!;
const CABECERAS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CABECERAS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CABECERAS });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);

  const autorizacion = req.headers.get("Authorization");
  if (!autorizacion) return json({ error: "falta autorización" }, 401);

  // Cliente con la sesión del usuario: RLS decide qué empleados puede ver.
  const usuarioDb = createClient(URL_SUPABASE, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: autorizacion } },
    auth: { persistSession: false },
  });
  const { data: sesion, error: errSesion } = await usuarioDb.auth.getUser();
  if (errSesion || !sesion?.user) return json({ error: "sesión inválida" }, 401);
  const usuario = sesion.user;

  let cuerpo: { empleado_id?: unknown };
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: "json inválido" }, 400);
  }
  if (!esUuid(cuerpo.empleado_id)) return json({ error: "empleado_id inválido" }, 400);

  // Si el usuario no puede ver al empleado, RLS lo devuelve vacío: se responde 404 igual que si no existiera.
  const { data: empleado } = await usuarioDb.from("empleados")
    .select("id, empresa_id, nombre, telefono, estado").eq("id", cuerpo.empleado_id).maybeSingle();
  if (!empleado) return json({ error: "empleado no encontrado" }, 404);

  const { data: miembro } = await usuarioDb.from("miembros").select("rol")
    .eq("empresa_id", empleado.empresa_id).eq("user_id", usuario.id).eq("activo", true).maybeSingle();
  if (!miembro || !["dueno", "admin"].includes(miembro.rol)) {
    return json({ error: "solo dueño o administrador pueden invitar" }, 403);
  }
  if (empleado.estado === "baja") return json({ error: "el empleado está dado de baja" }, 409);

  // A partir de aquí se escribe con service_role (invitaciones no tiene política de inserción).
  const admin = createClient(URL_SUPABASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Número de WhatsApp: el propio de la empresa si existe; si no, el compartido.
  const { data: numeros } = await admin.from("numeros_whatsapp").select("numero_visible, empresa_id, phone_number_id")
    .eq("activo", true).or(`empresa_id.is.null,empresa_id.eq.${empleado.empresa_id}`);
  const numero = numeros?.find((n) => n.empresa_id === empleado.empresa_id && n.numero_visible) ??
    numeros?.find((n) => n.empresa_id === null && n.numero_visible);
  if (!numero) return json({ error: "no hay un número de WhatsApp configurado" }, 409);

  // Las invitaciones pendientes anteriores dejan de servir.
  const ahora = new Date();
  await admin.from("invitaciones").update({ expira_at: ahora.toISOString() })
    .eq("empleado_id", empleado.id).is("usado_at", null).gt("expira_at", ahora.toISOString());

  const expira = expiraEn(ahora);
  let codigo = "";
  for (let intento = 0; intento < 3; intento++) {
    codigo = generarCodigo();
    const { error } = await admin.from("invitaciones").insert({
      empresa_id: empleado.empresa_id,
      empleado_id: empleado.id,
      codigo_hash: await sha256Hex(codigo),
      expira_at: expira.toISOString(),
    });
    if (!error) break;
    if (error.code !== "23505" || intento === 2) { // 23505 = colisión del hash, casi imposible
      console.error("no se pudo crear la invitación", error.message);
      return json({ error: "no se pudo crear la invitación" }, 500);
    }
  }

  await admin.from("bitacora").insert({
    empresa_id: empleado.empresa_id,
    actor: usuario.id,
    accion: "INVITACION",
    tabla: "empleados",
    fila_id: empleado.id,
  });

  const enlace = enlaceWhatsapp(numero.numero_visible, codigo);

  // Aviso opcional por WhatsApp. Nunca hace fallar la invitación: el panel ofrece el enlace de todos modos.
  let aviso: "enviado" | "no_configurado" | "fallo" = "no_configurado";
  const plantilla = Deno.env.get("WHATSAPP_PLANTILLA_ALTA");
  if (plantilla && numero.phone_number_id) {
    try {
      const { data: empresa } = await admin.from("empresas").select("nombre").eq("id", empleado.empresa_id).single();
      await enviarPlantilla(numero.phone_number_id, empleado.telefono, plantilla, Deno.env.get("WHATSAPP_PLANTILLA_IDIOMA") ?? "es_MX",
        [empleado.nombre.split(/\s+/)[0], empresa?.nombre ?? "tu empresa", enlace]);
      aviso = "enviado";
    } catch (err) {
      console.error("no se pudo enviar el aviso de alta", err instanceof Error ? err.message : err);
      aviso = "fallo";
    }
  }

  return json({
    codigo,
    enlace,
    expira_at: expira.toISOString(),
    empleado: { nombre: empleado.nombre, telefono: empleado.telefono },
    aviso,
  });
});
