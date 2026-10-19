// Lógica pura del panel (sin DOM ni red). Se prueba con: node --test docs/panel/logic.test.mjs

export const ETIQUETAS_SENALES = {
  secuencia_inusual: "Secuencia inusual (por ejemplo, dos entradas seguidas)",
  ubicacion_elegida: "La ubicación se eligió en el mapa",
  ubicacion_repetida: "Misma ubicación exacta en varios registros",
  foto_repetida: "La selfie es idéntica a una anterior",
  cambio_numero_reciente: "Cambió de teléfono hace poco",
  hora_desfasada: "El mensaje llegó con retraso",
};

export const ETIQUETAS_TIPO = {
  entrada: "Entrada",
  salida: "Salida",
  pausa_inicio: "Inicio de pausa",
  pausa_fin: "Fin de pausa",
};

export const TIPO_CORTO = { entrada: "ENT", salida: "SAL", pausa_inicio: "PAU", pausa_fin: "REG" };

export function etiquetaSenal(clave) {
  return ETIQUETAS_SENALES[clave] ?? clave.replaceAll("_", " ");
}

// --- Teléfonos -------------------------------------------------------------

/** Devuelve +52 y 10 dígitos, o null si no es un número mexicano válido. */
export function normalizarTelefonoMx(texto) {
  const d = String(texto ?? "").replace(/\D/g, "");
  if (d.length === 10) return "+52" + d;
  if (d.length === 12 && d.startsWith("52")) return "+" + d;
  if (d.length === 13 && d.startsWith("521")) return "+52" + d.slice(3);
  return null;
}

export function formatearTelefono(e164) {
  const m = /^\+52(\d{2})(\d{4})(\d{4})$/.exec(e164 ?? "");
  return m ? `+52 ${m[1]} ${m[2]} ${m[3]}` : (e164 ?? "");
}

export function iniciales(nombre) {
  const partes = String(nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  const a = partes[0][0];
  const b = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (a + b).toUpperCase();
}

// --- Fechas y zonas horarias ----------------------------------------------

export function partesLocales(fecha, tz) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const o = {};
  for (const p of f.formatToParts(fecha)) o[p.type] = p.value;
  return o;
}

export function fechaLocal(fecha, tz) {
  const o = partesLocales(fecha, tz);
  return `${o.year}-${o.month}-${o.day}`;
}

export function horaLocal(fecha, tz) {
  const o = partesLocales(fecha, tz);
  return `${o.hour}:${o.minute}`;
}

export function minutosDelDia(fecha, tz) {
  const o = partesLocales(fecha, tz);
  return Number(o.hour) * 60 + Number(o.minute);
}

/** Día de la semana de una fecha local 'YYYY-MM-DD': 0 = domingo ... 6 = sábado. */
export function diaSemana(fechaStr) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Instante UTC cuya hora en `tz` es fechaStr + horaStr ('08:15'). */
export function aUTCdesdeLocal(fechaStr, horaStr, tz) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  const [hh, mm] = horaStr.split(":").map(Number);
  const objetivo = Date.UTC(y, m - 1, d, hh, mm);
  let utc = objetivo;
  for (let i = 0; i < 3; i++) {
    const o = partesLocales(new Date(utc), tz);
    const comoUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute);
    const diff = comoUtc - objetivo;
    if (diff === 0) break;
    utc -= diff;
  }
  return new Date(utc);
}

function aMinutos(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

// --- Horarios y retardos --------------------------------------------------

/** Rango tipo "[2026-10-01,)" o "[2026-10-01,2026-12-31)" -> {desde, hasta|null}. */
export function parsearVigencia(texto) {
  const m = /^[\[(]([^,]*),([^\])]*)[\])]$/.exec(String(texto ?? "").trim());
  if (!m) return null;
  return { desde: m[1] || null, hasta: m[2] || null };
}

function vigenteEn(vigencia, fechaStr) {
  const v = parsearVigencia(vigencia);
  if (!v) return false;
  if (v.desde && fechaStr < v.desde) return false;
  if (v.hasta && fechaStr >= v.hasta) return false; // el límite superior es exclusivo
  return true;
}

/**
 * Horario esperado de un empleado en una fecha local.
 * Devuelve { laboral: boolean, entradas: ['08:00', ...], tolerancia } o null si no hay horario.
 */
export function horarioDelDia(empleadoId, fechaStr, datos) {
  const asignacion = (datos.empleadoHorarios ?? []).find(
    (a) => a.empleado_id === empleadoId && vigenteEn(a.vigencia, fechaStr),
  );
  if (!asignacion) return null;
  const horario = (datos.horarios ?? []).find((h) => h.id === asignacion.horario_id);
  if (!horario) return null;
  const dia = diaSemana(fechaStr);
  const dias = (datos.horarioDias ?? []).filter((d) => d.horario_id === horario.id && d.dia_semana === dia);
  return {
    laboral: dias.length > 0,
    entradas: dias.map((d) => String(d.hora_entrada).slice(0, 5)).sort(),
    tolerancia: horario.tolerancia_retardo_min ?? 0,
  };
}

/** Minutos de retardo (> 0) de una entrada local 'HH:MM' contra el horario, o 0. */
export function minutosDeRetardo(entradaHHMM, horario) {
  if (!horario?.laboral || !horario.entradas.length) return 0;
  const e = aMinutos(entradaHHMM);
  // La entrada esperada es la más cercana (la jornada partida tiene varias).
  const esperada = horario.entradas
    .map(aMinutos)
    .reduce((mejor, x) => (Math.abs(x - e) < Math.abs(mejor - e) ? x : mejor));
  const retraso = e - esperada;
  return retraso > horario.tolerancia ? retraso : 0;
}

// --- Resumen del día -------------------------------------------------------

const HORAS_TURNO_NOCTURNO = 18;

/**
 * Agrupa a los empleados activos según su situación hoy.
 * registros: filas de registros_efectivos. datos: horarios, horarioDias, empleadoHorarios.
 */
export function resumenDelDia(empleados, registros, ahora, tzPorSede, datos = {}) {
  const porEmpleado = new Map();
  for (const r of registros) {
    if (!porEmpleado.has(r.empleado_id)) porEmpleado.set(r.empleado_id, []);
    porEmpleado.get(r.empleado_id).push(r);
  }
  const filas = [];
  for (const emp of empleados) {
    if (emp.estado !== "activo") continue;
    const tz = tzPorSede[emp.sede_id] ?? "America/Mexico_City";
    const hoy = fechaLocal(ahora, tz);
    const propios = (porEmpleado.get(emp.id) ?? [])
      .map((r) => ({ ...r, instante: new Date(r.hora_efectiva) }))
      .sort((a, b) => a.instante - b.instante);
    const deHoy = propios.filter((r) => fechaLocal(r.instante, tz) === hoy);
    const horario = horarioDelDia(emp.id, hoy, datos);

    let grupo;
    let desdeAyer = false;
    let ultimo = deHoy.at(-1) ?? null;
    if (deHoy.length === 0) {
      // Turno nocturno: una entrada de ayer sin salida sigue abierta.
      const previo = propios.filter((r) => ahora - r.instante < HORAS_TURNO_NOCTURNO * 3600_000).at(-1);
      if (previo && previo.tipo !== "salida") {
        ultimo = previo;
        desdeAyer = true;
        grupo = previo.tipo === "pausa_inicio" ? "en_pausa" : "en_turno";
      } else if (horario && !horario.laboral) {
        grupo = "descanso";
      } else if (horario && horario.entradas.length && minutosDelDia(ahora, tz) < aMinutos(horario.entradas[0])) {
        grupo = "por_llegar";
      } else {
        grupo = "faltan";
      }
    } else if (ultimo.tipo === "salida") {
      grupo = "salieron";
    } else if (ultimo.tipo === "pausa_inicio") {
      grupo = "en_pausa";
    } else {
      grupo = "en_turno";
    }

    const primeraEntrada = deHoy.find((r) => r.tipo === "entrada");
    const retardo = primeraEntrada
      ? minutosDeRetardo(horaLocal(primeraEntrada.instante, tz), horario)
      : 0;
    const senales = [...new Set(deHoy.flatMap((r) => r.senales ?? []))];
    filas.push({ empleado: emp, grupo, registros: deHoy, ultimo, desdeAyer, retardo, senales, horario, tz });
  }
  return filas;
}

export const ORDEN_GRUPOS = ["faltan", "por_llegar", "en_turno", "en_pausa", "salieron", "descanso"];
export const TITULO_GRUPO = {
  faltan: "Faltan",
  por_llegar: "Aún no es su hora",
  en_turno: "En turno",
  en_pausa: "En pausa",
  salieron: "Ya salieron",
  descanso: "Descansan hoy",
};

export function contarGrupos(filas) {
  const c = {};
  for (const f of filas) c[f.grupo] = (c[f.grupo] ?? 0) + 1;
  return c;
}

/** "12 min", "1 h 05 min" */
export function formatearDuracion(minutos) {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
}

export function formatearDistancia(metros) {
  if (!Number.isFinite(metros) || metros < 0) return "distancia desconocida";
  if (metros < 1000) return `${Math.round(metros)} m`;
  const km = metros / 1000;
  return `${km >= 100 ? Math.round(km) : km.toFixed(1)} km`;
}

/** Enlace de WhatsApp al empleado con el mensaje de invitación listo. */
export function enlaceMensajeEmpleado(telefonoE164, nombre, enlaceInvitacion) {
  const numero = String(telefonoE164 ?? "").replace(/\D/g, "");
  const primerNombre = String(nombre ?? "").trim().split(/\s+/)[0] || "";
  const texto =
    `Hola ${primerNombre}, para registrar tu asistencia por WhatsApp toca este enlace y envía el mensaje que aparece: ${enlaceInvitacion}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/** Enlace de mapa para unas coordenadas. */
export function enlaceMapa(lat, lng) {
  return `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`;
}
