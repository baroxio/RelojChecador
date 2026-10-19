// Reglas de quién puede gestionar a quién dentro de una empresa. Lógica pura, con pruebas.

export type Rol = "dueno" | "admin" | "supervisor" | "consulta";
export const ROLES: Rol[] = ["dueno", "admin", "supervisor", "consulta"];

export type Miembro = { id: string; user_id: string; rol: Rol; activo: boolean };

/** Roles que un usuario puede asignar al dar de alta o cambiar a otro. */
export function rolesAsignables(actor: Rol): Rol[] {
  if (actor === "dueno") return ["dueno", "admin", "supervisor", "consulta"];
  if (actor === "admin") return ["supervisor", "consulta"];
  return [];
}

/** ¿Puede el actor modificar (cambiar rol, dar de baja, reiniciar clave) a alguien con ese rol? */
export function puedeGestionar(actor: Rol, objetivo: Rol): boolean {
  if (actor === "dueno") return true;
  if (actor === "admin") return objetivo === "supervisor" || objetivo === "consulta";
  return false;
}

export function esRol(valor: unknown): valor is Rol {
  return typeof valor === "string" && (ROLES as string[]).includes(valor);
}

export function normalizarCorreo(correo: unknown): string {
  return String(correo ?? "").trim().toLowerCase();
}

export function correoValido(correo: string): boolean {
  return correo.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo);
}

// Sin 0, 1, I, O, l para que se pueda dictar o copiar sin confusiones.
const ALFABETO_CLAVE = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Clave temporal de 14 caracteres. Se muestra una sola vez y se pide cambiarla al entrar. */
export function generarClaveTemporal(longitud = 14): string {
  const limite = 256 - (256 % ALFABETO_CLAVE.length); // evita sesgo al reducir el byte aleatorio
  let clave = "";
  while (clave.length < longitud) {
    for (const b of crypto.getRandomValues(new Uint8Array(longitud * 2))) {
      if (b < limite && clave.length < longitud) clave += ALFABETO_CLAVE[b % ALFABETO_CLAVE.length];
    }
  }
  return clave;
}

function dueniosActivos(miembros: Miembro[]): Miembro[] {
  return miembros.filter((m) => m.rol === "dueno" && m.activo);
}

/** Devuelve el motivo por el que NO se puede cambiar el rol, o null si se puede. */
export function errorAlCambiarRol(p: {
  actor: Rol; actorUserId: string; objetivo: Miembro; nuevoRol: Rol; miembros: Miembro[];
}): string | null {
  if (p.objetivo.user_id === p.actorUserId) return "No puedes cambiar tu propio rol.";
  if (!puedeGestionar(p.actor, p.objetivo.rol)) return "No tienes permiso para cambiar el rol de esa persona.";
  if (!rolesAsignables(p.actor).includes(p.nuevoRol)) return "No tienes permiso para asignar ese rol.";
  const duenios = dueniosActivos(p.miembros);
  if (p.objetivo.rol === "dueno" && p.nuevoRol !== "dueno" && duenios.length <= 1) {
    return "La empresa debe tener al menos un dueño activo.";
  }
  return null;
}

/** Devuelve el motivo por el que NO se puede dar de baja (o reactivar), o null. */
export function errorAlCambiarActivo(p: {
  actor: Rol; actorUserId: string; objetivo: Miembro; activo: boolean; miembros: Miembro[];
}): string | null {
  if (p.objetivo.user_id === p.actorUserId) return "No puedes darte de baja a ti mismo.";
  if (!puedeGestionar(p.actor, p.objetivo.rol)) return "No tienes permiso para gestionar a esa persona.";
  if (!p.activo && p.objetivo.rol === "dueno" && p.objetivo.activo && dueniosActivos(p.miembros).length <= 1) {
    return "La empresa debe tener al menos un dueño activo.";
  }
  return null;
}

/** Valida los datos para dar de alta a un usuario. Devuelve el error o null. */
export function errorAlCrearUsuario(p: { actor: Rol; correo: string; nombre: string; rol: unknown }): string | null {
  if (!esRol(p.rol)) return "Elige un rol válido.";
  if (!rolesAsignables(p.actor).includes(p.rol)) return "No tienes permiso para dar de alta con ese rol.";
  if (!correoValido(p.correo)) return "Escribe un correo válido.";
  if (p.nombre.trim().length < 2) return "Escribe el nombre de la persona.";
  return null;
}
