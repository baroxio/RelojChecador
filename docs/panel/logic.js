// Lógica pura del panel (sin DOM ni red). Se prueba con: node --test docs/panel/logic.test.mjs

export const ETIQUETAS_SENALES = {
  secuencia_inusual: "Secuencia inusual (por ejemplo, dos entradas seguidas)",
  ubicacion_elegida: "La ubicación se eligió en el mapa",
  ubicacion_repetida: "Misma ubicación exacta en varios registros",
  foto_repetida: "La selfie es idéntica a una anterior",
  cambio_numero_reciente: "Cambió de teléfono hace poco",
  hora_desfasada: "El mensaje llegó con retraso",
  registro_diferido: "Se registró después de la hora que dijo el empleado (sin internet)",
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

// --- Roles (el servidor aplica las mismas reglas; aquí solo sirven para mostrar u ocultar opciones) ---

export const ETIQUETAS_ROL = { dueno: "Dueño", admin: "Administrador", supervisor: "Supervisor", consulta: "Consulta" };
export const DESCRIPCION_ROL = {
  dueno: "Todo en su empresa, incluido nombrar administradores.",
  admin: "Da de alta y baja empleados y usuarios (supervisores y consulta), geocercas y horarios.",
  supervisor: "Ve y corrige a los empleados de sus sedes.",
  consulta: "Solo ve la información.",
};

export function rolesAsignables(actor) {
  if (actor === "dueno") return ["dueno", "admin", "supervisor", "consulta"];
  if (actor === "admin") return ["supervisor", "consulta"];
  return [];
}

export function puedeGestionarRol(actor, objetivo) {
  if (actor === "dueno") return true;
  if (actor === "admin") return objetivo === "supervisor" || objetivo === "consulta";
  return false;
}

// --- Lugares (sedes y geocercas) ------------------------------------------

/** "20.6597, -103.3496" (como lo copia Google Maps) -> {lat, lng}, o null. */
export function parsearCoordenadas(texto) {
  const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(texto ?? ""));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}

/** Mensaje de error para una geocerca, o null si es válida. */
export function errorDeGeocerca({ lat, lng, radio }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return "Pon la ubicación con el botón de ubicación actual o pega las coordenadas, por ejemplo 20.6597, -103.3496.";
  }
  if (!Number.isInteger(radio) || radio < 10 || radio > 5000) return "El radio debe estar entre 10 y 5000 metros.";
  return null;
}

export const ZONAS_HORARIAS_MX = [
  ["America/Mexico_City", "Centro de México (CDMX, Guadalajara, Monterrey)"],
  ["America/Cancun", "Quintana Roo"],
  ["America/Chihuahua", "Chihuahua"],
  ["America/Hermosillo", "Sonora"],
  ["America/Mazatlan", "Sinaloa, Nayarit, BCS"],
  ["America/Tijuana", "Baja California"],
];

// --- Horarios -------------------------------------------------------------

export const NOMBRES_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ABREVIATURA_DIA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0]; // la semana laboral empieza en lunes

/** Valida los días de un horario: [{dia_semana, hora_entrada, hora_salida, minutos_pausa}]. */
export function errorDeHorario({ nombre, tolerancia_retardo_min, tolerancia_salida_min, dias }) {
  if (String(nombre ?? "").trim().length < 2) return "Ponle un nombre al horario, por ejemplo Oficina.";
  for (const t of [tolerancia_retardo_min, tolerancia_salida_min]) {
    if (!Number.isInteger(t) || t < 0 || t > 240) return "La tolerancia debe ser un número de minutos entre 0 y 240.";
  }
  if (!dias.length) return "Marca al menos un día de trabajo.";
  for (const d of dias) {
    const nombreDia = NOMBRES_DIA[d.dia_semana];
    if (!/^\d{2}:\d{2}/.test(d.hora_entrada ?? "") || !/^\d{2}:\d{2}/.test(d.hora_salida ?? "")) return `Falta la hora del ${nombreDia}.`;
    if (d.hora_entrada.slice(0, 5) === d.hora_salida.slice(0, 5)) return `La entrada y la salida del ${nombreDia} no pueden ser la misma hora.`;
    if (!Number.isInteger(d.minutos_pausa) || d.minutos_pausa < 0 || d.minutos_pausa > 240) return `La pausa del ${nombreDia} debe ser de 0 a 240 minutos.`;
  }
  return null;
}

/** "Lun–Vie 09:00–18:00 · Sáb 09:00–14:00" */
export function resumenHorario(dias) {
  const porDia = new Map();
  for (const d of dias) {
    const t = `${String(d.hora_entrada).slice(0, 5)}–${String(d.hora_salida).slice(0, 5)}`;
    porDia.set(d.dia_semana, [...(porDia.get(d.dia_semana) ?? []), t].join(" y "));
  }
  const tramos = [];
  for (const dia of ORDEN_SEMANA) {
    if (!porDia.has(dia)) continue;
    const ultimo = tramos.at(-1);
    if (ultimo && ultimo.texto === porDia.get(dia) && ultimo.siguiente === dia) { ultimo.fin = dia; ultimo.siguiente = ORDEN_SEMANA[ORDEN_SEMANA.indexOf(dia) + 1]; }
    else tramos.push({ inicio: dia, fin: dia, texto: porDia.get(dia), siguiente: ORDEN_SEMANA[ORDEN_SEMANA.indexOf(dia) + 1] });
  }
  return tramos
    .map((t) => `${t.inicio === t.fin ? ABREVIATURA_DIA[t.inicio] : `${ABREVIATURA_DIA[t.inicio]}–${ABREVIATURA_DIA[t.fin]}`} ${t.texto}`)
    .join(" · ");
}

/**
 * Qué hacer con las asignaciones de horario de un empleado para que desde `hoy` rija una nueva.
 * asignaciones: [{id, vigencia}]. Devuelve { borrar: [id], cerrar: [{id, desde}] }:
 * las que empezaron hoy o después se borran; las vigentes se cierran hoy (el límite superior es exclusivo).
 */
export function planearCambioHorario(asignaciones, hoy) {
  const borrar = [];
  const cerrar = [];
  for (const a of asignaciones) {
    const v = parsearVigencia(a.vigencia);
    if (!v) continue;
    if (v.hasta && v.hasta <= hoy) continue; // ya terminó
    if (!v.desde || v.desde >= hoy) borrar.push(a.id);
    else cerrar.push({ id: a.id, desde: v.desde });
  }
  return { borrar, cerrar };
}

// --- Reportes --------------------------------------------------------------

const MAX_DIAS_REPORTE = 62;
const HORAS_JORNADA_MAXIMA = 18; // una entrada sin salida pasado este tiempo se da por abierta

export function sumarDias(fechaStr, n) {
  const [y, m, d] = fechaStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Todas las fechas 'YYYY-MM-DD' de desde a hasta, incluidas. */
export function rangoDeFechas(desde, hasta) {
  const fechas = [];
  for (let f = desde; f <= hasta && fechas.length <= MAX_DIAS_REPORTE; f = sumarDias(f, 1)) fechas.push(f);
  return fechas;
}

export const PERIODOS = [
  ["semana", "Esta semana"],
  ["semana_pasada", "Semana pasada"],
  ["quincena", "Esta quincena"],
  ["mes", "Este mes"],
  ["mes_pasado", "Mes pasado"],
  ["personalizado", "Elegir fechas"],
];

function ultimoDiaDelMes(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Periodo predefinido {desde, hasta} (fechas locales) calculado desde `hoy`. La semana empieza en lunes. */
export function periodoPredefinido(clave, hoy) {
  const [y, m, d] = hoy.split("-").map(Number);
  const mes2 = (n) => String(n).padStart(2, "0");
  const diasDesdeLunes = (diaSemana(hoy) + 6) % 7;
  switch (clave) {
    case "semana": return { desde: sumarDias(hoy, -diasDesdeLunes), hasta: hoy };
    case "semana_pasada": {
      const lunes = sumarDias(hoy, -diasDesdeLunes - 7);
      return { desde: lunes, hasta: sumarDias(lunes, 6) };
    }
    case "quincena": return d <= 15
      ? { desde: `${y}-${mes2(m)}-01`, hasta: hoy }
      : { desde: `${y}-${mes2(m)}-16`, hasta: hoy };
    case "mes": return { desde: `${y}-${mes2(m)}-01`, hasta: hoy };
    case "mes_pasado": {
      const ma = m === 1 ? 12 : m - 1;
      const ya = m === 1 ? y - 1 : y;
      return { desde: `${ya}-${mes2(ma)}-01`, hasta: `${ya}-${mes2(ma)}-${ultimoDiaDelMes(ya, ma)}` };
    }
    default: return null;
  }
}

/** Error de un periodo elegido a mano, o null. */
export function errorDePeriodo(desde, hasta) {
  const ok = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f ?? "");
  if (!ok(desde) || !ok(hasta)) return "Elige la fecha de inicio y la de fin.";
  if (hasta < desde) return "La fecha de fin no puede ser anterior a la de inicio.";
  if (rangoDeFechas(desde, hasta).length > MAX_DIAS_REPORTE) return `El periodo no puede pasar de ${MAX_DIAS_REPORTE} días.`;
  return null;
}

/**
 * Arma las jornadas de un empleado a partir de sus registros ordenados.
 * Una jornada empieza en una entrada y termina en la siguiente salida; las pausas se descuentan.
 * Cada jornada pertenece al día local de su entrada (un turno nocturno cuenta el día en que empezó).
 * Devuelve { jornadas, sueltos }: sueltos son registros que no pertenecen a ninguna jornada
 * (por ejemplo, una salida sin entrada).
 */
export function armarJornadas(registros, tz, ahora) {
  const orden = registros
    .map((r) => ({ ...r, instante: new Date(r.hora_efectiva) }))
    .sort((a, b) => a.instante - b.instante);
  const jornadas = [];
  const sueltos = [];
  let j = null;
  const cerrar = (abierta) => {
    if (!j) return;
    j.abierta = abierta;
    jornadas.push(j);
    j = null;
  };
  for (const r of orden) {
    if (j && r.instante - j.entrada.instante > HORAS_JORNADA_MAXIMA * 3600_000) cerrar(true);
    if (r.tipo === "entrada") {
      if (j) cerrar(true); // dos entradas seguidas: la primera quedó sin salida
      j = { entrada: r, salida: null, pausaMs: 0, pausaDesde: null, registros: [r], fecha: fechaLocal(r.instante, tz) };
    } else if (!j) {
      sueltos.push(r);
    } else {
      j.registros.push(r);
      if (r.tipo === "pausa_inicio") j.pausaDesde = r.instante;
      else if (r.tipo === "pausa_fin" && j.pausaDesde) { j.pausaMs += r.instante - j.pausaDesde; j.pausaDesde = null; }
      else if (r.tipo === "salida") {
        if (j.pausaDesde) { j.pausaMs += r.instante - j.pausaDesde; j.pausaDesde = null; }
        j.salida = r;
        cerrar(false);
      }
    }
  }
  if (j) {
    // Sin salida: sigue en turno si es reciente; si no, quedó abierta.
    const reciente = ahora - j.entrada.instante < HORAS_JORNADA_MAXIMA * 3600_000;
    cerrar(!reciente);
    jornadas.at(-1).enCurso = reciente;
    jornadas.at(-1).abierta = !reciente;
  }
  for (const x of jornadas) {
    x.minutos = x.salida ? Math.max(0, Math.round((x.salida.instante - x.entrada.instante - x.pausaMs) / 60000)) : null;
    x.pausaMin = Math.round(x.pausaMs / 60000);
  }
  return { jornadas, sueltos };
}

export const ETIQUETA_ESTADO_DIA = {
  asistio: "Asistió",
  retardo: "Retardo",
  falta: "Falta",
  descanso: "Descanso",
  descanso_trabajado: "Trabajó en descanso",
  sin_alta: "Fuera de alta",
  sin_horario: "Sin horario",
  pendiente: "Por llegar",
  en_curso: "En turno",
  incompleto: "Sin salida",
};

/**
 * Reporte de asistencia por periodo.
 * - empleados: filas de empleados. registros: filas de registros_efectivos (con margen de un día por lado).
 * - desde/hasta: fechas locales. ahora: Date. datos: { horarios, horarioDias, empleadoHorarios }.
 * Devuelve { fechas, filas } con una fila por empleado: { empleado, dias: [...], totales }.
 * Un día sin registros cuenta como falta solo si el empleado tenía horario laboral ese día, ya había
 * ingresado y no estaba dado de baja; el de hoy queda "por llegar" hasta una hora después de su entrada.
 */
export function reporteAsistencia({ empleados, registros, desde, hasta, ahora, tzPorSede, datos = {} }) {
  const fechas = rangoDeFechas(desde, hasta);
  const porEmpleado = new Map();
  for (const r of registros) {
    if (!porEmpleado.has(r.empleado_id)) porEmpleado.set(r.empleado_id, []);
    porEmpleado.get(r.empleado_id).push(r);
  }
  const filas = [];
  for (const emp of empleados) {
    const propios = porEmpleado.get(emp.id) ?? [];
    const tz = tzPorSede[emp.sede_id] ?? "America/Mexico_City";
    const { jornadas, sueltos } = armarJornadas(propios, tz, ahora);
    const enPeriodo = jornadas.filter((x) => x.fecha >= desde && x.fecha <= hasta);
    const sueltosPeriodo = sueltos.filter((r) => { const f = fechaLocal(r.instante, tz); return f >= desde && f <= hasta; });
    if (emp.estado === "invitado" && !enPeriodo.length) continue;
    if (emp.estado === "baja" && !enPeriodo.length && !sueltosPeriodo.length) continue;
    const hoy = fechaLocal(ahora, tz);
    const ingreso = emp.fecha_ingreso ?? (emp.creado_at ? fechaLocal(new Date(emp.creado_at), tz) : null);
    const baja = emp.fecha_baja ?? null;
    const dias = fechas.map((fecha) => {
      const delDia = enPeriodo.filter((x) => x.fecha === fecha);
      const horario = horarioDelDia(emp.id, fecha, datos);
      const dia = { fecha, estado: null, entrada: null, salida: null, minutos: 0, retardoMin: 0, jornadas: delDia, sueltos: sueltosPeriodo.filter((r) => fechaLocal(r.instante, tz) === fecha), senales: [], corregido: false, horario };
      if (delDia.length) {
        const primera = delDia[0];
        dia.entrada = horaLocal(primera.entrada.instante, tz);
        const ultima = delDia.at(-1);
        dia.salida = ultima.salida ? horaLocal(ultima.salida.instante, tz) : null;
        dia.minutos = delDia.reduce((s, x) => s + (x.minutos ?? 0), 0);
        dia.retardoMin = minutosDeRetardo(dia.entrada, horario);
        dia.senales = [...new Set(delDia.flatMap((x) => x.registros.flatMap((r) => r.senales ?? [])))];
        dia.corregido = delDia.some((x) => x.registros.some((r) => r.corregido));
        if (delDia.some((x) => x.enCurso)) dia.estado = "en_curso";
        else if (delDia.some((x) => x.abierta)) dia.estado = "incompleto";
        else if (horario && !horario.laboral) dia.estado = "descanso_trabajado";
        else dia.estado = dia.retardoMin > 0 ? "retardo" : "asistio";
      } else if (!horario) {
        dia.estado = "sin_horario";
      } else if (!horario.laboral) {
        dia.estado = "descanso";
      } else if (fecha > hoy) {
        dia.estado = "pendiente";
      } else if ((ingreso && fecha < ingreso) || (baja && fecha >= baja)) {
        dia.estado = "sin_alta"; // fuera de su relación laboral: no cuenta como falta
      } else if (fecha === hoy) {
        // Hoy solo es falta una hora después de la entrada esperada.
        const limite = aMinutos(horario.entradas[0] ?? "00:00") + 60;
        dia.estado = minutosDelDia(ahora, tz) < limite ? "pendiente" : "falta";
      } else {
        dia.estado = "falta";
      }
      return dia;
    });
    const cuenta = (e) => dias.filter((d) => d.estado === e).length;
    const conRetardo = dias.filter((d) => d.retardoMin > 0);
    const totales = {
      asistencias: dias.filter((d) => ["asistio", "retardo", "descanso_trabajado", "en_curso", "incompleto"].includes(d.estado)).length,
      faltas: cuenta("falta"),
      retardos: conRetardo.length,
      minutosRetardo: conRetardo.reduce((s, d) => s + d.retardoMin, 0),
      minutos: dias.reduce((s, d) => s + d.minutos, 0),
      sinSalida: cuenta("incompleto"),
      descansosTrabajados: cuenta("descanso_trabajado"),
      sinHorario: cuenta("sin_horario"),
      corregidos: dias.filter((d) => d.corregido).length,
      conSenales: dias.filter((d) => d.senales.length).length,
    };
    filas.push({ empleado: emp, tz, dias, totales });
  }
  filas.sort((a, b) => a.empleado.nombre.localeCompare(b.empleado.nombre, "es"));
  return { fechas, filas };
}

/** Suma de totales de varias filas (para el encabezado del reporte). */
export function totalesGenerales(filas) {
  const t = { empleados: filas.length, asistencias: 0, faltas: 0, retardos: 0, minutos: 0, sinSalida: 0 };
  for (const f of filas) {
    t.asistencias += f.totales.asistencias; t.faltas += f.totales.faltas; t.retardos += f.totales.retardos;
    t.minutos += f.totales.minutos; t.sinSalida += f.totales.sinSalida;
  }
  return t;
}

/** "42 h 30 min" o "—" si no hay minutos. Para tablas y CSV. */
export function formatearHoras(minutos) {
  if (!minutos) return "0 h";
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
}

/** Horas como decimal con 2 cifras (para nómina y hojas de cálculo). */
export function horasDecimales(minutos) {
  return (minutos / 60).toFixed(2);
}

/** Texto seguro para una celda CSV: comillas dobles y protección contra fórmulas de hoja de cálculo. */
export function celdaCSV(valor) {
  let t = valor === null || valor === undefined ? "" : String(valor);
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t)) t = `'${t}`;
  return /[",\n\r;]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

/** CSV con BOM, para que Excel lo abra con acentos. Separador coma. */
export function aCSV(encabezados, filas) {
  const lineas = [encabezados, ...filas].map((fila) => fila.map(celdaCSV).join(","));
  return "﻿" + lineas.join("\r\n") + "\r\n";
}

export function filasCSVResumen(reporte, nombreSede) {
  return reporte.filas.map((f) => [
    f.empleado.num_empleado ?? "", f.empleado.nombre, nombreSede(f.empleado.sede_id),
    f.totales.asistencias, f.totales.faltas, f.totales.retardos, f.totales.minutosRetardo,
    f.totales.descansosTrabajados, f.totales.sinSalida, horasDecimales(f.totales.minutos),
  ]);
}
export const ENCABEZADOS_CSV_RESUMEN = ["Núm. empleado", "Empleado", "Sede", "Asistencias", "Faltas", "Retardos", "Minutos de retardo", "Descansos trabajados", "Días sin salida", "Horas trabajadas"];

export function filasCSVDetalle(reporte, nombreSede) {
  const filas = [];
  for (const f of reporte.filas) {
    for (const d of f.dias) {
      if (d.estado === "pendiente") continue;
      filas.push([
        d.fecha, f.empleado.num_empleado ?? "", f.empleado.nombre, nombreSede(f.empleado.sede_id),
        ETIQUETA_ESTADO_DIA[d.estado] ?? d.estado, d.entrada ?? "", d.salida ?? "",
        d.retardoMin || "", horasDecimales(d.minutos), d.corregido ? "Sí" : "",
        d.senales.map(etiquetaSenal).join("; "),
      ]);
    }
  }
  return filas;
}
export const ENCABEZADOS_CSV_DETALLE = ["Fecha", "Núm. empleado", "Empleado", "Sede", "Estado", "Entrada", "Salida", "Minutos de retardo", "Horas trabajadas", "Con corrección", "Señales"];

// --- Edición de empleados --------------------------------------------------

/**
 * Valida y normaliza el formulario de un empleado.
 * Devuelve { errores: {nombre?, telefono?, sede?, fecha?}, valores }; sin errores si todo está bien.
 */
export function validarDatosEmpleado({ nombre, telefono, sede_id, num_empleado, fecha_ingreso }) {
  const errores = {};
  const nom = String(nombre ?? "").trim().replace(/\s+/g, " ");
  if (nom.length < 2) errores.nombre = "Escribe el nombre del empleado.";
  const tel = normalizarTelefonoMx(telefono);
  if (!tel) errores.telefono = "Escribe un celular de 10 dígitos, por ejemplo 33 1234 5678.";
  if (!sede_id) errores.sede = "Elige la sede.";
  const num = String(num_empleado ?? "").trim() || null;
  const ing = String(fecha_ingreso ?? "").trim() || null;
  if (ing && (!/^\d{4}-\d{2}-\d{2}$/.test(ing) || Number.isNaN(Date.parse(ing)))) errores.fecha = "La fecha de ingreso no es válida.";
  return { errores, valores: { nombre: nom, telefono: tel, sede_id: sede_id || null, num_empleado: num, fecha_ingreso: ing } };
}

const CAMPOS_EMPLEADO = ["nombre", "telefono", "sede_id", "num_empleado", "fecha_ingreso"];

/** Solo los campos que cambiaron: lo que se manda a actualizar. Vacío si no hay cambios. */
export function diferenciasEmpleado(actual, valores) {
  const diff = {};
  for (const k of CAMPOS_EMPLEADO) {
    if ((actual[k] ?? null) !== (valores[k] ?? null)) diff[k] = valores[k] ?? null;
  }
  return diff;
}
