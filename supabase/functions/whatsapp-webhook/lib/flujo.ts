// Máquina de estados del registro por WhatsApp. SIN PROBAR contra Supabase ni Meta.
// Usa service_role: salta RLS, así que cada consulta filtra explícitamente.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  BOTONES,
  calcularSenales,
  extraerCodigoInvitacion,
  interpretarBoton,
  interpretarTexto,
  type Comando,
  type MensajeEntrante,
  resolverTipoPausa,
  secuenciaValida,
  selfieRequerida,
  sha256Hex,
  tipoUbicacion,
  type TipoRegistro,
  ultimos10,
} from "./logic.ts";
import {
  descargarMedio,
  enviarBotones,
  enviarTexto,
  obtenerMedio,
  pedirUbicacion,
} from "./whatsapp.ts";

const VERSION_AVISO = "v1";
const TEXTO_AVISO =
  "Hola {nombre}. Para registrar tu asistencia por WhatsApp usaremos tu ubicación y una foto tuya " +
  "en cada registro. Solo tu empresa y sus administradores podrán verlos, y se conservarán el " +
  "tiempo que exige la ley. ¿Aceptas?";

type Ctx = { db: SupabaseClient; m: MensajeEntrante; numeroId: string };
// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;

export async function procesarMensaje(db: SupabaseClient, m: MensajeEntrante, mensajeId: string) {
  const { data: numero } = await db.from("numeros_whatsapp").select("id, empresa_id")
    .eq("phone_number_id", m.phoneNumberId).eq("activo", true).maybeSingle();
  if (!numero) return await cerrar(db, mensajeId, "ignorado", "número de WhatsApp no registrado", {});
  const ctx: Ctx = { db, m, numeroId: numero.id };
  await db.from("mensajes_whatsapp").update({ numero_id: numero.id }).eq("id", mensajeId);

  const { data: vinculo } = await db.from("vinculos_whatsapp").select("*")
    .eq("numero_id", numero.id).eq("wa_id", m.de).eq("activo", true).maybeSingle();

  // 1. Número desconocido: solo sirve un código de invitación.
  if (!vinculo) {
    const r = await intentarVincular(ctx);
    return await cerrar(db, mensajeId, "procesado", null, r ?? {});
  }

  const { data: empleado } = await db.from("empleados").select("*").eq("id", vinculo.empleado_id).single();
  const ids = { empleado_id: empleado.id, empresa_id: empleado.empresa_id };
  if (empleado.estado === "baja") {
    await responder(ctx, empleado, "Tu acceso fue dado de baja. Consulta con tu empresa.");
    return await cerrar(db, mensajeId, "procesado", null, ids);
  }

  const comando: Comando | null = m.tipo === "button"
    ? interpretarBoton(m.botonId ?? "")
    : m.tipo === "text"
    ? interpretarTexto(m.texto ?? "")
    : null;

  // 2. Falta aceptar el aviso de privacidad.
  if (empleado.estado === "invitado") {
    await manejarAviso(ctx, empleado, comando);
    return await cerrar(db, mensajeId, "procesado", null, ids);
  }

  // 3. Empleado activo.
  const sesion = await sesionAbierta(db, empleado.id);

  if (m.tipo === "location") {
    await recibirUbicacion(ctx, empleado, vinculo, sesion);
  } else if (m.tipo === "image") {
    await recibirSelfie(ctx, empleado, vinculo, sesion);
  } else if (comando?.accion === "registrar") {
    await iniciarRegistro(ctx, empleado, vinculo, comando.tipo, sesion);
  } else {
    await enviarBotones(m.phoneNumberId, m.de, `Hola ${empleado.nombre}, ¿qué quieres registrar?`, [
      { id: BOTONES.entrada, titulo: "Entrada" },
      { id: BOTONES.salida, titulo: "Salida" },
      { id: BOTONES.pausa, titulo: "Pausa / regreso" },
    ]);
  }
  return await cerrar(db, mensajeId, "procesado", null, ids);
}

// --- Vinculación ---------------------------------------------------------

async function intentarVincular(ctx: Ctx): Promise<Fila | null> {
  const { db, m } = ctx;
  const codigo = m.tipo === "text" ? extraerCodigoInvitacion(m.texto ?? "") : null;
  const sinAcceso =
    "Este número no está registrado. Pide a tu empresa tu enlace de registro y envíalo desde aquí.";
  if (!codigo) {
    await enviarTexto(m.phoneNumberId, m.de, sinAcceso);
    return null;
  }

  const hash = await sha256Hex(codigo);
  const { data: inv } = await db.from("invitaciones").select("*").eq("codigo_hash", hash).maybeSingle();
  if (!inv || inv.usado_at || new Date(inv.expira_at) < new Date()) {
    await enviarTexto(m.phoneNumberId, m.de, "El código no es válido o ya venció. Pide uno nuevo a tu empresa.");
    return null;
  }

  const { data: empleado } = await db.from("empleados").select("*").eq("id", inv.empleado_id).single();
  // El código solo sirve desde el teléfono dado de alta (compara los últimos 10 dígitos).
  if (ultimos10(m.de) !== ultimos10(empleado.telefono)) {
    await enviarTexto(m.phoneNumberId, m.de, "Este código es de otro número de teléfono. Pide a tu empresa que actualice tus datos.");
    return null;
  }

  // Un cambio de número revoca el vínculo anterior.
  await db.from("vinculos_whatsapp").update({ revocado_at: new Date().toISOString(), motivo_revocacion: "numero_nuevo" })
    .eq("empleado_id", empleado.id).eq("numero_id", ctx.numeroId).is("revocado_at", null);
  const { error } = await db.from("vinculos_whatsapp").insert({
    empresa_id: empleado.empresa_id,
    empleado_id: empleado.id,
    numero_id: ctx.numeroId,
    wa_id: m.de,
  });
  if (error) throw error;
  await db.from("invitaciones").update({ usado_at: new Date().toISOString() }).eq("id", inv.id);

  await enviarBotones(m.phoneNumberId, m.de, TEXTO_AVISO.replace("{nombre}", empleado.nombre), [
    { id: BOTONES.acepto, titulo: "Acepto" },
    { id: BOTONES.noAcepto, titulo: "No acepto" },
  ]);
  return { empleado_id: empleado.id, empresa_id: empleado.empresa_id };
}

async function manejarAviso(ctx: Ctx, empleado: Fila, comando: Comando | null) {
  const { db, m } = ctx;
  if (comando?.accion === "acepto") {
    const filas = ["aviso_privacidad", "ubicacion", "selfie"].map((tipo) => ({
      empresa_id: empleado.empresa_id,
      empleado_id: empleado.id,
      tipo,
      version: VERSION_AVISO,
      wamid: m.wamid,
    }));
    await db.from("consentimientos").upsert(filas, { onConflict: "empleado_id,tipo,version", ignoreDuplicates: true });
    await db.from("empleados").update({ estado: "activo" }).eq("id", empleado.id);
    await enviarBotones(m.phoneNumberId, m.de, "Listo, ya puedes registrar tu asistencia. ¿Qué quieres registrar?", [
      { id: BOTONES.entrada, titulo: "Entrada" },
      { id: BOTONES.salida, titulo: "Salida" },
    ]);
  } else if (comando?.accion === "no_acepto") {
    await enviarTexto(m.phoneNumberId, m.de, "Entendido. Sin tu aceptación no podemos registrar tu asistencia por este medio. Habla con tu empresa.");
  } else {
    await enviarBotones(m.phoneNumberId, m.de, TEXTO_AVISO.replace("{nombre}", empleado.nombre), [
      { id: BOTONES.acepto, titulo: "Acepto" },
      { id: BOTONES.noAcepto, titulo: "No acepto" },
    ]);
  }
}

// --- Registro --------------------------------------------------------------

async function sesionAbierta(db: SupabaseClient, empleadoId: string): Promise<Fila | null> {
  const { data } = await db.from("sesiones_registro").select("*").eq("empleado_id", empleadoId)
    .in("estado", ["esperando_ubicacion", "esperando_selfie"]).maybeSingle();
  if (data && new Date(data.expira_at) < new Date()) {
    await db.from("sesiones_registro").update({ estado: "expirada" }).eq("id", data.id);
    return null;
  }
  return data;
}

async function ultimoRegistro(db: SupabaseClient, empleadoId: string, n = 1): Promise<Fila[]> {
  const { data } = await db.from("registros").select("tipo, lat, lng, ocurrido_at").eq("empleado_id", empleadoId)
    .order("ocurrido_at", { ascending: false }).limit(n);
  return data ?? [];
}

async function iniciarRegistro(
  ctx: Ctx,
  empleado: Fila,
  vinculo: Fila,
  pedido: "entrada" | "salida" | "pausa",
  abierta: Fila | null,
) {
  const { db, m } = ctx;
  const [ultimo] = await ultimoRegistro(db, empleado.id);
  const tipo: TipoRegistro = pedido === "pausa" ? resolverTipoPausa(ultimo?.tipo ?? null) : pedido;

  if (abierta) await db.from("sesiones_registro").update({ estado: "expirada" }).eq("id", abierta.id);
  const { error } = await db.from("sesiones_registro").insert({
    empresa_id: empleado.empresa_id,
    empleado_id: empleado.id,
    vinculo_id: vinculo.id,
    sede_id: empleado.sede_id,
    tipo,
  });
  if (error) throw error;

  const aviso = secuenciaValida(ultimo?.tipo ?? null, tipo)
    ? ""
    : " (Ojo: tu último registro fue distinto a lo esperado; se marcará para revisión.)";
  await pedirUbicacion(m.phoneNumberId, m.de, `Vas a registrar: ${etiqueta(tipo)}.${aviso} Toca el botón para enviar tu ubicación.`);
}

async function recibirUbicacion(ctx: Ctx, empleado: Fila, vinculo: Fila, sesion: Fila | null) {
  const { db, m } = ctx;
  if (!sesion || sesion.estado !== "esperando_ubicacion") {
    await enviarBotones(m.phoneNumberId, m.de, "Primero elige qué quieres registrar.", [
      { id: BOTONES.entrada, titulo: "Entrada" },
      { id: BOTONES.salida, titulo: "Salida" },
      { id: BOTONES.pausa, titulo: "Pausa / regreso" },
    ]);
    return;
  }
  const u = m.ubicacion!;
  const { data: g } = await db.rpc("geocerca_para", { p_sede: empleado.sede_id, p_lat: u.lat, p_lng: u.lng });
  const geo = Array.isArray(g) ? g[0] : g;
  const base = {
    lat: u.lat,
    lng: u.lng,
    tipo_ubicacion: tipoUbicacion(u),
    ubicacion_wamid: m.wamid,
    geocerca_id: geo?.geocerca_id ?? null,
    distancia_m: geo?.distancia_m ?? null,
    dentro_geocerca: geo?.dentro ?? false,
  };

  if (!geo?.dentro) {
    await db.from("sesiones_registro").update({ ...base, estado: "rechazada", motivo_rechazo: "fuera_de_geocerca" })
      .eq("id", sesion.id);
    const lejos = geo?.distancia_m ? ` Estás a unos ${Math.round(geo.distancia_m)} metros de tu sede.` : "";
    await enviarTexto(m.phoneNumberId, m.de, `No pudimos registrar: estás fuera de la zona de tu sede.${lejos} Si es un error, avisa a tu supervisor.`);
    return;
  }

  const { data: sede } = await db.from("sedes").select("selfie_requerida").eq("id", empleado.sede_id).single();
  const { data: empresa } = await db.from("empresas").select("selfie_requerida").eq("id", empleado.empresa_id).single();
  const necesitaSelfie = selfieRequerida(empleado.selfie_requerida, sede?.selfie_requerida ?? null, empresa?.selfie_requerida ?? true);

  if (necesitaSelfie) {
    await db.from("sesiones_registro").update({ ...base, estado: "esperando_selfie" }).eq("id", sesion.id);
    await enviarTexto(m.phoneNumberId, m.de, "Ubicación recibida. Ahora envía una selfie tomada en este momento.");
  } else {
    await db.from("sesiones_registro").update(base).eq("id", sesion.id);
    await completar(ctx, empleado, vinculo, { ...sesion, ...base }, null, false);
  }
}

async function recibirSelfie(ctx: Ctx, empleado: Fila, vinculo: Fila, sesion: Fila | null) {
  const { db, m } = ctx;
  if (!sesion || sesion.estado !== "esperando_selfie") {
    await enviarTexto(m.phoneNumberId, m.de, "No estoy esperando una foto ahora. Elige primero qué quieres registrar.");
    return;
  }
  // Descargar de inmediato: el enlace de Meta caduca en pocos minutos.
  const info = await obtenerMedio(m.imagen!.id);
  const bytes = await descargarMedio(info.url);
  const sha = await sha256Hex(bytes);
  const medioId = crypto.randomUUID();
  const ruta = `${empleado.empresa_id}/${empleado.id}/${medioId}.jpg`;

  const { error: errSubida } = await db.storage.from("selfies").upload(ruta, bytes, { contentType: info.mime, upsert: false });
  if (errSubida) throw errSubida;

  const { count } = await db.from("medios").select("id", { count: "exact", head: true })
    .eq("empleado_id", empleado.id).eq("sha256", sha);
  const { error } = await db.from("medios").insert({
    id: medioId,
    empresa_id: empleado.empresa_id,
    empleado_id: empleado.id,
    wa_media_id: m.imagen!.id,
    ruta_storage: ruta,
    sha256: sha,
    mime: info.mime,
    bytes: bytes.length,
  });
  if (error) throw error;
  await db.from("sesiones_registro").update({ medio_id: medioId }).eq("id", sesion.id);
  await completar(ctx, empleado, vinculo, { ...sesion, medio_id: medioId }, medioId, (count ?? 0) > 0);
}

async function completar(
  ctx: Ctx,
  empleado: Fila,
  vinculo: Fila,
  sesion: Fila,
  medioId: string | null,
  fotoRepetida: boolean,
) {
  const { db, m } = ctx;
  const previos = await ultimoRegistro(db, empleado.id, 3);
  const { count: vinculos } = await db.from("vinculos_whatsapp").select("id", { count: "exact", head: true })
    .eq("empleado_id", empleado.id);

  const senales = calcularSenales({
    ultimoTipo: previos[0]?.tipo ?? null,
    tipoNuevo: sesion.tipo,
    ubicacion: { lat: sesion.lat, lng: sesion.lng, nombre: sesion.tipo_ubicacion === "elegida" ? "x" : undefined },
    ubicacionesPrevias: previos.filter((p) => p.lat != null).map((p) => ({ lat: p.lat, lng: p.lng })),
    fotoRepetida,
    vinculadoAt: new Date(vinculo.vinculado_at),
    tuvoVinculoPrevio: (vinculos ?? 0) > 1,
    tsWhatsapp: m.ts,
    ahora: new Date(),
  });

  const { data: registro, error } = await db.from("registros").insert({
    empresa_id: empleado.empresa_id,
    empleado_id: empleado.id,
    sede_id: empleado.sede_id,
    sesion_id: sesion.id,
    tipo: sesion.tipo,
    canal: "whatsapp",
    ts_cliente: m.ts?.toISOString() ?? null,
    lat: sesion.lat,
    lng: sesion.lng,
    geocerca_id: sesion.geocerca_id,
    distancia_m: sesion.distancia_m,
    dentro_geocerca: true,
    medio_id: medioId,
    senales,
  }).select("ocurrido_at").single();
  if (error) throw error;

  await db.from("sesiones_registro").update({ estado: "completada", completada_at: new Date().toISOString(), senales })
    .eq("id", sesion.id);

  const { data: sede } = await db.from("sedes").select("nombre, zona_horaria").eq("id", empleado.sede_id).single();
  const hora = new Intl.DateTimeFormat("es-MX", {
    timeZone: sede?.zona_horaria ?? "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(new Date(registro.ocurrido_at));
  await enviarTexto(m.phoneNumberId, m.de, `✓ ${etiqueta(sesion.tipo)} registrada. ${hora}, ${sede?.nombre ?? "tu sede"}.`);
}

// --- Utilidades ---------------------------------------------------------

function etiqueta(t: TipoRegistro): string {
  return { entrada: "Entrada", salida: "Salida", pausa_inicio: "Inicio de pausa", pausa_fin: "Fin de pausa" }[t];
}

/** Envía un texto y lo guarda en la bitácora de mensajes. */
async function responder(ctx: Ctx, empleado: Fila, texto: string) {
  const wamid = await enviarTexto(ctx.m.phoneNumberId, ctx.m.de, texto);
  await ctx.db.from("mensajes_whatsapp").insert({
    wamid,
    numero_id: ctx.numeroId,
    empresa_id: empleado.empresa_id,
    empleado_id: empleado.id,
    wa_id: ctx.m.de,
    direccion: "saliente",
    tipo: "text",
    payload: { texto },
  });
}

async function cerrar(db: SupabaseClient, mensajeId: string, estado: string, error: string | null, ids: Fila) {
  await db.from("mensajes_whatsapp").update({
    estado,
    error,
    procesado_at: new Date().toISOString(),
    ...ids,
  }).eq("id", mensajeId);
}
