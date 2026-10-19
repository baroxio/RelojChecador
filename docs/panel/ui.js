// Interfaz del panel. Todo texto que viene de la base se inserta con textContent (nunca innerHTML),
// y el único innerHTML es el de los iconos, que son constantes de este archivo.
import {
  ETIQUETAS_TIPO, ORDEN_GRUPOS, TIPO_CORTO, TITULO_GRUPO, aUTCdesdeLocal, contarGrupos, enlaceMapa,
  enlaceMensajeEmpleado, etiquetaSenal, fechaLocal, formatearDistancia, formatearDuracion,
  formatearTelefono, horaLocal, iniciales, normalizarTelefonoMx, resumenDelDia,
  DESCRIPCION_ROL, rolesAsignables, puedeGestionarRol,
  NOMBRES_DIA, ZONAS_HORARIAS_MX, errorDeGeocerca, errorDeHorario, parsearCoordenadas, parsearVigencia, planearCambioHorario, resumenHorario,
} from "./logic.js";

const SVG = (d, relleno = false) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="${relleno ? "currentColor" : "none"}" stroke="${relleno ? "none" : "currentColor"}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;

const ICONOS = {
  hoy: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  equipo: SVG('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.6c2.4.2 4 1.9 4 4.4"/>'),
  correcciones: SVG('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14 7l3 3"/>'),
  mas: SVG('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>', true),
  agregar: SVG('<path d="M12 5v14M5 12h14"/>'),
  copiar: SVG('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>'),
  enviar: SVG('<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>'),
  camara: SVG('<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>'),
  mapa: SVG('<path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  flecha: SVG('<path d="M6 9l6 6 6-6"/>'),
  refrescar: SVG('<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 5v6h-6"/>'),
  administrar: SVG('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
  usuario: SVG('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>'),
  salir: SVG('<path d="M10 4H5v16h5"/><path d="M15 8l4 4-4 4M19 12H9"/>'),
};

function icono(nombre) {
  const t = document.createElement("template");
  t.innerHTML = ICONOS[nombre];
  return t.content.firstChild;
}

function h(tag, props = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of hijos.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const CANALES = { whatsapp: "WhatsApp", web: "Web", app: "App", kiosco: "Kiosco", manual: "Registro manual" };
const ROLES = { dueno: "Dueño", admin: "Administrador", supervisor: "Supervisor", consulta: "Consulta" };
const ETIQUETA_ESTADO = { invitado: "Invitado", activo: "Activo", baja: "Baja" };

export function iniciarApp({ sb, url, key, raiz, avisos }) {
  const estado = { sesion: null, miembro: null, empresa: null, membresias: [], plataforma: false, sedes: [], sedeFiltro: "todas", ruta: 0, pendientes: 0 };
  let temporizador = null;

  // ---------- Utilidades ----------
  const q = async (promesa) => {
    const { data, error } = await promesa;
    if (error) throw error;
    return data;
  };
  const tzPorSede = () => Object.fromEntries(estado.sedes.map((s) => [s.id, s.zona_horaria]));
  const nombreSede = (id) => estado.sedes.find((s) => s.id === id)?.nombre ?? "";
  const puedeAdministrar = () => ["dueno", "admin"].includes(estado.miembro?.rol);
  const eid = () => estado.miembro.empresa_id;
  const puedeResolver = () => ["dueno", "admin", "supervisor"].includes(estado.miembro?.rol);

  function nombreUsuario() {
    const m = estado.sesion?.user?.user_metadata ?? {};
    const dado = m.nombre || m.full_name || m.name;
    if (dado) return String(dado).trim();
    // Sin nombre guardado: se arma uno legible con la parte del correo antes de la @.
    const base = (estado.sesion?.user?.email ?? "").split("@")[0] || "Usuario";
    return base.replace(/[._-]+/g, " ").replace(/(^|\s)(\p{L})/gu, (_, e, c) => e + c.toUpperCase());
  }
  const esErrorDeRed = (err) => !navigator.onLine || /Failed to fetch|NetworkError|Load failed/i.test(String(err?.message ?? err ?? ""));
  function guardarCache(clave, datos) {
    try { localStorage.setItem(clave, JSON.stringify({ guardado: Date.now(), datos })); } catch { /* sin almacenamiento: no pasa nada */ }
  }
  function leerCache(clave) {
    try { return JSON.parse(localStorage.getItem(clave) ?? "null"); } catch { return null; }
  }
  function borrarCaches() {
    try { Object.keys(localStorage).filter((k) => k.startsWith("rc:")).forEach((k) => localStorage.removeItem(k)); } catch { /* nada */ }
  }

  function avisar(texto, tipo = "ok") {
    if (!avisos) return;
    const el = h("div", { class: `aviso-flotante${tipo === "error" ? " aviso-flotante--error" : ""}` }, texto);
    avisos.append(el);
    setTimeout(() => el.remove(), 4500);
  }

  function mensajeDeError(err) {
    const m = String(err?.message ?? err ?? "");
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Sin conexión. Revisa tu internet e intenta de nuevo.";
    if (err?.code === "23505") return "Ya existe un registro igual (por ejemplo, ese teléfono en tu empresa).";
    if (err?.code === "42501" || /row-level security|permission denied/i.test(m)) return "No tienes permiso para hacer esto.";
    return m || "Algo salió mal. Intenta de nuevo.";
  }

  function esqueletos(n = 4) {
    return h("ul", { class: "lista", "aria-hidden": "true" }, Array.from({ length: n }, () => h("li", { class: "esqueleto" })));
  }

  function bloqueError(err, reintentar) {
    return h("div", { class: "vacio" },
      h("div", { class: "aviso-bloque aviso-bloque--error" }, mensajeDeError(err)),
      reintentar && h("button", { class: "boton boton--secundario", type: "button", onclick: reintentar }, "Reintentar"));
  }

  const fechaLarga = (fecha, tz) =>
    new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(fecha);
  const fechaCorta = (fecha, tz) =>
    new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(fecha).replace(".", "");

  function sello(tipo, hora, { retardo = false, corregido = false, vacio = false } = {}) {
    return h("span", { class: `sello sello--${tipo}${retardo ? " sello--retardo" : ""}${corregido ? " sello--corregido" : ""}${vacio ? " sello--vacio" : ""}`, "aria-label": vacio ? "Sin registro" : null },
      h("span", { class: "sello__tipo" }, TIPO_CORTO[tipo] ?? tipo),
      h("span", { class: "sello__hora" }, hora));
  }

  // ---------- Pantallas de acceso ----------
  function pantallaSinConfigurar() {
    raiz.replaceChildren(h("div", { class: "acceso" }, h("div", { class: "acceso__caja" },
      h("h1", {}, "Falta configurar el panel"),
      h("p", {}, "Pega la clave publicable de Supabase en docs/panel/config.js y vuelve a publicar. Es la clave pública (no la secreta)."))));
  }

  function pantallaAcceso(mensaje) {
    const correo = h("input", { class: "entrada", id: "correo", type: "email", autocomplete: "username", required: true, inputmode: "email" });
    const clave = h("input", { class: "entrada", id: "clave", type: "password", autocomplete: "current-password", required: true });
    const error = h("div", { class: "aviso-bloque aviso-bloque--error", role: "alert", hidden: !mensaje }, mensaje ?? "");
    const boton = h("button", { class: "boton boton--primario boton--ancho", type: "submit" }, "Entrar");
    const form = h("form", { class: "acceso__caja", novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        if (!correo.value.trim() || !clave.value) { error.textContent = "Escribe tu correo y tu contraseña."; error.hidden = false; return; }
        boton.setAttribute("aria-busy", "true"); boton.disabled = true;
        const { error: err } = await sb.auth.signInWithPassword({ email: correo.value.trim(), password: clave.value });
        boton.removeAttribute("aria-busy"); boton.disabled = false;
        if (err) { error.textContent = "Correo o contraseña incorrectos."; error.hidden = false; clave.value = ""; clave.focus(); return; }
        await arrancarConSesion();
      } },
      h("div", { class: "marca" }, icono("hoy"), "RelojChecador"),
      h("div", {}, h("h1", {}, "Entrar al panel"), h("p", {}, "Usa el correo con el que te dieron acceso.")),
      error,
      h("div", { class: "campo" }, h("label", { for: "correo" }, "Correo"), correo),
      h("div", { class: "campo" }, h("label", { for: "clave" }, "Contraseña"), clave),
      boton);
    raiz.replaceChildren(h("div", { class: "acceso" }, form));
    correo.focus();
  }

  function pantallaSinAcceso(correoUsuario) {
    raiz.replaceChildren(h("div", { class: "acceso" }, h("div", { class: "acceso__caja" },
      h("h1", {}, "Tu usuario no tiene empresa asignada"),
      h("p", {}, `Entraste como ${correoUsuario}, pero todavía no te agregan a ninguna empresa. Pide al dueño que te dé acceso.`),
      h("button", { class: "boton boton--secundario", type: "button", onclick: cerrarSesion }, "Cerrar sesión"))));
  }

  function formularioClave({ alListo, boton = "Guardar contraseña" }) {
    const nueva = h("input", { class: "entrada", id: "cl-nueva", type: "password", autocomplete: "new-password", required: true });
    const repetir = h("input", { class: "entrada", id: "cl-rep", type: "password", autocomplete: "new-password", required: true });
    const error = h("div", { class: "error-campo", role: "alert", hidden: true });
    const guardar = h("button", { class: "boton boton--primario", type: "submit" }, boton);
    return h("form", { class: "formulario", novalidate: true,
      onsubmit: async (ev) => {
        ev.preventDefault(); error.hidden = true;
        const falla = (t) => { error.textContent = t; error.hidden = false; };
        if (nueva.value.length < 8) return falla("Usa al menos 8 caracteres.");
        if (nueva.value !== repetir.value) return falla("Las contraseñas no coinciden.");
        guardar.setAttribute("aria-busy", "true"); guardar.disabled = true;
        try {
          const { error: err } = await sb.auth.updateUser({ password: nueva.value, data: { debe_cambiar_clave: false } });
          if (err) return falla(/different/i.test(err.message) ? "Elige una contraseña distinta a la actual." : /weak|short|least/i.test(err.message) ? "Esa contraseña es muy débil. Prueba con otra más larga." : mensajeDeError(err));
          nueva.value = repetir.value = "";
          await alListo();
        } finally { guardar.removeAttribute("aria-busy"); guardar.disabled = false; }
      } },
      h("div", { class: "campo" }, h("label", { for: "cl-nueva" }, "Contraseña nueva"), nueva, h("small", {}, "Al menos 8 caracteres.")),
      h("div", { class: "campo" }, h("label", { for: "cl-rep" }, "Repite la contraseña"), repetir),
      error, guardar);
  }

  function pantallaCambiarClave() {
    raiz.replaceChildren(h("div", { class: "acceso" }, h("div", { class: "acceso__caja" },
      h("div", { class: "marca" }, icono("hoy"), "RelojChecador"),
      h("div", {}, h("h1", {}, "Elige tu contraseña"), h("p", {}, "Entraste con una contraseña temporal. Crea una propia para continuar.")),
      formularioClave({ alListo: async () => { await sb.auth.refreshSession?.(); await arrancarConSesion(); } }),
      h("button", { class: "boton boton--secundario", type: "button", onclick: cerrarSesion }, "Cerrar sesión"))));
  }

  async function cerrarSesion() {
    clearInterval(temporizador);
    borrarCaches();
    await sb.auth.signOut();
    estado.sesion = null; estado.miembro = null;
    pantallaAcceso();
  }

  // ---------- Carga del perfil y estructura ----------
  async function arrancarConSesion() {
    const { data } = await sb.auth.getSession();
    estado.sesion = data?.session ?? null;
    if (!estado.sesion) return pantallaAcceso();
    raiz.replaceChildren(h("div", { class: "acceso" }, h("div", { class: "acceso__caja" }, h("p", {}, "Cargando tu empresa…"))));
    try {
      const uid = estado.sesion.user.id;
      const [miembros, plat] = await Promise.all([
        q(sb.from("miembros").select("id,empresa_id,rol").eq("user_id", uid).eq("activo", true)),
        q(sb.from("plataforma_admins").select("user_id").eq("user_id", uid)),
      ]);
      estado.plataforma = plat.length > 0;
      if (!miembros.length && !estado.plataforma) return pantallaSinAcceso(estado.sesion.user.email);
      const empresas = miembros.length ? await q(sb.from("empresas").select("id,nombre").in("id", miembros.map((m) => m.empresa_id))) : [];
      estado.membresias = miembros.map((m) => ({ ...m, empresa: empresas.find((e) => e.id === m.empresa_id)?.nombre ?? "Empresa" }));
      let guardada = null;
      try { guardada = localStorage.getItem("rc:empresa"); } catch { /* sin almacenamiento */ }
      estado.miembro = estado.membresias.find((m) => m.empresa_id === guardada) ?? estado.membresias[0] ?? null;
      estado.empresa = estado.miembro ? { id: estado.miembro.empresa_id, nombre: estado.miembro.empresa } : null;
      estado.sedes = estado.miembro
        ? (await q(sb.from("sedes").select("id,nombre,zona_horaria,activa").eq("empresa_id", estado.miembro.empresa_id).order("nombre"))).filter((x) => x.activa)
        : [];
      estado.sedeFiltro = "todas";
    } catch (err) {
      raiz.replaceChildren(h("div", { class: "acceso" }, h("div", { class: "acceso__caja" }, bloqueError(err, arrancarConSesion))));
      return;
    }
    if (estado.sesion.user.user_metadata?.debe_cambiar_clave) return pantallaCambiarClave();
    construirEstructura();
    await actualizarPendientes();
    rutear();
  }

  function construirEstructura() {
    const enlaces = [];
    if (estado.miembro) enlaces.push(["hoy", "Hoy", "#/hoy"], ["equipo", "Equipo", "#/equipo"], ["correcciones", "Correcciones", "#/correcciones"]);
    if (puedeAdministrar() || estado.plataforma) enlaces.push(["administrar", "Administrar", "#/administrar"]);
    enlaces.push(["usuario", "Cuenta", "#/cuenta"]);
    const nav = h("nav", { class: "nav", "aria-label": "Principal" }, enlaces.map(([id, texto, href]) =>
      h("a", { href, "data-ruta": id === "usuario" ? "cuenta" : id }, icono(id), h("span", {}, texto),
        id === "correcciones" && h("span", { class: "nav__aviso", id: "aviso-correcciones", hidden: true }))));
    const nombre = nombreUsuario();
    raiz.replaceChildren(h("div", { class: "app" },
      h("header", { class: "barra" },
        h("div", { class: "marca" }, icono("hoy"), "RelojChecador"),
        h("div", { class: "barra__usuario" },
          h("span", { class: "avatar avatar--barra", "aria-hidden": "true" }, iniciales(nombre)),
          h("div", { class: "barra__textos" },
            h("div", { class: "barra__nombre" }, nombre),
            h("div", { class: "barra__empresa" }, estado.miembro ? `${estado.empresa?.nombre ?? ""} · ${ROLES[estado.miembro.rol] ?? ""}` : "Administrador de la plataforma")))),
      nav,
      h("div", { class: "franja", id: "franja", role: "status", hidden: true }),
      h("main", { class: "contenido", id: "contenido", tabindex: "-1" })));
    pintarFranja();
  }

  // Aviso fijo sobre el menú: sin conexión, o hay una versión nueva de la aplicación.
  function pintarFranja() {
    const franja = document.getElementById("franja");
    if (!franja) return;
    const RC = window.RC;
    const partes = [];
    if (!navigator.onLine) partes.push(h("span", {}, "Sin conexión. Verás lo último que cargaste; los cambios no se pueden guardar."));
    if (RC?.hayActualizacion) {
      partes.push(h("span", {}, "Hay una versión nueva de la aplicación."),
        h("button", { class: "boton boton--chico boton--secundario", type: "button", onclick: () => RC.aplicarActualizacion() }, "Actualizar ahora"));
    }
    franja.replaceChildren(...partes);
    franja.hidden = partes.length === 0;
  }
  window.addEventListener("online", pintarFranja);
  window.addEventListener("offline", pintarFranja);
  window.addEventListener("rc:estado", pintarFranja);

  async function actualizarPendientes() {
    if (!estado.miembro || !puedeResolver()) return;
    try {
      const { count } = await sb.from("correcciones").select("id", { count: "exact", head: true }).eq("empresa_id", eid()).eq("estado", "pendiente");
      estado.pendientes = count ?? 0;
    } catch { estado.pendientes = 0; }
    const el = document.getElementById("aviso-correcciones");
    if (el) { el.hidden = !estado.pendientes; el.textContent = String(estado.pendientes); }
  }

  // ---------- Rutas ----------
  const RUTAS = { hoy: vistaHoy, equipo: vistaEquipo, correcciones: vistaCorrecciones, administrar: vistaAdministrar, cuenta: vistaCuenta, mas: vistaCuenta };

  function rutear() {
    clearInterval(temporizador);
    if (!estado.sesion || !estado.miembro) return;
    const [camino, consulta] = (location.hash || "#/hoy").replace(/^#\//, "").split("?");
    let nombre = RUTAS[camino] ? (camino === "mas" ? "cuenta" : camino) : "hoy";
    if (!estado.miembro && !["administrar", "cuenta"].includes(nombre)) nombre = "administrar";
    if (nombre === "administrar" && !(puedeAdministrar() || estado.plataforma)) nombre = estado.miembro ? "hoy" : "cuenta";
    const parametros = new URLSearchParams(consulta ?? "");
    estado.ruta += 1;
    const miRuta = estado.ruta;
    document.querySelectorAll(".nav a").forEach((a) => {
      if (a.dataset.ruta === nombre) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const cont = document.getElementById("contenido");
    if (!cont) return; // la pantalla actual no tiene contenido (por ejemplo, el cambio de contraseña)
    document.title = `${nombre[0].toUpperCase()}${nombre.slice(1)} | RelojChecador`;
    RUTAS[nombre](cont, { vigente: () => estado.ruta === miRuta, parametros });
    window.scrollTo?.(0, 0);
  }

  // ---------- Hoy ----------
  async function vistaHoy(cont, ctx) {
    const selector = estado.sedes.length > 1
      ? h("select", { class: "entrada", "aria-label": "Sede", style: "width:auto", onchange: (e) => { estado.sedeFiltro = e.target.value; cargar(); } },
          h("option", { value: "todas" }, "Todas las sedes"),
          estado.sedes.map((s) => h("option", { value: s.id, selected: estado.sedeFiltro === s.id }, s.nombre)))
      : null;
    const tzBase = estado.sedes[0]?.zona_horaria ?? "America/Mexico_City";
    const botonActualizar = h("button", { class: "boton boton--secundario boton--icono", type: "button", "aria-label": "Actualizar", title: "Actualizar", onclick: () => cargar() }, icono("refrescar"));
    const zona = h("div", {});
    cont.replaceChildren(
      h("div", { class: "cabecera" },
        h("div", { class: "cabecera__texto" }, h("h1", {}, "Hoy"), h("p", {}, fechaLarga(new Date(), tzBase))),
        h("div", { class: "cabecera__acciones" }, selector, botonActualizar)),
      zona);

    const claveHoy = `rc:hoy:${estado.sesion.user.id}`;
    function mostrar(datos, deCache) {
      const filtrados = datos.empleados.filter((e) => estado.sedeFiltro === "todas" || e.sede_id === estado.sedeFiltro);
      const ahoraVista = deCache ? new Date(deCache.guardado) : new Date();
      const filas = resumenDelDia(filtrados, datos.registros, ahoraVista, tzPorSede(),
        { horarios: datos.horarios, horarioDias: datos.horarioDias, empleadoHorarios: datos.empleadoHorarios });
      const hora = deCache ? new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(new Date(deCache.guardado)) : null;
      // replaceChildren convierte lo que no es un nodo en texto ("null"): solo se pasan nodos.
      zona.replaceChildren(...[
        deCache && h("div", { class: "aviso-bloque", style: "margin-bottom:.75rem" }, `Sin conexión. Esto es lo último que cargaste (${hora}); puede estar desactualizado.`),
        pintarHoy(filas),
      ].filter(Boolean));
    }

    async function cargar(silencioso = false) {
      if (!silencioso) zona.replaceChildren(esqueletos(5));
      try {
        const desde = new Date(Date.now() - 36 * 3600_000).toISOString();
        const [empleados, registros, horarios, horarioDias, empleadoHorarios] = await Promise.all([
          q(sb.from("empleados").select("id,nombre,telefono,estado,sede_id").eq("empresa_id", eid()).eq("estado", "activo")),
          q(sb.from("registros_efectivos").select("origen,fuente_id,empleado_id,sede_id,tipo,hora_efectiva,hora_original,canal,senales,medio_id,corregido").eq("empresa_id", eid()).gte("hora_efectiva", desde)),
          q(sb.from("horarios").select("id,tolerancia_retardo_min").eq("empresa_id", eid())),
          q(sb.from("horario_dias").select("horario_id,dia_semana,hora_entrada")),
          q(sb.from("empleado_horarios").select("empleado_id,horario_id,vigencia").eq("empresa_id", eid())),
        ]);
        if (!ctx.vigente()) return;
        const datos = { empleados, registros, horarios, horarioDias, empleadoHorarios };
        guardarCache(claveHoy, datos);
        mostrar(datos, null);
      } catch (err) {
        if (!ctx.vigente()) return;
        const copia = esErrorDeRed(err) ? leerCache(claveHoy) : null;
        if (copia) mostrar(copia.datos, copia);
        else zona.replaceChildren(bloqueError(err, () => cargar()));
      }
    }
    await cargar();
    temporizador = setInterval(() => { if (ctx.vigente()) cargar(true); }, 60_000);
  }

  function subtituloFila(f) {
    const sede = estado.sedes.length > 1 ? `${nombreSede(f.empleado.sede_id)} · ` : "";
    const primeraEntrada = f.registros.find((r) => r.tipo === "entrada");
    switch (f.grupo) {
      case "faltan": return sede + (f.horario?.entradas?.length ? `Sin registro · entrada esperada ${f.horario.entradas[0]}` : "Sin registro hoy");
      case "por_llegar": return sede + `Entrada esperada ${f.horario.entradas[0]}`;
      case "en_turno": return sede + (f.desdeAyer ? "Turno abierto desde ayer" : `Entró ${primeraEntrada ? horaLocal(primeraEntrada.instante, f.tz) : ""}`);
      case "en_pausa": return sede + `En pausa desde ${horaLocal(f.ultimo.instante, f.tz)}`;
      case "salieron": {
        if (!primeraEntrada) return sede + "Salió";
        const min = Math.round((f.ultimo.instante - primeraEntrada.instante) / 60000);
        return sede + `Jornada de ${formatearDuracion(Math.max(min, 0))}`;
      }
      default: return sede + "Día de descanso";
    }
  }

  function pintarHoy(filas) {
    if (!filas.length) {
      return h("div", { class: "vacio" },
        h("h2", {}, "Todavía no hay empleados activos"),
        h("p", {}, "Cuando invites a tu primer empleado y acepte el aviso de privacidad por WhatsApp, aparecerá aquí."),
        h("a", { class: "boton boton--primario", href: "#/equipo" }, "Ir a Equipo"));
    }
    const cuentas = contarGrupos(filas);
    const grupos = ORDEN_GRUPOS.filter((g) => cuentas[g]).map((g) => {
      const delGrupo = filas.filter((f) => f.grupo === g).sort((a, b) => a.empleado.nombre.localeCompare(b.empleado.nombre, "es"));
      return h("section", { class: `grupo${g === "faltan" ? " grupo--alerta" : ""}`, "aria-labelledby": `g-${g}` },
        h("div", { class: "grupo__titulo" }, h("h2", { id: `g-${g}` }, TITULO_GRUPO[g]), h("span", { class: "grupo__cuenta" }, String(delGrupo.length))),
        h("ul", { class: "lista" }, delGrupo.map(filaEmpleadoHoy)));
    });
    return h("div", {}, grupos);
  }

  function filaEmpleadoHoy(f) {
    const detalle = h("div", { class: "detalle", hidden: true });
    const idDetalle = `d-${f.empleado.id}`;
    detalle.id = idDetalle;
    let cargado = false;
    const primeraEntrada = f.registros.find((r) => r.tipo === "entrada");
    const boton = h("button", { class: "fila", type: "button", "aria-expanded": "false", "aria-controls": idDetalle,
      onclick: () => {
        const abierto = boton.getAttribute("aria-expanded") === "true";
        boton.setAttribute("aria-expanded", String(!abierto));
        detalle.hidden = abierto;
        if (!abierto && !cargado) { cargado = true; pintarDetalleHoy(f, detalle); }
      } },
      h("span", { class: "avatar", "aria-hidden": "true" }, iniciales(f.empleado.nombre)),
      h("span", { style: "min-width:0" },
        h("div", { class: "fila__nombre" }, f.empleado.nombre),
        h("div", { class: "fila__sub" }, subtituloFila(f),
          f.retardo > 0 && f.ultimo !== primeraEntrada && h("span", { class: "retardo" }, ` · Entró con ${formatearDuracion(f.retardo)} de retardo`))),
      h("span", { class: "fila__fin" },
        f.senales.length > 0 && h("span", { class: "chip chip--aviso" }, `${f.senales.length} ${f.senales.length === 1 ? "señal" : "señales"}`),
        f.ultimo
          ? sello(f.ultimo.tipo, horaLocal(f.ultimo.instante, f.tz), { retardo: f.retardo > 0 && f.ultimo === primeraEntrada, corregido: f.ultimo.corregido })
          : (f.grupo === "faltan" ? sello("entrada", "--:--", { vacio: true }) : null),
        f.retardo > 0 && f.ultimo === primeraEntrada && h("span", { class: "retardo" }, `Retardo ${formatearDuracion(f.retardo)}`)),
      h("span", { class: "fila__flecha" }, icono("flecha")));
    return h("li", {}, boton, detalle);
  }

  async function pintarDetalleHoy(f, cuerpo) {
    cuerpo.replaceChildren(esqueletos(2));
    try {
      const ids = f.registros.filter((r) => r.origen === "registro").map((r) => r.fuente_id);
      const reales = ids.length
        ? await q(sb.from("registros").select("id,lat,lng,distancia_m,dentro_geocerca,medio_id").in("id", ids))
        : [];
      const porId = Object.fromEntries(reales.map((r) => [r.id, r]));
      const contenido = [];
      if (!f.registros.length) {
        contenido.push(h("p", { style: "margin-top:.75rem" }, `Todavía no hay registros hoy. Teléfono: ${formatearTelefono(f.empleado.telefono)}.`));
      } else {
        contenido.push(h("ul", { class: "cronologia" }, f.registros.map((r) => {
          const extra = porId[r.fuente_id];
          const esPrimera = r === f.registros.find((x) => x.tipo === "entrada");
          const unico = f.registros.length === 1;
          return h("li", {},
            !unico && sello(r.tipo, horaLocal(r.instante, f.tz), { retardo: esPrimera && f.retardo > 0, corregido: r.corregido }),
            h("span", { class: "meta" }, [
              unico ? horaLocal(r.instante, f.tz) : null,
              ETIQUETAS_TIPO[r.tipo], CANALES[r.canal] ?? r.canal,
              extra?.distancia_m != null ? `a ${formatearDistancia(extra.distancia_m)} de la sede` : null,
              r.corregido ? `corregido (original ${horaLocal(new Date(r.hora_original ?? r.hora_efectiva), f.tz)})` : null,
            ].filter(Boolean).join(" · ")));
        })));
        if (f.senales.length) {
          contenido.push(h("div", {}, h("h3", { style: "margin-bottom:.4rem" }, "Señales para revisar"),
            h("ul", { class: "senales" }, f.senales.map((s) => h("li", {}, etiquetaSenal(s)))),
            h("p", { class: "fila__sub", style: "margin-top:.4rem" }, "Una señal no prueba nada: solo avisa que conviene mirar el registro.")));
        }
      }
      const ultimoConFoto = [...f.registros].reverse().find((r) => porId[r.fuente_id]?.medio_id);
      const ultimoConMapa = [...f.registros].reverse().find((r) => porId[r.fuente_id]?.lat != null);
      const visor = h("div", {});
      const botonSelfie = ultimoConFoto && h("button", { class: "boton boton--secundario boton--chico", type: "button",
        onclick: (e) => verSelfie(e.currentTarget, visor, porId[ultimoConFoto.fuente_id].medio_id, f, ultimoConFoto) }, icono("camara"), "Ver selfie");
      const acciones = h("div", { class: "formulario__acciones" },
        ultimoConMapa && h("a", { class: "boton boton--secundario boton--chico", target: "_blank", rel: "noopener noreferrer",
          href: enlaceMapa(porId[ultimoConMapa.fuente_id].lat, porId[ultimoConMapa.fuente_id].lng) }, icono("mapa"), "Ver ubicación"),
        puedeResolver() && h("a", { class: "boton boton--secundario boton--chico", href: `#/correcciones?empleado=${encodeURIComponent(f.empleado.id)}` }, icono("correcciones"), "Pedir corrección"));
      contenido.push(acciones);
      cuerpo.replaceChildren(h("div", { class: "detalle__grid" },
        h("div", { class: "detalle__selfie" }, botonSelfie, visor),
        h("div", { class: "detalle__datos" }, contenido)));
    } catch (err) {
      cuerpo.replaceChildren(bloqueError(err, () => pintarDetalleHoy(f, cuerpo)));
    }
  }

  async function verSelfie(boton, visor, medioId, f, registro) {
    boton.setAttribute("aria-busy", "true"); boton.disabled = true;
    try {
      const medios = await q(sb.from("medios").select("ruta_storage").eq("id", medioId));
      if (!medios.length) throw new Error("No se encontró la selfie.");
      const { data, error } = await sb.storage.from("selfies").createSignedUrl(medios[0].ruta_storage, 300);
      if (error) throw error;
      visor.replaceChildren(h("img", { class: "selfie", src: data.signedUrl, alt: `Selfie de ${f.empleado.nombre} a las ${horaLocal(registro.instante, f.tz)}` }));
      boton.hidden = true;
    } catch (err) {
      avisar(mensajeDeError(err), "error");
    } finally {
      boton.removeAttribute("aria-busy"); boton.disabled = false;
    }
  }

  // ---------- Equipo ----------
  async function vistaEquipo(cont, ctx) {
    const lista = h("div", {});
    const buscador = h("input", { class: "entrada", type: "search", placeholder: "Buscar por nombre o teléfono", "aria-label": "Buscar empleado", style: "margin-bottom:.75rem" });
    const espacioForm = h("div", {});
    const botonAgregar = puedeAdministrar()
      ? h("button", { class: "boton boton--primario", type: "button", onclick: () => mostrarFormulario() }, icono("agregar"), "Agregar")
      : null;
    cont.replaceChildren(
      h("div", { class: "cabecera" },
        h("div", { class: "cabecera__texto" }, h("h1", {}, "Equipo"), h("p", {}, "Tus empleados y su acceso por WhatsApp")),
        h("div", { class: "cabecera__acciones" }, botonAgregar)),
      espacioForm, buscador, lista);

    let empleados = [];
    async function cargar() {
      lista.replaceChildren(esqueletos(4));
      try {
        empleados = await q(sb.from("empleados").select("id,nombre,telefono,estado,sede_id,num_empleado").eq("empresa_id", eid()).order("nombre"));
        if (ctx.vigente()) pintar();
      } catch (err) { if (ctx.vigente()) lista.replaceChildren(bloqueError(err, cargar)); }
    }

    function pintar() {
      const t = buscador.value.trim().toLowerCase();
      const visibles = empleados.filter((e) => !t || e.nombre.toLowerCase().includes(t) || (e.telefono ?? "").includes(t.replace(/\D/g, "") || "§"));
      if (!empleados.length) {
        lista.replaceChildren(h("div", { class: "vacio" }, h("h2", {}, "Aún no hay empleados"),
          h("p", {}, "Agrega a tu primer empleado con su nombre y teléfono; después le mandas la invitación por WhatsApp."),
          puedeAdministrar() && h("button", { class: "boton boton--primario", type: "button", onclick: () => mostrarFormulario() }, icono("agregar"), "Agregar empleado")));
        return;
      }
      if (!visibles.length) { lista.replaceChildren(h("div", { class: "vacio" }, h("p", {}, "Nadie coincide con esa búsqueda."))); return; }
      const orden = { invitado: 0, activo: 1, baja: 2 };
      visibles.sort((a, b) => orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre, "es"));
      lista.replaceChildren(h("ul", { class: "lista" }, visibles.map(filaEquipo)));
    }

    function filaEquipo(e) {
      const detalle = h("div", { class: "detalle", hidden: true });
      const id = `eq-${e.id}`;
      detalle.id = id;
      const boton = h("button", { class: "fila", type: "button", "aria-expanded": "false", "aria-controls": id,
        onclick: () => {
          const abierto = boton.getAttribute("aria-expanded") === "true";
          boton.setAttribute("aria-expanded", String(!abierto));
          detalle.hidden = abierto;
          if (!abierto) pintarAcciones(e, detalle);
        } },
        h("span", { class: "avatar", "aria-hidden": "true" }, iniciales(e.nombre)),
        h("span", { style: "min-width:0" },
          h("div", { class: "fila__nombre" }, e.nombre),
          h("div", { class: "fila__sub" }, [formatearTelefono(e.telefono), estado.sedes.length > 1 ? nombreSede(e.sede_id) : null].filter(Boolean).join(" · "))),
        h("span", { class: "fila__fin" },
          h("span", { class: `chip${e.estado === "invitado" ? " chip--aviso" : e.estado === "baja" ? " chip--baja" : ""}` }, ETIQUETA_ESTADO[e.estado] ?? e.estado)),
        h("span", { class: "fila__flecha" }, icono("flecha")));
      return h("li", {}, boton, detalle);
    }

    function pintarAcciones(e, cuerpo) {
      const zonaInvitacion = h("div", {});
      const acciones = h("div", { class: "formulario__acciones", style: "margin-top:.75rem" });
      if (e.estado === "baja") {
        cuerpo.replaceChildren(h("p", { style: "margin-top:.75rem" }, "Este empleado está dado de baja. Su historial se conserva."));
        return;
      }
      if (!puedeAdministrar()) {
        cuerpo.replaceChildren(h("p", { style: "margin-top:.75rem" }, "Solo el dueño o un administrador pueden invitar o dar de baja."));
        return;
      }
      const invitar = h("button", { class: "boton boton--primario boton--chico", type: "button",
        onclick: async () => {
          invitar.setAttribute("aria-busy", "true"); invitar.disabled = true;
          try { pintarInvitacion(zonaInvitacion, e, await crearInvitacion(e.id)); }
          catch (err) { avisar(mensajeDeError(err), "error"); }
          finally { invitar.removeAttribute("aria-busy"); invitar.disabled = false; }
        } }, icono("enviar"), e.estado === "invitado" ? "Invitar por WhatsApp" : "Volver a invitar");
      let confirmando = false;
      const baja = h("button", { class: "boton boton--peligro boton--chico", type: "button",
        onclick: async () => {
          if (!confirmando) { confirmando = true; baja.textContent = "Confirmar baja"; setTimeout(() => { confirmando = false; baja.textContent = "Dar de baja"; }, 5000); return; }
          baja.disabled = true;
          try {
            await q(sb.from("empleados").update({ estado: "baja", fecha_baja: fechaLocal(new Date(), "America/Mexico_City") }).eq("id", e.id));
            avisar(`${e.nombre} quedó dado de baja.`);
            await cargar();
          } catch (err) { avisar(mensajeDeError(err), "error"); baja.disabled = false; }
        } }, "Dar de baja");
      acciones.append(invitar, baja);
      const zonaHorario = h("div", { style: "margin-top:.75rem" }, h("p", { class: "nota" }, "Cargando horario…"));
      cuerpo.replaceChildren(zonaHorario, acciones, zonaInvitacion);
      pintarHorarioEmpleado(e, zonaHorario);
    }

    async function pintarHorarioEmpleado(e, zonaH) {
      try {
        const hoy = fechaLocal(new Date(), tzPorSede()[e.sede_id] ?? "America/Mexico_City");
        const [horarios, dias, asignaciones] = await Promise.all([
          q(sb.from("horarios").select("id,nombre").eq("empresa_id", eid()).order("nombre")),
          q(sb.from("horario_dias").select("horario_id,dia_semana,hora_entrada,hora_salida")),
          q(sb.from("empleado_horarios").select("id,horario_id,vigencia").eq("empleado_id", e.id)),
        ]);
        const vigente = asignaciones.find((a) => { const v = parsearVigencia(a.vigencia); return v && (!v.desde || v.desde <= hoy) && (!v.hasta || v.hasta > hoy); });
        if (!horarios.length) { zonaH.replaceChildren(h("p", { class: "nota" }, "Aún no hay horarios. Créalos en Administrar > Horarios.")); return; }
        const sel = h("select", { class: "entrada", id: `eh-${e.id}` },
          h("option", { value: "" }, "Sin horario"),
          horarios.map((x) => h("option", { value: x.id, selected: x.id === vigente?.horario_id }, `${x.nombre} · ${resumenHorario(dias.filter((d) => d.horario_id === x.id))}`)));
        const guardar = h("button", { class: "boton boton--secundario boton--chico", type: "button",
          onclick: async () => {
            if ((sel.value || null) === (vigente?.horario_id ?? null)) { avisar("Ya tiene ese horario."); return; }
            guardar.setAttribute("aria-busy", "true"); guardar.disabled = true;
            try {
              const plan = planearCambioHorario(asignaciones, hoy);
              for (const id of plan.borrar) await q(sb.from("empleado_horarios").delete().eq("id", id));
              for (const c of plan.cerrar) await q(sb.from("empleado_horarios").update({ vigencia: `[${c.desde},${hoy})` }).eq("id", c.id));
              if (sel.value) await q(sb.from("empleado_horarios").insert({ empresa_id: eid(), empleado_id: e.id, horario_id: sel.value, vigencia: `[${hoy},)` }));
              avisar(sel.value ? "Horario asignado desde hoy." : "Se quitó el horario desde hoy.");
              await pintarHorarioEmpleado(e, zonaH);
            } catch (err) { avisar(mensajeDeError(err), "error"); guardar.removeAttribute("aria-busy"); guardar.disabled = false; }
          } }, "Cambiar horario");
        zonaH.replaceChildren(h("div", { class: "campo", style: "max-width:30rem" }, h("label", { for: `eh-${e.id}` }, "Horario"), sel,
          h("small", {}, "El cambio rige desde hoy; lo anterior se conserva en el historial.")), h("div", { style: "margin-top:.5rem" }, guardar));
      } catch (err) { zonaH.replaceChildren(bloqueError(err, () => pintarHorarioEmpleado(e, zonaH))); }
    }

    function pintarInvitacion(zona, e, inv) {
      const caduca = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(inv.expira_at));
      zona.replaceChildren(h("div", { class: "invitacion", style: "margin-top:.75rem" },
        h("p", {}, `Código de ${e.nombre}: `, h("code", {}, inv.codigo)),
        h("p", { class: "nota" }, `Sirve una sola vez y solo desde el teléfono ${formatearTelefono(e.telefono)}. Si generas otra invitación, esta deja de servir. Vence el ${caduca}`),
        h("div", { class: "invitacion__acciones" },
          h("a", { class: "boton boton--primario", target: "_blank", rel: "noopener noreferrer", href: enlaceMensajeEmpleado(e.telefono, e.nombre, inv.enlace) }, icono("enviar"), "Enviar por WhatsApp"),
          h("button", { class: "boton boton--secundario", type: "button", onclick: () => copiar(inv.enlace) }, icono("copiar"), "Copiar enlace"))));
    }

    function mostrarFormulario() {
      if (espacioForm.firstChild) { espacioForm.replaceChildren(); return; }
      const nombre = h("input", { class: "entrada", id: "n-nombre", autocomplete: "off", required: true });
      const telefono = h("input", { class: "entrada", id: "n-tel", type: "tel", inputmode: "tel", autocomplete: "off", placeholder: "33 1234 5678", required: true });
      const sede = h("select", { class: "entrada", id: "n-sede" }, estado.sedes.map((s) => h("option", { value: s.id }, s.nombre)));
      const numero = h("input", { class: "entrada", id: "n-num", autocomplete: "off" });
      const errNombre = h("div", { class: "error-campo", hidden: true }); const errTel = h("div", { class: "error-campo", hidden: true });
      const guardar = h("button", { class: "boton boton--primario", type: "submit" }, "Guardar empleado");
      const form = h("form", { class: "formulario", novalidate: true,
        onsubmit: async (ev) => {
          ev.preventDefault();
          errNombre.hidden = errTel.hidden = true; nombre.removeAttribute("aria-invalid"); telefono.removeAttribute("aria-invalid");
          const tel = normalizarTelefonoMx(telefono.value);
          let mal = false;
          if (nombre.value.trim().length < 2) { errNombre.textContent = "Escribe el nombre del empleado."; errNombre.hidden = false; nombre.setAttribute("aria-invalid", "true"); mal = true; }
          if (!tel) { errTel.textContent = "Escribe un celular de 10 dígitos, por ejemplo 33 1234 5678."; errTel.hidden = false; telefono.setAttribute("aria-invalid", "true"); mal = true; }
          if (!estado.sedes.length) { avisar("Primero hace falta una sede. Pídele al dueño que la cree.", "error"); mal = true; }
          if (mal) return;
          guardar.setAttribute("aria-busy", "true"); guardar.disabled = true;
          try {
            await q(sb.from("empleados").insert({
              empresa_id: estado.miembro.empresa_id, sede_id: sede.value, nombre: nombre.value.trim(),
              telefono: tel, num_empleado: numero.value.trim() || null,
            }));
            avisar(`${nombre.value.trim()} se agregó. Ahora invítalo por WhatsApp.`);
            espacioForm.replaceChildren();
            await cargar();
          } catch (err) {
            if (err?.code === "23505") { errTel.textContent = "Ese teléfono o número de empleado ya existe en tu empresa."; errTel.hidden = false; }
            else avisar(mensajeDeError(err), "error");
          } finally { guardar.removeAttribute("aria-busy"); guardar.disabled = false; }
        } },
        h("h2", {}, "Nuevo empleado"),
        h("div", { class: "campo" }, h("label", { for: "n-nombre" }, "Nombre completo"), nombre, errNombre),
        h("div", { class: "cuadricula cuadricula--2" },
          h("div", { class: "campo" }, h("label", { for: "n-tel" }, "Celular (WhatsApp)"), telefono, errTel),
          h("div", { class: "campo" }, h("label", { for: "n-sede" }, "Sede"), sede)),
        h("div", { class: "campo" }, h("label", { for: "n-num" }, "Número de empleado (opcional)"), numero),
        h("div", { class: "formulario__acciones" }, guardar,
          h("button", { class: "boton boton--secundario", type: "button", onclick: () => espacioForm.replaceChildren() }, "Cancelar")));
      espacioForm.replaceChildren(form);
      nombre.focus();
    }

    buscador.addEventListener("input", pintar);
    await cargar();
  }

  async function crearInvitacion(empleadoId) {
    const { data } = await sb.auth.getSession();
    const r = await fetch(`${url}/functions/v1/crear-invitacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}`, apikey: key },
      body: JSON.stringify({ empleado_id: empleadoId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || "No se pudo crear la invitación.");
    return j;
  }

  async function copiar(texto, que = "Enlace") {
    try { await navigator.clipboard.writeText(texto); avisar(`${que} copiado.`); }
    catch { avisar("No se pudo copiar. Mantén presionado el texto para copiarlo.", "error"); }
  }

  // ---------- Correcciones ----------
  async function vistaCorrecciones(cont, ctx) {
    const lista = h("div", {});
    const espacioForm = h("div", {});
    let pestana = "pendientes";
    const botones = {
      pendientes: h("button", { class: "boton boton--secundario boton--chico", type: "button", "aria-pressed": "true", onclick: () => cambiar("pendientes") }, "Pendientes"),
      historial: h("button", { class: "boton boton--secundario boton--chico", type: "button", "aria-pressed": "false", onclick: () => cambiar("historial") }, "Historial"),
    };
    function cambiar(p) { pestana = p; for (const [k, b] of Object.entries(botones)) b.setAttribute("aria-pressed", String(k === p)); cargar(); }
    cont.replaceChildren(
      h("div", { class: "cabecera" },
        h("div", { class: "cabecera__texto" }, h("h1", {}, "Correcciones"), h("p", {}, "Los registros no se editan: se corrigen aquí y queda constancia")),
        h("div", { class: "cabecera__acciones" }, puedeResolver() && h("button", { class: "boton boton--primario", type: "button", onclick: () => mostrarFormulario() }, icono("agregar"), "Nueva"))),
      espacioForm,
      h("div", { class: "resumen" }, botones.pendientes, botones.historial),
      lista);

    let nombres = {}; let empleados = [];
    async function cargar() {
      lista.replaceChildren(esqueletos(3));
      try {
        empleados = await q(sb.from("empleados").select("id,nombre,sede_id,estado").eq("empresa_id", eid()).order("nombre"));
        nombres = Object.fromEntries(empleados.map((e) => [e.id, e]));
        const consulta = sb.from("correcciones").select("id,empleado_id,registro_id,tipo,nuevo_tipo,nueva_hora,motivo,origen,estado,creada_at,resuelto_at,comentario_resolucion").eq("empresa_id", eid());
        const filas = pestana === "pendientes"
          ? await q(consulta.eq("estado", "pendiente").order("creada_at", { ascending: false }))
          : await q(consulta.neq("estado", "pendiente").order("creada_at", { ascending: false }).limit(30));
        const ids = [...new Set(filas.map((f) => f.registro_id).filter(Boolean))];
        const originales = ids.length ? await q(sb.from("registros").select("id,tipo,ocurrido_at").in("id", ids)) : [];
        const porRegistro = Object.fromEntries(originales.map((r) => [r.id, r]));
        if (!ctx.vigente()) return;
        pintar(filas, porRegistro);
      } catch (err) { if (ctx.vigente()) lista.replaceChildren(bloqueError(err, cargar)); }
    }

    function descripcion(c, porRegistro) {
      const emp = nombres[c.empleado_id];
      const tz = tzPorSede()[emp?.sede_id] ?? "America/Mexico_City";
      const orig = porRegistro[c.registro_id];
      const cuando = (iso) => {
        const d = new Date(iso);
        return Number.isNaN(+d) ? "una fecha desconocida" : `${fechaCorta(d, tz)} ${horaLocal(d, tz)}`;
      };
      if (c.tipo === "agregar") return `Agregar ${ETIQUETAS_TIPO[c.nuevo_tipo]?.toLowerCase() ?? "registro"} el ${cuando(c.nueva_hora)}`;
      if (c.tipo === "modificar_hora") return `Cambiar ${ETIQUETAS_TIPO[orig?.tipo]?.toLowerCase() ?? "registro"} de ${orig ? cuando(orig.ocurrido_at) : "?"} a ${cuando(c.nueva_hora)}`;
      return `Anular ${ETIQUETAS_TIPO[orig?.tipo]?.toLowerCase() ?? "registro"} de ${orig ? cuando(orig.ocurrido_at) : "?"}`;
    }

    function pintar(filas, porRegistro) {
      if (!filas.length) {
        lista.replaceChildren(h("div", { class: "vacio" },
          h("h2", {}, pestana === "pendientes" ? "No hay correcciones pendientes" : "Todavía no hay historial"),
          h("p", {}, pestana === "pendientes" ? "Cuando alguien pida cambiar, agregar o anular un registro, lo verás aquí para aprobarlo o rechazarlo." : "Aquí quedan las correcciones ya resueltas.")));
        return;
      }
      lista.replaceChildren(h("ul", { class: "lista" }, filas.map((c) => {
        const comentario = h("input", { class: "entrada", "aria-label": "Comentario (opcional)", placeholder: "Comentario (opcional)", maxlength: "200", hidden: true });
        const verComentario = h("button", { class: "boton boton--texto boton--chico", type: "button",
          onclick: () => { comentario.hidden = false; verComentario.hidden = true; comentario.focus(); } }, "Agregar comentario");
        const aprobar = h("button", { class: "boton boton--primario boton--chico", type: "button", onclick: () => resolver(c, true) }, "Aprobar");
        const rechazar = h("button", { class: "boton boton--peligro boton--chico", type: "button", onclick: () => resolver(c, false) }, "Rechazar");
        async function resolver(corr, aprobada) {
          aprobar.disabled = rechazar.disabled = true;
          try {
            await q(sb.rpc("resolver_correccion", { p_id: corr.id, p_aprobar: aprobada, p_comentario: comentario.value.trim() || null }));
            avisar(aprobada ? "Corrección aprobada." : "Corrección rechazada.");
            await actualizarPendientes();
            await cargar();
          } catch (err) { avisar(mensajeDeError(err), "error"); aprobar.disabled = rechazar.disabled = false; }
        }
        return h("li", { style: "padding:.8rem .9rem; display:grid; gap:.5rem" },
          h("div", { style: "display:flex; gap:.5rem; align-items:baseline; flex-wrap:wrap" },
            h("strong", {}, nombres[c.empleado_id]?.nombre ?? "Empleado"),
            h("span", { class: `chip${c.estado === "aprobada" ? " chip--ok" : c.estado === "rechazada" ? " chip--rojo" : " chip--aviso"}` },
              c.estado === "pendiente" ? "Pendiente" : c.estado === "aprobada" ? "Aprobada" : "Rechazada")),
          h("div", {}, descripcion(c, porRegistro)),
          h("div", { class: "fila__sub", style: "white-space:normal" }, `Motivo: ${c.motivo}`),
          c.comentario_resolucion && h("div", { class: "fila__sub", style: "white-space:normal" }, `Comentario: ${c.comentario_resolucion}`),
          c.estado === "pendiente" && puedeResolver() && h("div", { style: "display:grid; gap:.6rem" },
            h("div", { class: "formulario__acciones" }, aprobar, rechazar, verComentario), comentario));
      })));
    }

    function mostrarFormulario(preseleccion) {
      if (espacioForm.firstChild && !preseleccion) { espacioForm.replaceChildren(); return; }
      const activos = empleados.filter((e) => e.estado !== "baja");
      const empleado = h("select", { class: "entrada", id: "c-emp" }, h("option", { value: "" }, "Elige un empleado"), activos.map((e) => h("option", { value: e.id, selected: e.id === preseleccion }, e.nombre)));
      const tipo = h("select", { class: "entrada", id: "c-tipo" },
        h("option", { value: "agregar" }, "Agregar un registro olvidado"),
        h("option", { value: "modificar_hora" }, "Cambiar la hora de un registro"),
        h("option", { value: "anular" }, "Anular un registro"));
      const registro = h("select", { class: "entrada", id: "c-reg" });
      const nuevoTipo = h("select", { class: "entrada", id: "c-nt" }, Object.entries(ETIQUETAS_TIPO).map(([v, t]) => h("option", { value: v }, t)));
      const fecha = h("input", { class: "entrada", id: "c-fecha", type: "date" });
      const hora = h("input", { class: "entrada", id: "c-hora", type: "time" });
      const motivo = h("textarea", { class: "entrada", id: "c-motivo", maxlength: "300", placeholder: "Por ejemplo: se le acabó la batería y no pudo checar" });
      const error = h("div", { class: "error-campo", role: "alert", hidden: true });
      const cRegistro = h("div", { class: "campo" }, h("label", { for: "c-reg" }, "Registro a corregir"), registro);
      const cNuevoTipo = h("div", { class: "campo" }, h("label", { for: "c-nt" }, "Tipo de registro"), nuevoTipo);
      const cFecha = h("div", { class: "campo" }, h("label", { for: "c-fecha" }, "Fecha"), fecha);
      const cHora = h("div", { class: "campo" }, h("label", { for: "c-hora" }, "Hora correcta"), hora);
      let registrosEmp = [];

      const tzDe = () => tzPorSede()[nombres[empleado.value]?.sede_id] ?? "America/Mexico_City";
      function ajustar() {
        const t = tipo.value;
        cRegistro.hidden = t === "agregar"; cNuevoTipo.hidden = t !== "agregar";
        cFecha.hidden = cHora.hidden = t === "anular";
      }
      async function cargarRegistros() {
        registro.replaceChildren(h("option", { value: "" }, empleado.value ? "Cargando…" : "Elige primero un empleado"));
        registrosEmp = [];
        if (!empleado.value) return;
        try {
          registrosEmp = await q(sb.from("registros").select("id,tipo,ocurrido_at").eq("empleado_id", empleado.value)
            .gte("ocurrido_at", new Date(Date.now() - 7 * 86400_000).toISOString()).order("ocurrido_at", { ascending: false }).limit(30));
          const tz = tzDe();
          registro.replaceChildren(h("option", { value: "" }, registrosEmp.length ? "Elige un registro" : "No hay registros en los últimos 7 días"),
            registrosEmp.map((r) => h("option", { value: r.id }, `${ETIQUETAS_TIPO[r.tipo]} · ${fechaCorta(new Date(r.ocurrido_at), tz)} ${horaLocal(new Date(r.ocurrido_at), tz)}`)));
        } catch (err) { avisar(mensajeDeError(err), "error"); }
      }
      registro.addEventListener("change", () => {
        const r = registrosEmp.find((x) => x.id === registro.value);
        if (r && tipo.value === "modificar_hora") { const tz = tzDe(); fecha.value = fechaLocal(new Date(r.ocurrido_at), tz); hora.value = horaLocal(new Date(r.ocurrido_at), tz); }
      });
      empleado.addEventListener("change", () => { fecha.value = fecha.value || fechaLocal(new Date(), tzDe()); cargarRegistros(); });
      tipo.addEventListener("change", ajustar);
      ajustar();

      const enviar = h("button", { class: "boton boton--primario", type: "submit" }, "Pedir corrección");
      const form = h("form", { class: "formulario", novalidate: true,
        onsubmit: async (ev) => {
          ev.preventDefault(); error.hidden = true;
          const falla = (t) => { error.textContent = t; error.hidden = false; };
          if (!empleado.value) return falla("Elige un empleado.");
          if (motivo.value.trim().length < 5) return falla("Escribe el motivo (al menos unas palabras).");
          const t = tipo.value;
          if (t !== "agregar" && !registro.value) return falla("Elige el registro que quieres corregir.");
          if (t !== "anular" && (!fecha.value || !hora.value)) return falla("Escribe la fecha y la hora correctas.");
          const carga = {
            empresa_id: estado.miembro.empresa_id, empleado_id: empleado.value, tipo: t, motivo: motivo.value.trim(),
            origen: estado.miembro.rol === "supervisor" ? "supervisor" : "admin", estado: "pendiente", solicitada_por: estado.sesion.user.id,
            registro_id: t === "agregar" ? null : registro.value,
            nuevo_tipo: t === "agregar" ? nuevoTipo.value : null,
            nueva_hora: t === "anular" ? null : aUTCdesdeLocal(fecha.value, hora.value, tzDe()).toISOString(),
          };
          enviar.setAttribute("aria-busy", "true"); enviar.disabled = true;
          try {
            await q(sb.from("correcciones").insert(carga));
            avisar("Corrección enviada. Queda pendiente de aprobar.");
            espacioForm.replaceChildren();
            await actualizarPendientes();
            if (pestana === "pendientes") await cargar();
          } catch (err) { falla(mensajeDeError(err)); }
          finally { enviar.removeAttribute("aria-busy"); enviar.disabled = false; }
        } },
        h("h2", {}, "Pedir una corrección"),
        h("div", { class: "campo" }, h("label", { for: "c-emp" }, "Empleado"), empleado),
        h("div", { class: "campo" }, h("label", { for: "c-tipo" }, "¿Qué hay que corregir?"), tipo),
        cRegistro, cNuevoTipo,
        h("div", { class: "cuadricula cuadricula--2" }, cFecha, cHora),
        h("div", { class: "campo" }, h("label", { for: "c-motivo" }, "Motivo"), motivo, h("small", {}, "Queda guardado junto a la corrección.")),
        error,
        h("div", { class: "formulario__acciones" }, enviar,
          h("button", { class: "boton boton--secundario", type: "button", onclick: () => espacioForm.replaceChildren() }, "Cancelar")));
      espacioForm.replaceChildren(form);
      if (preseleccion) { fecha.value = fechaLocal(new Date(), tzDe()); cargarRegistros(); }
      (preseleccion ? motivo : empleado).focus();
    }

    await cargar();
    const pre = ctx.parametros?.get("empleado");
    if (pre && puedeResolver()) mostrarFormulario(pre);
  }

  // ---------- Administrar ----------
  async function llamarAdministrar(cuerpo) {
    const { data } = await sb.auth.getSession();
    const r = await fetch(`${url}/functions/v1/administrar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}`, apikey: key },
      body: JSON.stringify(cuerpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "No se pudo completar la operación.");
    return j;
  }

  async function cambiarEmpresa(id) {
    try { localStorage.setItem("rc:empresa", id); } catch { /* sin almacenamiento */ }
    location.hash = "#/hoy";
    await arrancarConSesion();
  }

  function selectorEmpresa() {
    if (estado.membresias.length < 2) return null;
    return h("div", { class: "campo", style: "max-width:22rem" },
      h("label", { for: "sel-empresa" }, "Empresa activa"),
      h("select", { class: "entrada", id: "sel-empresa", onchange: (e) => cambiarEmpresa(e.target.value) },
        estado.membresias.map((m) => h("option", { value: m.empresa_id, selected: m.empresa_id === estado.miembro?.empresa_id }, `${m.empresa} (${ROLES[m.rol]})`))));
  }

  function bloqueCredencial({ correo, clave, yaExistia, titulo }) {
    if (yaExistia) {
      return h("div", { class: "invitacion", style: "margin-top:.75rem" },
        h("p", {}, `${correo} ya tenía una cuenta: quedó agregado y entra con su contraseña de siempre.`));
    }
    return h("div", { class: "invitacion", style: "margin-top:.75rem" },
      h("p", {}, h("strong", {}, titulo ?? "Cuenta lista")),
      h("p", {}, "Correo: ", h("strong", {}, correo)),
      h("p", {}, "Contraseña temporal: ", h("code", {}, clave)),
      h("p", { class: "nota" }, "Se muestra una sola vez. Pásasela a la persona; al entrar, la app le pide crear la suya."),
      h("div", { class: "invitacion__acciones" },
        h("button", { class: "boton boton--secundario", type: "button", onclick: () => copiar(clave, "Contraseña") }, icono("copiar"), "Copiar contraseña")));
  }

  function opcionesSedes(marcadas = []) {
    if (!estado.sedes.length) return { nodo: h("p", { class: "nota" }, "Esta empresa aún no tiene sedes."), marcadas: () => [] };
    const cajas = estado.sedes.map((x) => h("input", { type: "checkbox", value: x.id, checked: marcadas.includes(x.id) }));
    return {
      nodo: h("fieldset", { class: "opciones" }, h("legend", { class: "campo__etiqueta" }, "Sedes que ve"),
        estado.sedes.map((x, n) => h("label", { class: "opcion" }, cajas[n], x.nombre))),
      marcadas: () => cajas.filter((c) => c.checked).map((c) => c.value),
    };
  }

  async function vistaAdministrar(cont, ctx) {
    const verUsuarios = puedeAdministrar();
    const verEmpresas = estado.plataforma;
    const opciones = [];
    if (verUsuarios) opciones.push(["usuarios", "Usuarios", pintarUsuarios], ["lugares", "Lugares", pintarLugares], ["horarios", "Horarios", pintarHorarios]);
    if (verEmpresas) opciones.push(["empresas", "Empresas", pintarEmpresas]);
    let pestana = ctx.parametros?.get("p");
    if (!opciones.some(([id]) => id === pestana)) pestana = opciones[0][0];
    const zona = h("div", {});
    const botones = opciones.map(([id, texto]) => h("button", { class: "boton boton--secundario boton--chico", type: "button", "data-pestana": id, "aria-pressed": String(pestana === id),
      onclick: () => { pestana = id; for (const b of botones) b.setAttribute("aria-pressed", String(b.dataset.pestana === id)); mostrar(); } }, texto));
    const subtitulo = [verUsuarios && `Usuarios, sedes y horarios de ${estado.empresa?.nombre ?? "tu empresa"}`, verEmpresas && "empresas de la plataforma"].filter(Boolean).join(" · ");
    cont.replaceChildren(
      h("div", { class: "cabecera" }, h("div", { class: "cabecera__texto" }, h("h1", {}, "Administrar"), h("p", {}, subtitulo))),
      selectorEmpresa(), opciones.length > 1 ? h("div", { class: "resumen" }, botones) : null, zona);
    function mostrar() { opciones.find(([id]) => id === pestana)[2](zona, ctx); }
    mostrar();
  }

  async function pintarUsuarios(zona, ctx) {
    const actor = estado.miembro.rol;
    const lista = h("div", {});
    const espacioForm = h("div", {});
    zona.replaceChildren(
      h("div", { class: "formulario__acciones", style: "margin-bottom:.75rem" },
        h("button", { class: "boton boton--primario", type: "button", onclick: () => formulario() }, icono("agregar"), "Agregar usuario")),
      espacioForm, lista);
    let usuarios = [];

    async function cargar() {
      lista.replaceChildren(esqueletos(3));
      try {
        usuarios = await q(sb.rpc("miembros_de_empresa", { p_empresa: eid() }));
        if (ctx.vigente()) pintar();
      } catch (err) { if (ctx.vigente()) lista.replaceChildren(bloqueError(err, cargar)); }
    }

    function pintar() {
      lista.replaceChildren(h("ul", { class: "lista" }, usuarios.map(filaUsuario)));
    }

    function filaUsuario(u) {
      const detalle = h("div", { class: "detalle", hidden: true });
      const id = `us-${u.miembro_id}`;
      detalle.id = id;
      const fila = h("button", { class: "fila", type: "button", "aria-expanded": "false", "aria-controls": id,
        onclick: () => {
          const abierto = fila.getAttribute("aria-expanded") === "true";
          fila.setAttribute("aria-expanded", String(!abierto)); detalle.hidden = abierto;
          if (!abierto) pintarAcciones(u, detalle);
        } },
        h("span", { class: "avatar", "aria-hidden": "true" }, iniciales(u.nombre || u.correo)),
        h("span", { style: "min-width:0" },
          h("div", { class: "fila__nombre" }, u.nombre || u.correo),
          u.nombre && h("div", { class: "fila__sub" }, u.correo)),
        h("span", { class: "fila__fin" },
          h("span", { class: "chip" }, ROLES[u.rol] ?? u.rol),
          !u.activo && h("span", { class: "chip chip--baja" }, "Baja")),
        h("span", { class: "fila__flecha" }, icono("flecha")));
      return h("li", {}, fila, detalle);
    }

    function pintarAcciones(u, cuerpo) {
      const soyYo = u.user_id === estado.sesion.user.id;
      if (soyYo) { cuerpo.replaceChildren(h("p", { style: "margin-top:.75rem" }, "Eres tú. Tu contraseña se cambia en Cuenta.")); return; }
      if (!puedeGestionarRol(actor, u.rol)) { cuerpo.replaceChildren(h("p", { style: "margin-top:.75rem" }, "Solo el dueño puede cambiar a esta persona.")); return; }
      const rol = h("select", { class: "entrada", id: `rol-${u.miembro_id}` }, rolesAsignables(actor).map((r) => h("option", { value: r, selected: r === u.rol }, ROLES[r])));
      const nota = h("p", { class: "nota" }, DESCRIPCION_ROL[u.rol] ?? "");
      const sedes = opcionesSedes(u.sedes ?? []);
      const cajaSedes = h("div", { hidden: rol.value !== "supervisor" }, sedes.nodo);
      rol.addEventListener("change", () => { nota.textContent = DESCRIPCION_ROL[rol.value] ?? ""; cajaSedes.hidden = rol.value !== "supervisor"; });
      const zonaResultado = h("div", {});
      const guardar = h("button", { class: "boton boton--primario boton--chico", type: "button",
        onclick: async () => {
          guardar.setAttribute("aria-busy", "true"); guardar.disabled = true;
          try {
            await llamarAdministrar({ accion: "cambiar_rol", miembro_id: u.miembro_id, rol: rol.value, sede_ids: rol.value === "supervisor" ? sedes.marcadas() : [] });
            avisar("Cambios guardados."); await cargar();
          } catch (err) { avisar(mensajeDeError(err), "error"); guardar.removeAttribute("aria-busy"); guardar.disabled = false; }
        } }, "Guardar cambios");
      const reiniciar = h("button", { class: "boton boton--secundario boton--chico", type: "button",
        onclick: async () => {
          reiniciar.setAttribute("aria-busy", "true"); reiniciar.disabled = true;
          try {
            const r = await llamarAdministrar({ accion: "reiniciar_clave", miembro_id: u.miembro_id });
            zonaResultado.replaceChildren(bloqueCredencial({ correo: u.correo, clave: r.clave_temporal, titulo: "Contraseña reiniciada" }));
          } catch (err) { avisar(mensajeDeError(err), "error"); }
          finally { reiniciar.removeAttribute("aria-busy"); reiniciar.disabled = false; }
        } }, "Reiniciar contraseña");
      let confirmando = false;
      const baja = h("button", { class: `boton boton--chico ${u.activo ? "boton--peligro" : "boton--secundario"}`, type: "button",
        onclick: async () => {
          if (u.activo && !confirmando) { confirmando = true; baja.textContent = "Confirmar baja"; setTimeout(() => { confirmando = false; baja.textContent = "Dar de baja"; }, 5000); return; }
          baja.disabled = true;
          try { await llamarAdministrar({ accion: "cambiar_activo", miembro_id: u.miembro_id, activo: !u.activo }); avisar(u.activo ? "Usuario dado de baja." : "Usuario reactivado."); await cargar(); }
          catch (err) { avisar(mensajeDeError(err), "error"); baja.disabled = false; }
        } }, u.activo ? "Dar de baja" : "Reactivar");
      cuerpo.replaceChildren(h("div", { style: "display:grid; gap:.75rem; padding-top:.75rem" },
        h("div", { class: "campo", style: "max-width:22rem" }, h("label", { for: `rol-${u.miembro_id}` }, "Rol"), rol, nota),
        cajaSedes,
        h("div", { class: "formulario__acciones" }, guardar, reiniciar, baja), zonaResultado));
    }

    function formulario() {
      if (espacioForm.firstChild) { espacioForm.replaceChildren(); return; }
      const correo = h("input", { class: "entrada", id: "u-correo", type: "email", inputmode: "email", autocomplete: "off", required: true });
      const nombre = h("input", { class: "entrada", id: "u-nombre", autocomplete: "off", required: true });
      const asignables = rolesAsignables(actor);
      const rol = h("select", { class: "entrada", id: "u-rol" }, asignables.map((r) => h("option", { value: r }, ROLES[r])));
      const nota = h("p", { class: "nota" }, DESCRIPCION_ROL[asignables[0]] ?? "");
      const sedes = opcionesSedes([]);
      const cajaSedes = h("div", { hidden: true }, sedes.nodo);
      rol.addEventListener("change", () => { nota.textContent = DESCRIPCION_ROL[rol.value] ?? ""; cajaSedes.hidden = rol.value !== "supervisor"; });
      const error = h("div", { class: "error-campo", role: "alert", hidden: true });
      const resultado = h("div", {});
      const guardar = h("button", { class: "boton boton--primario", type: "submit" }, "Crear usuario");
      espacioForm.replaceChildren(h("form", { class: "formulario", novalidate: true,
        onsubmit: async (ev) => {
          ev.preventDefault(); error.hidden = true;
          const falla = (t) => { error.textContent = t; error.hidden = false; };
          if (nombre.value.trim().length < 2) return falla("Escribe el nombre de la persona.");
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo.value.trim())) return falla("Escribe un correo válido.");
          guardar.setAttribute("aria-busy", "true"); guardar.disabled = true;
          try {
            const r = await llamarAdministrar({ accion: "crear_usuario", empresa_id: eid(), correo: correo.value.trim(), nombre: nombre.value.trim(), rol: rol.value, sede_ids: rol.value === "supervisor" ? sedes.marcadas() : [] });
            resultado.replaceChildren(bloqueCredencial({ correo: r.correo, clave: r.clave_temporal, yaExistia: r.ya_existia, titulo: "Usuario creado" }));
            correo.value = nombre.value = ""; guardar.hidden = true;
            await cargar();
          } catch (err) { falla(mensajeDeError(err)); }
          finally { guardar.removeAttribute("aria-busy"); guardar.disabled = false; }
        } },
        h("h2", {}, "Nuevo usuario"),
        h("div", { class: "cuadricula cuadricula--2" },
          h("div", { class: "campo" }, h("label", { for: "u-nombre" }, "Nombre"), nombre),
          h("div", { class: "campo" }, h("label", { for: "u-correo" }, "Correo"), correo)),
        h("div", { class: "campo", style: "max-width:22rem" }, h("label", { for: "u-rol" }, "Rol"), rol, nota),
        cajaSedes, error, resultado,
        h("div", { class: "formulario__acciones" }, guardar,
          h("button", { class: "boton boton--secundario", type: "button", onclick: () => espacioForm.replaceChildren() }, "Cerrar"))));
      nombre.focus();
    }
    await cargar();
  }

  async function pintarEmpresas(zona, ctx) {
    const lista = h("div", {});
    const espacioForm = h("div", {});
    zona.replaceChildren(
      h("div", { class: "formulario__acciones", style: "margin-bottom:.75rem" },
        h("button", { class: "boton boton--primario", type: "button", onclick: () => formulario() }, icono("agregar"), "Nueva empresa")),
      espacioForm, lista);

    async function cargar() {
      lista.replaceChildren(esqueletos(3));
      try {
        const { empresas } = await llamarAdministrar({ accion: "listar_empresas" });
        if (ctx.vigente()) lista.replaceChildren(h("ul", { class: "lista" }, empresas.map(filaEmpresa)));
      } catch (err) { if (ctx.vigente()) lista.replaceChildren(bloqueError(err, cargar)); }
    }

    function filaEmpresa(e) {
      const detalle = h("div", { class: "detalle", hidden: true });
      const id = `emp-${e.id}`; detalle.id = id;
      const actual = estado.miembro?.empresa_id === e.id;
      const fila = h("button", { class: "fila", type: "button", "aria-expanded": "false", "aria-controls": id,
        onclick: () => { const ab = fila.getAttribute("aria-expanded") === "true"; fila.setAttribute("aria-expanded", String(!ab)); detalle.hidden = ab; if (!ab) pintarDetalle(e, detalle, actual); } },
        h("span", { class: "avatar", "aria-hidden": "true" }, iniciales(e.nombre)),
        h("span", { style: "min-width:0" }, h("div", { class: "fila__nombre" }, e.nombre),
          h("div", { class: "fila__sub" }, `${e.usuarios} ${e.usuarios === 1 ? "usuario" : "usuarios"} · ${e.empleados} ${e.empleados === 1 ? "empleado" : "empleados"}`)),
        h("span", { class: "fila__fin" }, actual && h("span", { class: "chip chip--ok" }, "Activa")),
        h("span", { class: "fila__flecha" }, icono("flecha")));
      return h("li", {}, fila, detalle);
    }

    function pintarDetalle(e, cuerpo, actual) {
      const nombre = h("input", { class: "entrada", value: e.nombre, "aria-label": "Nombre de la empresa" });
      const entrar = h("button", { class: "boton boton--primario boton--chico", type: "button",
        onclick: async () => {
          entrar.setAttribute("aria-busy", "true"); entrar.disabled = true;
          try { await llamarAdministrar({ accion: "unirme_a_empresa", empresa_id: e.id }); avisar("Quedaste como administrador de esa empresa."); await cambiarEmpresa(e.id); }
          catch (err) { avisar(mensajeDeError(err), "error"); entrar.removeAttribute("aria-busy"); entrar.disabled = false; }
        } }, actual ? "Ya estás en esta empresa" : "Entrar a esta empresa");
      if (actual) entrar.disabled = true;
      const renombrar = h("button", { class: "boton boton--secundario boton--chico", type: "button",
        onclick: async () => {
          try { await llamarAdministrar({ accion: "renombrar_empresa", empresa_id: e.id, nombre: nombre.value }); avisar("Nombre actualizado."); await cargar(); }
          catch (err) { avisar(mensajeDeError(err), "error"); }
        } }, "Guardar nombre");
      cuerpo.replaceChildren(h("div", { style: "display:grid; gap:.75rem; padding-top:.75rem" },
        h("p", { class: "nota" }, "Al entrar quedas como administrador de esa empresa y queda constancia en la bitácora."),
        h("div", { class: "formulario__acciones" }, entrar),
        h("div", { class: "campo", style: "max-width:22rem" }, h("label", {}, "Nombre"), nombre), renombrar));
    }

    function formulario() {
      if (espacioForm.firstChild) { espacioForm.replaceChildren(); return; }
      const nombre = h("input", { class: "entrada", id: "e-nombre", autocomplete: "off", required: true });
      const dueno = h("input", { class: "entrada", id: "e-dueno", autocomplete: "off", required: true });
      const correo = h("input", { class: "entrada", id: "e-correo", type: "email", inputmode: "email", autocomplete: "off", required: true });
      const error = h("div", { class: "error-campo", role: "alert", hidden: true });
      const resultado = h("div", {});
      const guardar = h("button", { class: "boton boton--primario", type: "submit" }, "Crear empresa");
      espacioForm.replaceChildren(h("form", { class: "formulario", novalidate: true,
        onsubmit: async (ev) => {
          ev.preventDefault(); error.hidden = true;
          const falla = (t) => { error.textContent = t; error.hidden = false; };
          if (nombre.value.trim().length < 2) return falla("Escribe el nombre de la empresa.");
          if (dueno.value.trim().length < 2) return falla("Escribe el nombre del dueño.");
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo.value.trim())) return falla("Escribe un correo válido para el dueño.");
          guardar.setAttribute("aria-busy", "true"); guardar.disabled = true;
          try {
            const r = await llamarAdministrar({ accion: "crear_empresa", nombre: nombre.value.trim(), nombre_dueno: dueno.value.trim(), correo_dueno: correo.value.trim() });
            resultado.replaceChildren(bloqueCredencial({ correo: r.correo, clave: r.clave_temporal, yaExistia: r.ya_existia, titulo: "Empresa creada" }));
            nombre.value = dueno.value = correo.value = ""; guardar.hidden = true;
            await cargar();
          } catch (err) { falla(mensajeDeError(err)); }
          finally { guardar.removeAttribute("aria-busy"); guardar.disabled = false; }
        } },
        h("h2", {}, "Nueva empresa"),
        h("div", { class: "campo" }, h("label", { for: "e-nombre" }, "Nombre de la empresa"), nombre),
        h("div", { class: "cuadricula cuadricula--2" },
          h("div", { class: "campo" }, h("label", { for: "e-dueno" }, "Nombre del dueño"), dueno),
          h("div", { class: "campo" }, h("label", { for: "e-correo" }, "Correo del dueño"), correo)),
        error, resultado,
        h("div", { class: "formulario__acciones" }, guardar,
          h("button", { class: "boton boton--secundario", type: "button", onclick: () => espacioForm.replaceChildren() }, "Cerrar"))));
      nombre.focus();
    }
    await cargar();
  }

  // ---------- Lugares: sedes y geocercas ----------
  async function refrescarSedes() {
    estado.sedes = (await q(sb.from("sedes").select("id,nombre,zona_horaria,activa").eq("empresa_id", eid()).order("nombre"))).filter((x) => x.activa);
  }

  async function pintarLugares(zona, ctx) {
    const lista = h("div", {});
    const espacioForm = h("div", {});
    zona.replaceChildren(
      h("p", { class: "nota", style: "margin-bottom:.75rem" }, "Cada sede tiene su zona horaria y una o más geocercas. Por WhatsApp solo se acepta un registro hecho dentro de una geocerca activa."),
      h("div", { class: "formulario__acciones", style: "margin-bottom:.75rem" },
        h("button", { class: "boton boton--primario", type: "button", onclick: () => formularioSede() }, icono("agregar"), "Agregar sede")),
      espacioForm, lista);
    let sedes = []; let geocercas = [];

    async function cargar() {
      lista.replaceChildren(esqueletos(2));
      try {
        [sedes, geocercas] = await Promise.all([
          q(sb.from("sedes").select("id,nombre,direccion,zona_horaria,activa").eq("empresa_id", eid()).order("nombre")),
          q(sb.from("geocercas").select("id,sede_id,nombre,lat,lng,radio_m,activa").eq("empresa_id", eid()).order("creado_at")),
        ]);
        await refrescarSedes();
        if (ctx.vigente()) pintar();
      } catch (err) { if (ctx.vigente()) lista.replaceChildren(bloqueError(err, cargar)); }
    }

    function pintar() {
      if (!sedes.length) {
        lista.replaceChildren(h("div", { class: "vacio" }, h("h2", {}, "Aún no hay sedes"),
          h("p", {}, "Crea la primera sede y ponle su geocerca; sin eso nadie puede registrarse por WhatsApp.")));
        return;
      }
      lista.replaceChildren(h("ul", { class: "lista" }, sedes.map(filaSede)));
    }

    function filaSede(s) {
      const propias = geocercas.filter((g) => g.sede_id === s.id);
      const activas = propias.filter((g) => g.activa).length;
      const detalle = h("div", { class: "detalle", hidden: true });
      const id = `sd-${s.id}`; detalle.id = id;
      const fila = h("button", { class: "fila", type: "button", "aria-expanded": "false", "aria-controls": id,
        onclick: () => { const ab = fila.getAttribute("aria-expanded") === "true"; fila.setAttribute("aria-expanded", String(!ab)); detalle.hidden = ab; if (!ab) pintarSede(s, propias, detalle); } },
        h("span", { class: "avatar", "aria-hidden": "true" }, icono("mapa")),
        h("span", { style: "min-width:0" },
          h("div", { class: "fila__nombre" }, s.nombre),
          h("div", { class: "fila__sub" }, activas ? `${activas} ${activas === 1 ? "geocerca activa" : "geocercas activas"}` : "Sin geocerca activa")),
        h("span", { class: "fila__fin" },
          !s.activa && h("span", { class: "chip chip--baja" }, "Inactiva"),
          s.activa && !activas && h("span", { class: "chip chip--aviso" }, "Falta geocerca")),
        h("span", { class: "fila__flecha" }, icono("flecha")));
      return h("li", {}, fila, detalle);
    }

    function selectorZona(valor, idCampo) {
      return h("select", { class: "entrada", id: idCampo }, ZONAS_HORARIAS_MX.map(([v, t]) => h("option", { value: v, selected: v === valor }, t)));
    }

    function pintarSede(s, propias, cuerpo) {
      const nombre = h("input", { class: "entrada", id: `sn-${s.id}`, value: s.nombre, autocomplete: "off" });
      const direccion = h("input", { class: "entrada", id: `sdir-${s.id}`, value: s.direccion ?? "", autocomplete: "off" });
      const zonaH = selectorZona(s.zona_horaria, `sz-${s.id}`);
      const guardar = h("button", { class: "boton boton--primario boton--chico", type: "button",
        onclick: async () => {
          if (nombre.value.trim().length < 2) { avisar("Escribe el nombre de la sede.", "error"); return; }
          guardar.setAttribute("aria-busy", "true"); guardar.disabled = true;
          try {
            await q(sb.from("sedes").update({ nombre: nombre.value.trim(), direccion: direccion.value.trim() || null, zona_horaria: zonaH.value }).eq("id", s.id));
            avisar("Sede guardada."); await cargar();
          } catch (err) { avisar(err?.code === "23505" ? "Ya tienes una sede con ese nombre." : mensajeDeError(err), "error"); guardar.removeAttribute("aria-busy"); guardar.disabled = false; }
        } }, "Guardar sede");
      let confirmando = false;
      const alterna = h("button", { class: `boton boton--chico ${s.activa ? "boton--peligro" : "boton--secundario"}`, type: "button",
        onclick: async () => {
          if (s.activa && !confirmando) { confirmando = true; alterna.textContent = "Confirmar"; setTimeout(() => { confirmando = false; alterna.textContent = "Desactivar sede"; }, 5000); return; }
          alterna.disabled = true;
          try { await q(sb.from("sedes").update({ activa: !s.activa }).eq("id", s.id)); avisar(s.activa ? "Sede desactivada." : "Sede reactivada."); await cargar(); }
          catch (err) { avisar(mensajeDeError(err), "error"); alterna.disabled = false; }
        } }, s.activa ? "Desactivar sede" : "Reactivar sede");
      const zonaGeo = h("div", {});
      cuerpo.replaceChildren(h("div", { style: "display:grid; gap:.75rem; padding-top:.75rem" },
        h("div", { class: "cuadricula cuadricula--2" },
          h("div", { class: "campo" }, h("label", { for: `sn-${s.id}` }, "Nombre"), nombre),
          h("div", { class: "campo" }, h("label", { for: `sdir-${s.id}` }, "Dirección (opcional)"), direccion)),
        h("div", { class: "campo", style: "max-width:26rem" }, h("label", { for: `sz-${s.id}` }, "Zona horaria"), zonaH),
        h("div", { class: "formulario__acciones" }, guardar, alterna),
        h("h3", { class: "seccion" }, "Geocercas"), zonaGeo));
      pintarGeocercas(s, propias, zonaGeo);
    }

    function pintarGeocercas(s, propias, zonaGeo) {
      const espacio = h("div", {});
      const filas = propias.map((g) => filaGeocerca(g, espacio));
      zonaGeo.replaceChildren(
        propias.length ? h("ul", { class: "lista" }, filas) : h("p", { class: "nota" }, "Esta sede todavía no tiene geocercas."),
        espacio,
        h("div", { class: "formulario__acciones", style: "margin-top:.5rem" },
          h("button", { class: "boton boton--secundario boton--chico", type: "button", onclick: () => formularioGeocerca(s, null, espacio) }, icono("agregar"), "Agregar geocerca")));
    }

    function filaGeocerca(g, espacio) {
      return h("li", { class: "fila fila--fija" },
        h("span", { class: "avatar", "aria-hidden": "true" }, icono("mapa")),
        h("span", { style: "min-width:0" },
          h("div", { class: "fila__nombre" }, g.nombre),
          h("div", { class: "fila__sub" }, `Radio de ${g.radio_m} m · ${Number(g.lat).toFixed(5)}, ${Number(g.lng).toFixed(5)}`)),
        h("span", { class: "fila__fin" },
          !g.activa && h("span", { class: "chip chip--baja" }, "Inactiva"),
          h("a", { class: "boton boton--secundario boton--chico", href: enlaceMapa(g.lat, g.lng), target: "_blank", rel: "noopener noreferrer" }, "Ver mapa"),
          h("button", { class: "boton boton--secundario boton--chico", type: "button", onclick: () => formularioGeocerca({ id: g.sede_id }, g, espacio) }, "Editar")));
    }

    function formularioGeocerca(s, g, espacio) {
      const sufijo = g?.id ?? "nueva";
      const nombre = h("input", { class: "entrada", id: `gn-${sufijo}`, value: g?.nombre ?? "Principal", autocomplete: "off" });
      const coordenadas = h("input", { class: "entrada", id: `gc-${sufijo}`, inputmode: "text", autocomplete: "off", placeholder: "20.6597, -103.3496",
        value: g ? `${g.lat}, ${g.lng}` : "" });
      const radio = h("input", { class: "entrada", id: `gr-${sufijo}`, type: "number", inputmode: "numeric", min: "10", max: "5000", value: String(g?.radio_m ?? 100) });
      const activa = h("input", { type: "checkbox", checked: g ? g.activa : true });
      const error = h("div", { class: "error-campo", role: "alert", hidden: true });
      const falla = (t) => { error.textContent = t; error.hidden = false; };
      const aqui = h("button", { class: "boton boton--secundario boton--chico", type: "button",
        onclick: () => {
          if (!navigator.geolocation) return falla("Este teléfono no permite obtener la ubicación. Pega las coordenadas.");
          aqui.setAttribute("aria-busy", "true"); aqui.disabled = true; error.hidden = true;
          navigator.geolocation.getCurrentPosition(
            (p) => { coordenadas.value = `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`; aqui.removeAttribute("aria-busy"); aqui.disabled = false; },
            () => { falla("No se pudo obtener la ubicación. Da permiso al navegador o pega las coordenadas."); aqui.removeAttribute("aria-busy"); aqui.disabled = false; },
            { enableHighAccuracy: true, timeout: 15000 });
        } }, icono("mapa"), "Usar mi ubicación actual");
      const guardar = h("button", { class: "boton boton--primario", type: "submit" }, g ? "Guardar geocerca" : "Crear geocerca");
      espacio.replaceChildren(h("form", { class: "formulario", novalidate: true, style: "margin-top:.75rem",
        onsubmit: async (ev) => {
          ev.preventDefault(); error.hidden = true;
          const c = parsearCoordenadas(coordenadas.value);
          const malo = errorDeGeocerca({ lat: c?.lat ?? NaN, lng: c?.lng ?? NaN, radio: Number(radio.value) });
          if (nombre.value.trim().length < 1) return falla("Ponle un nombre a la geocerca, por ejemplo Entrada principal.");
          if (malo) return falla(malo);
          guardar.setAttribute("aria-busy", "true"); guardar.disabled = true;
          try {
            const fila = { nombre: nombre.value.trim(), lat: c.lat, lng: c.lng, radio_m: Number(radio.value), activa: activa.checked };
            if (g) await q(sb.from("geocercas").update(fila).eq("id", g.id));
            else await q(sb.from("geocercas").insert({ ...fila, empresa_id: eid(), sede_id: s.id }));
            avisar("Geocerca guardada."); await cargar();
          } catch (err) { falla(mensajeDeError(err)); guardar.removeAttribute("aria-busy"); guardar.disabled = false; }
        } },
        h("h3", {}, g ? "Editar geocerca" : "Nueva geocerca"),
        h("div", { class: "campo" }, h("label", { for: `gn-${sufijo}` }, "Nombre"), nombre),
        h("div", { class: "campo" }, h("label", { for: `gc-${sufijo}` }, "Ubicación (latitud, longitud)"), coordenadas,
          h("small", {}, "Párate en el lugar y usa tu ubicación actual, o en Google Maps mantén presionado el punto y copia los números que aparecen.")),
        h("div", {}, aqui),
        h("div", { class: "campo", style: "max-width:12rem" }, h("label", { for: `gr-${sufijo}` }, "Radio (metros)"), radio,
          h("small", {}, "De 10 a 5000. Para una oficina, 100 m suele bastar.")),
        h("label", { class: "opcion" }, activa, "Activa"),
        error,
        h("div", { class: "formulario__acciones" }, guardar,
          h("button", { class: "boton boton--secundario", type: "button", onclick: () => espacio.replaceChildren() }, "Cancelar"))));
      nombre.focus();
    }

    function formularioSede() {
      if (espacioForm.firstChild) { espacioForm.replaceChildren(); return; }
      const nombre = h("input", { class: "entrada", id: "ns-nombre", autocomplete: "off", required: true });
      const direccion = h("input", { class: "entrada", id: "ns-dir", autocomplete: "off" });
      const zonaH = selectorZona("America/Mexico_City", "ns-zona");
      const error = h("div", { class: "error-campo", role: "alert", hidden: true });
      const guardar = h("button", { class: "boton boton--primario", type: "submit" }, "Crear sede");
      espacioForm.replaceChildren(h("form", { class: "formulario", novalidate: true,
        onsubmit: async (ev) => {
          ev.preventDefault(); error.hidden = true;
          if (nombre.value.trim().length < 2) { error.textContent = "Escribe el nombre de la sede."; error.hidden = false; return; }
          guardar.setAttribute("aria-busy", "true"); guardar.disabled = true;
          try {
            await q(sb.from("sedes").insert({ empresa_id: eid(), nombre: nombre.value.trim(), direccion: direccion.value.trim() || null, zona_horaria: zonaH.value }));
            avisar("Sede creada. Ahora agrégale una geocerca."); espacioForm.replaceChildren(); await cargar();
          } catch (err) { error.textContent = err?.code === "23505" ? "Ya tienes una sede con ese nombre." : mensajeDeError(err); error.hidden = false; }
          finally { guardar.removeAttribute("aria-busy"); guardar.disabled = false; }
        } },
        h("h2", {}, "Nueva sede"),
        h("div", { class: "cuadricula cuadricula--2" },
          h("div", { class: "campo" }, h("label", { for: "ns-nombre" }, "Nombre"), nombre),
          h("div", { class: "campo" }, h("label", { for: "ns-dir" }, "Dirección (opcional)"), direccion)),
        h("div", { class: "campo", style: "max-width:26rem" }, h("label", { for: "ns-zona" }, "Zona horaria"), zonaH),
        error,
        h("div", { class: "formulario__acciones" }, guardar,
          h("button", { class: "boton boton--secundario", type: "button", onclick: () => espacioForm.replaceChildren() }, "Cancelar"))));
      nombre.focus();
    }
    await cargar();
  }

  // ---------- Horarios ----------
  async function pintarHorarios(zona, ctx) {
    const lista = h("div", {});
    const espacioForm = h("div", {});
    zona.replaceChildren(
      h("p", { class: "nota", style: "margin-bottom:.75rem" }, "Un horario dice a qué hora entra la gente cada día y cuánta tolerancia tiene. Después se lo asignas a cada empleado en Equipo. Sin horario no se pueden marcar retardos."),
      h("div", { class: "formulario__acciones", style: "margin-bottom:.75rem" },
        h("button", { class: "boton boton--primario", type: "button", onclick: () => formulario(null) }, icono("agregar"), "Nuevo horario")),
      espacioForm, lista);
    let horarios = []; let dias = []; let asignaciones = [];

    async function cargar() {
      lista.replaceChildren(esqueletos(2));
      try {
        horarios = await q(sb.from("horarios").select("id,nombre,tolerancia_retardo_min,tolerancia_salida_min").eq("empresa_id", eid()).order("nombre"));
        const ids = horarios.map((x) => x.id);
        dias = ids.length ? await q(sb.from("horario_dias").select("id,horario_id,dia_semana,hora_entrada,hora_salida,minutos_pausa").in("horario_id", ids)) : [];
        asignaciones = await q(sb.from("empleado_horarios").select("id,horario_id,vigencia").eq("empresa_id", eid()));
        if (ctx.vigente()) pintar();
      } catch (err) { if (ctx.vigente()) lista.replaceChildren(bloqueError(err, cargar)); }
    }

    function pintar() {
      if (!horarios.length) {
        lista.replaceChildren(h("div", { class: "vacio" }, h("h2", {}, "Aún no hay horarios"),
          h("p", {}, "Crea uno, por ejemplo Oficina de lunes a viernes de 9:00 a 18:00.")));
        return;
      }
      lista.replaceChildren(h("ul", { class: "lista" }, horarios.map((x) => {
        const propios = dias.filter((d) => d.horario_id === x.id);
        const usados = asignaciones.filter((a) => a.horario_id === x.id && (parsearVigencia(a.vigencia)?.hasta ?? "9999") > fechaLocal(new Date(), "America/Mexico_City")).length;
        return h("li", {}, h("button", { class: "fila", type: "button", onclick: () => formulario(x),
            "aria-label": `Editar el horario ${x.nombre}` },
          h("span", { style: "min-width:0" },
            h("div", { class: "fila__nombre" }, x.nombre),
            h("div", { class: "fila__sub" }, resumenHorario(propios) || "Sin días"),
            h("div", { class: "fila__sub" }, `Tolerancia ${x.tolerancia_retardo_min} min · ${usados} ${usados === 1 ? "empleado" : "empleados"}`)),
          h("span", { class: "fila__flecha" }, icono("flecha"))));
      })));
    }

    function formulario(x) {
      const propios = x ? dias.filter((d) => d.horario_id === x.id) : [];
      const nombre = h("input", { class: "entrada", id: "h-nombre", value: x?.nombre ?? "", autocomplete: "off", required: true });
      const tolRetardo = h("input", { class: "entrada", id: "h-tr", type: "number", inputmode: "numeric", min: "0", max: "240", value: String(x?.tolerancia_retardo_min ?? 10) });
      const tolSalida = h("input", { class: "entrada", id: "h-ts", type: "number", inputmode: "numeric", min: "0", max: "240", value: String(x?.tolerancia_salida_min ?? 0) });
      const ORDEN = [1, 2, 3, 4, 5, 6, 0];
      const filasDia = ORDEN.map((n) => {
        const d = propios.find((p) => p.dia_semana === n);
        const marca = h("input", { type: "checkbox", checked: d ? true : (!x && n >= 1 && n <= 5), "aria-label": `Trabaja el ${NOMBRES_DIA[n]}` });
        const entrada = h("input", { class: "entrada", type: "time", value: d ? String(d.hora_entrada).slice(0, 5) : "09:00", "aria-label": `Entrada del ${NOMBRES_DIA[n]}` });
        const salida = h("input", { class: "entrada", type: "time", value: d ? String(d.hora_salida).slice(0, 5) : "18:00", "aria-label": `Salida del ${NOMBRES_DIA[n]}` });
        const pausa = h("input", { class: "entrada", type: "number", inputmode: "numeric", min: "0", max: "240", value: String(d?.minutos_pausa ?? 0), "aria-label": `Minutos de pausa del ${NOMBRES_DIA[n]}` });
        const fila = h("div", { class: "cuadricula", style: "grid-template-columns:5.5rem 1fr 1fr 4.5rem; align-items:center; gap:.5rem" },
          h("label", { class: "opcion" }, marca, NOMBRES_DIA[n][0].toUpperCase() + NOMBRES_DIA[n].slice(1, 3)), entrada, salida, pausa);
        return { n, marca, entrada, salida, pausa, fila };
      });
      const error = h("div", { class: "error-campo", role: "alert", hidden: true });
      const guardar = h("button", { class: "boton boton--primario", type: "submit" }, x ? "Guardar horario" : "Crear horario");
      let confirmando = false;
      const borrar = x && h("button", { class: "boton boton--peligro", type: "button",
        onclick: async () => {
          if (!confirmando) { confirmando = true; borrar.textContent = "Confirmar eliminar"; setTimeout(() => { confirmando = false; borrar.textContent = "Eliminar horario"; }, 5000); return; }
          borrar.disabled = true;
          try { await q(sb.from("horarios").delete().eq("id", x.id)); avisar("Horario eliminado."); espacioForm.replaceChildren(); await cargar(); }
          catch (err) { error.textContent = err?.code === "23503" ? "Este horario está asignado a empleados. Cámbiales el horario en Equipo y vuelve a intentar." : mensajeDeError(err); error.hidden = false; borrar.disabled = false; }
        } }, "Eliminar horario");
      espacioForm.replaceChildren(h("form", { class: "formulario", novalidate: true,
        onsubmit: async (ev) => {
          ev.preventDefault(); error.hidden = true;
          const elegidos = filasDia.filter((f) => f.marca.checked).map((f) => ({
            dia_semana: f.n, hora_entrada: f.entrada.value, hora_salida: f.salida.value, minutos_pausa: Number(f.pausa.value || 0),
          }));
          const datos = { nombre: nombre.value, tolerancia_retardo_min: Number(tolRetardo.value), tolerancia_salida_min: Number(tolSalida.value), dias: elegidos };
          const malo = errorDeHorario(datos);
          if (malo) { error.textContent = malo; error.hidden = false; return; }
          guardar.setAttribute("aria-busy", "true"); guardar.disabled = true;
          try {
            const cabecera = { nombre: nombre.value.trim(), tolerancia_retardo_min: datos.tolerancia_retardo_min, tolerancia_salida_min: datos.tolerancia_salida_min };
            let id = x?.id;
            if (id) { await q(sb.from("horarios").update(cabecera).eq("id", id)); await q(sb.from("horario_dias").delete().eq("horario_id", id)); }
            else id = (await q(sb.from("horarios").insert({ ...cabecera, empresa_id: eid() }).select("id").single())).id;
            await q(sb.from("horario_dias").insert(elegidos.map((d) => ({ ...d, horario_id: id }))));
            avisar("Horario guardado."); espacioForm.replaceChildren(); await cargar();
          } catch (err) { error.textContent = err?.code === "23505" ? "Ya tienes un horario con ese nombre." : mensajeDeError(err); error.hidden = false; await cargar(); }
          finally { guardar.removeAttribute("aria-busy"); guardar.disabled = false; }
        } },
        h("h2", {}, x ? `Editar ${x.nombre}` : "Nuevo horario"),
        h("div", { class: "campo" }, h("label", { for: "h-nombre" }, "Nombre"), nombre),
        h("div", { class: "cuadricula cuadricula--2" },
          h("div", { class: "campo" }, h("label", { for: "h-tr" }, "Tolerancia de entrada (min)"), tolRetardo, h("small", {}, "Pasado este tiempo cuenta como retardo.")),
          h("div", { class: "campo" }, h("label", { for: "h-ts" }, "Tolerancia de salida (min)"), tolSalida)),
        h("fieldset", { class: "opciones" }, h("legend", { class: "campo__etiqueta" }, "Días, entrada, salida y pausa (min)"),
          filasDia.map((f) => f.fila),
          h("p", { class: "nota" }, "Si la salida es menor que la entrada, el turno cruza la medianoche.")),
        error,
        h("div", { class: "formulario__acciones" }, guardar, borrar,
          h("button", { class: "boton boton--secundario", type: "button", onclick: () => espacioForm.replaceChildren() }, "Cancelar"))));
      espacioForm.scrollIntoView?.({ block: "start" });
      nombre.focus();
    }
    await cargar();
  }

  // ---------- Cuenta y ayuda ----------
  const DESARROLLADOR = { nombre: "Jose Rigoberto Barocio Sida", correo: "jose.rigoberto@gmail.com", sitio: "Guadalajara, Jalisco, México" };

  function vistaCuenta(cont, ctx) {
    const formClave = formularioClave({ alListo: async () => { avisar("Contraseña actualizada."); } });
    const pintar = () => {
      if (!ctx.vigente()) { window.removeEventListener("rc:estado", pintar); return; }
      const RC = window.RC ?? {};
      const nombre = nombreUsuario();
      const botonActualizar = h("button", { class: "boton boton--secundario boton--chico", type: "button",
        onclick: async (e) => {
          const b = e.currentTarget; b.setAttribute("aria-busy", "true"); b.disabled = true;
          try {
            const r = await (window.RC?.buscarActualizacion?.() ?? "no-disponible");
            avisar(r === "nueva" ? "Hay una versión nueva. Pulsa “Actualizar ahora”." : r === "al-dia" ? "Ya tienes la última versión." : "No se pudo comprobar ahora.", r === "no-disponible" ? "error" : "ok");
          } catch { avisar("No se pudo comprobar. Revisa tu conexión.", "error"); }
          finally { b.removeAttribute("aria-busy"); b.disabled = false; }
        } }, icono("refrescar"), "Buscar actualización");
      cont.replaceChildren(
        h("div", { class: "cabecera" }, h("div", { class: "cabecera__texto" }, h("h1", {}, "Cuenta"), h("p", {}, "Tu usuario, la ayuda y la aplicación"))),
        h("h2", { class: "seccion" }, "Tu cuenta"),
        h("ul", { class: "lista" },
          h("li", { class: "fila fila--fija" }, h("span", { class: "avatar", "aria-hidden": "true" }, iniciales(nombre)),
            h("span", { style: "min-width:0" }, h("div", { class: "fila__nombre" }, nombre), h("div", { class: "fila__sub" }, estado.sesion.user.email))),
          h("li", { class: "fila fila--fija" }, h("span", { class: "avatar", "aria-hidden": "true" }, icono("equipo")),
            h("span", { style: "min-width:0" }, h("div", { class: "fila__nombre" }, estado.empresa?.nombre ?? "Sin empresa"),
              h("div", { class: "fila__sub" }, estado.sedes.length ? `${estado.sedes.length} ${estado.sedes.length === 1 ? "sede" : "sedes"}: ${estado.sedes.map((x) => x.nombre).join(", ")}` : "Sin sedes todavía")),
            h("span", { class: "fila__fin" }, h("span", { class: "chip" }, ROLES[estado.miembro.rol] ?? estado.miembro.rol)))),
        selectorEmpresa() && h("div", { style: "margin-top:.75rem" }, selectorEmpresa()),
        h("h2", { class: "seccion" }, "Contraseña"),
        formClave,
        h("h2", { class: "seccion" }, "Ayuda y aplicación"),
        h("ul", { class: "lista" },
          h("li", { class: "fila fila--fija" }, h("span", { class: "avatar", "aria-hidden": "true" }, icono("refrescar")),
            h("span", { style: "min-width:0" }, h("div", { class: "fila__nombre" }, "Versión de la aplicación"),
              h("div", { class: "fila__sub" }, RC.version ? `${RC.version}${RC.hayActualizacion ? " · hay una versión nueva" : ""}` : "sin determinar")),
            h("span", { class: "fila__fin" }, RC.hayActualizacion
              ? h("button", { class: "boton boton--primario boton--chico", type: "button", onclick: () => RC.aplicarActualizacion() }, "Actualizar ahora")
              : botonActualizar)),
          h("li", { class: "fila fila--fija" }, h("span", { class: "avatar", "aria-hidden": "true" }, icono("camara")),
            h("span", { style: "min-width:0" }, h("div", { class: "fila__nombre" }, "Instalar en este teléfono"),
              h("div", { class: "fila__sub" }, RC.instalada ? "Ya está instalada: la abres como una app." : RC.puedeInstalar ? "Se agrega a la pantalla de inicio." : "En Chrome: menú ⋮, “Instalar app” o “Agregar a la pantalla de inicio”.")),
            h("span", { class: "fila__fin" }, RC.puedeInstalar && h("button", { class: "boton boton--primario boton--chico", type: "button", onclick: () => RC.instalar() }, "Instalar"))),
          h("li", { class: "fila fila--fija" }, h("span", { class: "avatar", "aria-hidden": "true" }, icono("mapa")),
            h("span", { style: "min-width:0" }, h("div", { class: "fila__nombre" }, "Conexión"),
              h("div", { class: "fila__sub" }, "Sin internet puedes abrir la app y ver lo último que cargaste; los cambios necesitan conexión.")),
            h("span", { class: "fila__fin" }, h("span", { class: `chip ${navigator.onLine ? "chip--ok" : "chip--aviso"}` }, navigator.onLine ? "En línea" : "Sin conexión")))),
        h("h2", { class: "seccion" }, "Cómo se usa"),
        h("ul", { class: "ayuda" },
          h("li", {}, h("strong", {}, "Hoy: "), "toca a un empleado para ver su hora, su selfie y su ubicación. Lo que falta aparece primero, en rojo."),
          h("li", {}, h("strong", {}, "Equipo: "), "agrega al empleado y mándale la invitación por WhatsApp; él solo acepta el aviso de privacidad."),
          h("li", {}, h("strong", {}, "Correcciones: "), "los registros no se editan; se pide una corrección y queda constancia de quién la aprobó."),
          h("li", {}, h("strong", {}, "Señales: "), "una señal no acusa a nadie; solo avisa que conviene revisar el registro.")),
        h("h2", { class: "seccion" }, "Desarrollador"),
        h("ul", { class: "lista" },
          h("li", { class: "fila fila--fija" }, h("span", { class: "avatar", "aria-hidden": "true" }, iniciales(DESARROLLADOR.nombre)),
            h("span", { style: "min-width:0" }, h("div", { class: "fila__nombre" }, DESARROLLADOR.nombre),
              h("div", { class: "fila__sub" }, DESARROLLADOR.sitio)),
            h("span", { class: "fila__fin" }, h("a", { class: "boton boton--secundario boton--chico", href: `mailto:${DESARROLLADOR.correo}` }, "Escribir")))),
        h("div", { class: "formulario__acciones", style: "margin-top:1rem" },
          h("a", { class: "boton boton--secundario", href: "../privacidad.html", target: "_blank", rel: "noopener" }, "Aviso de privacidad"),
          h("button", { class: "boton boton--secundario", type: "button", onclick: cerrarSesion }, icono("salir"), "Cerrar sesión")));
    };
    window.addEventListener("rc:estado", pintar);
    pintar();
  }

  // ---------- Inicio ----------
  async function iniciar() {
    if (!sb) return pantallaSinConfigurar();
    window.addEventListener("hashchange", rutear);
    sb.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT" && estado.sesion) { estado.sesion = null; pantallaAcceso(); } });
    await arrancarConSesion();
  }
  return iniciar();
}
