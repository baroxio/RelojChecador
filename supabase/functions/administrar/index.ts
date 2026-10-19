// Administración de usuarios y empresas. SIN PROBAR contra Supabase.
// La llama el panel con la sesión del usuario: POST /functions/v1/administrar  { "accion": "...", ... }
// Usa la clave del servidor (service_role) solo aquí; el navegador nunca la ve.
// Despliegue: supabase functions deploy administrar   (con verificación de JWT activada)
//
// Acciones de empresa (el actor debe ser dueño o administrador ACTIVO de esa empresa):
//   crear_usuario     { empresa_id, correo, nombre, rol, sede_ids? }  -> { clave_temporal | ya_existia }
//   cambiar_rol       { miembro_id, rol, sede_ids? }
//   cambiar_activo    { miembro_id, activo }
//   reiniciar_clave   { miembro_id }                                  -> { clave_temporal }
// Acciones de plataforma (el actor debe estar en plataforma_admins):
//   listar_empresas   {}
//   crear_empresa     { nombre, correo_dueno, nombre_dueno }          -> { empresa_id, clave_temporal | ya_existia }
//   renombrar_empresa { empresa_id, nombre }
//   unirme_a_empresa  { empresa_id }                                  (te agrega como administrador, queda en la bitácora)

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  correoValido, errorAlCambiarActivo, errorAlCambiarRol, errorAlCrearUsuario, esRol, generarClaveTemporal,
  normalizarCorreo, puedeGestionar, type Miembro, type Rol,
} from "../_shared/permisos.ts";
import { esUuid } from "../_shared/invitacion.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CABECERAS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class ErrorPublico extends Error {
  estado: number;
  constructor(mensaje: string, estado = 400) { super(mensaje); this.estado = estado; }
}

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CABECERAS, "Content-Type": "application/json" } });
}

type Peticion = Record<string, unknown>;

async function autenticar(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new ErrorPublico("falta autorización", 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new ErrorPublico("sesión inválida", 401);
  return data.user;
}

async function esAdminPlataforma(userId: string): Promise<boolean> {
  const { data } = await admin.from("plataforma_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

/** Rol del actor en la empresa; falla si no es dueño o administrador activo. */
async function actorEnEmpresa(empresaId: string, userId: string): Promise<Rol> {
  const { data } = await admin.from("miembros").select("rol, activo").eq("empresa_id", empresaId).eq("user_id", userId).maybeSingle();
  if (!data?.activo || !["dueno", "admin"].includes(data.rol)) throw new ErrorPublico("no tienes permiso en esa empresa", 403);
  return data.rol as Rol;
}

async function miembrosDe(empresaId: string): Promise<Miembro[]> {
  const { data, error } = await admin.from("miembros").select("id, user_id, rol, activo").eq("empresa_id", empresaId);
  if (error) throw error;
  return (data ?? []) as Miembro[];
}

async function bitacora(empresaId: string | null, actor: string, accion: string, filaId: string | null, despues: unknown) {
  await admin.from("bitacora").insert({ empresa_id: empresaId, actor, accion, tabla: "administrar", fila_id: filaId, despues });
}

async function validarSedes(empresaId: string, sedeIds: unknown): Promise<string[]> {
  if (sedeIds == null) return [];
  if (!Array.isArray(sedeIds) || !sedeIds.every(esUuid)) throw new ErrorPublico("sedes inválidas");
  if (!sedeIds.length) return [];
  const { data } = await admin.from("sedes").select("id").eq("empresa_id", empresaId).in("id", sedeIds);
  if ((data ?? []).length !== new Set(sedeIds).size) throw new ErrorPublico("una de las sedes no es de esta empresa");
  return sedeIds;
}

async function guardarSedes(miembroId: string, rol: Rol, sedeIds: string[]) {
  await admin.from("miembro_sedes").delete().eq("miembro_id", miembroId);
  if (rol === "supervisor" && sedeIds.length) {
    const { error } = await admin.from("miembro_sedes").insert(sedeIds.map((sede_id) => ({ miembro_id: miembroId, sede_id })));
    if (error) throw error;
  }
}

/** Crea el usuario de Auth (con clave temporal) o reutiliza el que ya existe con ese correo. */
async function usuarioParaCorreo(correo: string, nombre: string) {
  const { data: existente } = await admin.rpc("usuario_id_por_correo", { p_correo: correo });
  if (existente) return { userId: existente as string, clave: null as string | null, yaExistia: true };
  const clave = generarClaveTemporal();
  const { data, error } = await admin.auth.admin.createUser({
    email: correo, password: clave, email_confirm: true, user_metadata: { nombre: nombre.trim(), debe_cambiar_clave: true },
  });
  if (error || !data?.user) throw new ErrorPublico(error?.message ?? "no se pudo crear el usuario", 400);
  return { userId: data.user.id, clave, yaExistia: false };
}

// ---------- Acciones ----------
const acciones: Record<string, (p: Peticion, userId: string) => Promise<unknown>> = {
  async crear_usuario(p, userId) {
    if (!esUuid(p.empresa_id)) throw new ErrorPublico("empresa inválida");
    const actor = await actorEnEmpresa(p.empresa_id, userId);
    const correo = normalizarCorreo(p.correo);
    const nombre = String(p.nombre ?? "");
    const falla = errorAlCrearUsuario({ actor, correo, nombre, rol: p.rol });
    if (falla) throw new ErrorPublico(falla, 403);
    const rol = p.rol as Rol;
    const sedes = await validarSedes(p.empresa_id, p.sede_ids);
    const { data: ya } = await admin.rpc("usuario_id_por_correo", { p_correo: correo });
    if (ya) {
      const { data: yaMiembro } = await admin.from("miembros").select("id").eq("empresa_id", p.empresa_id).eq("user_id", ya).maybeSingle();
      if (yaMiembro) throw new ErrorPublico("Esa persona ya pertenece a esta empresa.", 409);
    }
    const { userId: nuevo, clave, yaExistia } = await usuarioParaCorreo(correo, nombre);
    const { data: miembro, error } = await admin.from("miembros").insert({ empresa_id: p.empresa_id, user_id: nuevo, rol, activo: true }).select("id").single();
    if (error) throw error;
    await guardarSedes(miembro.id, rol, sedes);
    await bitacora(p.empresa_id, userId, "crear_usuario", miembro.id, { correo, rol });
    return { miembro_id: miembro.id, correo, clave_temporal: clave, ya_existia: yaExistia };
  },

  async cambiar_rol(p, userId) {
    if (!esUuid(p.miembro_id) || !esRol(p.rol)) throw new ErrorPublico("datos inválidos");
    const { data: objetivo } = await admin.from("miembros").select("id, user_id, rol, activo, empresa_id").eq("id", p.miembro_id).maybeSingle();
    if (!objetivo) throw new ErrorPublico("no se encontró a esa persona", 404);
    const actor = await actorEnEmpresa(objetivo.empresa_id, userId);
    const falla = errorAlCambiarRol({ actor, actorUserId: userId, objetivo: objetivo as Miembro, nuevoRol: p.rol, miembros: await miembrosDe(objetivo.empresa_id) });
    if (falla) throw new ErrorPublico(falla, 403);
    const sedes = await validarSedes(objetivo.empresa_id, p.sede_ids);
    const { error } = await admin.from("miembros").update({ rol: p.rol }).eq("id", objetivo.id);
    if (error) throw error;
    await guardarSedes(objetivo.id, p.rol, sedes);
    await bitacora(objetivo.empresa_id, userId, "cambiar_rol", objetivo.id, { de: objetivo.rol, a: p.rol });
    return { ok: true };
  },

  async cambiar_activo(p, userId) {
    if (!esUuid(p.miembro_id) || typeof p.activo !== "boolean") throw new ErrorPublico("datos inválidos");
    const { data: objetivo } = await admin.from("miembros").select("id, user_id, rol, activo, empresa_id").eq("id", p.miembro_id).maybeSingle();
    if (!objetivo) throw new ErrorPublico("no se encontró a esa persona", 404);
    const actor = await actorEnEmpresa(objetivo.empresa_id, userId);
    const falla = errorAlCambiarActivo({ actor, actorUserId: userId, objetivo: objetivo as Miembro, activo: p.activo, miembros: await miembrosDe(objetivo.empresa_id) });
    if (falla) throw new ErrorPublico(falla, 403);
    const { error } = await admin.from("miembros").update({ activo: p.activo }).eq("id", objetivo.id);
    if (error) throw error;
    await bitacora(objetivo.empresa_id, userId, p.activo ? "reactivar_usuario" : "dar_de_baja_usuario", objetivo.id, null);
    return { ok: true };
  },

  async reiniciar_clave(p, userId) {
    if (!esUuid(p.miembro_id)) throw new ErrorPublico("datos inválidos");
    const { data: objetivo } = await admin.from("miembros").select("id, user_id, rol, empresa_id").eq("id", p.miembro_id).maybeSingle();
    if (!objetivo) throw new ErrorPublico("no se encontró a esa persona", 404);
    const actor = await actorEnEmpresa(objetivo.empresa_id, userId);
    if (objetivo.user_id !== userId && !puedeGestionar(actor, objetivo.rol as Rol)) throw new ErrorPublico("no tienes permiso para esa persona", 403);
    const clave = generarClaveTemporal();
    const { error } = await admin.auth.admin.updateUserById(objetivo.user_id, { password: clave, user_metadata: { debe_cambiar_clave: true } });
    if (error) throw new ErrorPublico(error.message, 400);
    await bitacora(objetivo.empresa_id, userId, "reiniciar_clave", objetivo.id, null);
    return { clave_temporal: clave };
  },

  // ----- plataforma -----
  async listar_empresas(_p, userId) {
    await exigirPlataforma(userId);
    const { data: empresas, error } = await admin.from("empresas").select("id, nombre, creado_at").order("nombre");
    if (error) throw error;
    const { data: miembros } = await admin.from("miembros").select("empresa_id, activo");
    const { data: empleados } = await admin.from("empleados").select("empresa_id, estado");
    const cuenta = (filas: { empresa_id: string }[] | null, ok: (f: any) => boolean) => {
      const c: Record<string, number> = {};
      for (const f of filas ?? []) if (ok(f)) c[f.empresa_id] = (c[f.empresa_id] ?? 0) + 1;
      return c;
    };
    const u = cuenta(miembros, (f) => f.activo);
    const e = cuenta(empleados, (f) => f.estado === "activo");
    return { empresas: (empresas ?? []).map((x) => ({ ...x, usuarios: u[x.id] ?? 0, empleados: e[x.id] ?? 0 })) };
  },

  async crear_empresa(p, userId) {
    await exigirPlataforma(userId);
    const nombre = String(p.nombre ?? "").trim();
    const correo = normalizarCorreo(p.correo_dueno);
    const nombreDueno = String(p.nombre_dueno ?? "").trim();
    if (nombre.length < 2) throw new ErrorPublico("Escribe el nombre de la empresa.");
    if (!correoValido(correo)) throw new ErrorPublico("Escribe un correo válido para el dueño.");
    if (nombreDueno.length < 2) throw new ErrorPublico("Escribe el nombre del dueño.");
    const { data: empresa, error } = await admin.from("empresas").insert({ nombre }).select("id").single();
    if (error) throw error;
    try {
      const { userId: duenoId, clave, yaExistia } = await usuarioParaCorreo(correo, nombreDueno);
      const { error: e2 } = await admin.from("miembros").insert({ empresa_id: empresa.id, user_id: duenoId, rol: "dueno", activo: true });
      if (e2) throw e2;
      await admin.from("sedes").insert({ empresa_id: empresa.id, nombre: "Sede principal" });
      await bitacora(empresa.id, userId, "crear_empresa", empresa.id, { nombre, correo_dueno: correo });
      return { empresa_id: empresa.id, correo, clave_temporal: clave, ya_existia: yaExistia };
    } catch (err) {
      await admin.from("empresas").delete().eq("id", empresa.id); // no dejar una empresa sin dueño
      throw err;
    }
  },

  async renombrar_empresa(p, userId) {
    await exigirPlataforma(userId);
    const nombre = String(p.nombre ?? "").trim();
    if (!esUuid(p.empresa_id) || nombre.length < 2) throw new ErrorPublico("datos inválidos");
    const { error } = await admin.from("empresas").update({ nombre }).eq("id", p.empresa_id);
    if (error) throw error;
    await bitacora(p.empresa_id, userId, "renombrar_empresa", p.empresa_id, { nombre });
    return { ok: true };
  },

  async unirme_a_empresa(p, userId) {
    await exigirPlataforma(userId);
    if (!esUuid(p.empresa_id)) throw new ErrorPublico("empresa inválida");
    const { data: ya } = await admin.from("miembros").select("id, activo").eq("empresa_id", p.empresa_id).eq("user_id", userId).maybeSingle();
    if (ya) {
      if (!ya.activo) await admin.from("miembros").update({ activo: true }).eq("id", ya.id);
    } else {
      const { error } = await admin.from("miembros").insert({ empresa_id: p.empresa_id, user_id: userId, rol: "admin", activo: true });
      if (error) throw error;
    }
    await bitacora(p.empresa_id, userId, "unirme_a_empresa", p.empresa_id, null);
    return { ok: true };
  },
};

async function exigirPlataforma(userId: string) {
  if (!(await esAdminPlataforma(userId))) throw new ErrorPublico("solo el administrador de la plataforma puede hacer esto", 403);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CABECERAS });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);
  try {
    const usuario = await autenticar(req);
    let cuerpo: Peticion;
    try { cuerpo = await req.json(); } catch { throw new ErrorPublico("json inválido"); }
    const accion = typeof cuerpo.accion === "string" ? acciones[cuerpo.accion] : undefined;
    if (!accion) throw new ErrorPublico("acción desconocida");
    return json(await accion(cuerpo, usuario.id));
  } catch (e) {
    if (e instanceof ErrorPublico) return json({ error: e.message }, e.estado);
    console.error("error en administrar", e instanceof Error ? e.message : e);
    return json({ error: "no se pudo completar la operación" }, 500);
  }
});
