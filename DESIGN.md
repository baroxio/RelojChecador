---
name: RelojChecador (panel web)
description: Panel de asistencia que se lee como la tarjeta de un reloj checador, con la hora de cada registro como sello.
colors:
  tinta-950: "#0c1530"
  tinta-900: "#101b3b"
  tinta-800: "#17275a"
  tinta-700: "#1e3a8a"
  tinta-600: "#2748a8"
  tinta-200: "#c9d4f0"
  tinta-100: "#e3e9f8"
  papel: "#eef1f7"
  superficie: "#ffffff"
  linea: "#d3dae8"
  linea-fuerte: "#aab4cc"
  texto: "#131c36"
  suave: "#4f5a76"
  rojo: "#b3261e"
  rojo-fondo: "#fce9e7"
  ambar: "#7a4b00"
  ambar-fondo: "#fff1d0"
  gris-tinta: "#3b4259"
  verde: "#1b6b3a"
  verde-fondo: "#e2f3e8"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.4375rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tabular-nums"
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 650
    lineHeight: 1.5
  caption:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  sello-hora:
    fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, 'Liberation Mono', monospace"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  sello-tipo:
    fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, 'Liberation Mono', monospace"
    fontSize: "0.75rem"
    fontWeight: 700
    letterSpacing: "0.08em"
rounded:
  sm: "6px"
  md: "10px"
  pill: "1rem"
  full: "50%"
spacing:
  xs: "0.35rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.tinta-700}"
    textColor: "{colors.superficie}"
    rounded: "{rounded.sm}"
    padding: "0 1rem"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.tinta-600}"
  button-secondary:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.tinta-700}"
    rounded: "{rounded.sm}"
    padding: "0 1rem"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.tinta-100}"
  button-danger:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.rojo}"
    rounded: "{rounded.sm}"
    padding: "0 1rem"
    height: "44px"
  button-danger-hover:
    backgroundColor: "{colors.rojo-fondo}"
  input:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.texto}"
    rounded: "{rounded.sm}"
    padding: "0.55rem 0.75rem"
    height: "44px"
  sello:
    backgroundColor: "transparent"
    textColor: "{colors.tinta-700}"
    rounded: "{rounded.sm}"
    padding: "0.12rem 0.55rem 0.15rem"
  sello-retardo:
    backgroundColor: "{colors.rojo-fondo}"
    textColor: "{colors.rojo}"
    rounded: "{rounded.sm}"
  chip:
    backgroundColor: "{colors.tinta-100}"
    textColor: "{colors.tinta-800}"
    rounded: "{rounded.pill}"
    padding: "0.12rem 0.55rem"
  chip-ok:
    backgroundColor: "{colors.verde-fondo}"
    textColor: "{colors.verde}"
  chip-aviso:
    backgroundColor: "{colors.ambar-fondo}"
    textColor: "{colors.ambar}"
  chip-rojo:
    backgroundColor: "{colors.rojo-fondo}"
    textColor: "{colors.rojo}"
  lista:
    backgroundColor: "{colors.superficie}"
    rounded: "{rounded.md}"
  fila:
    backgroundColor: "{colors.superficie}"
    padding: "0.7rem 0.9rem"
    height: "56px"
  barra:
    backgroundColor: "{colors.tinta-900}"
    textColor: "{colors.superficie}"
    height: "3.5rem"
  nav:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.suave}"
    height: "4rem"
  avatar:
    backgroundColor: "{colors.tinta-100}"
    textColor: "{colors.tinta-800}"
    rounded: "{rounded.full}"
    size: "2.5rem"
---

# Design System: RelojChecador (panel web)

## Overview

**Creative North Star: "La tarjeta de reloj"**

El panel se lee como la tarjeta de un reloj checador: lo normal va en azul de tinta de sello, el retardo en rojo de sello, y cada hora de registro es un sello estampado. La escena de uso es el dueño de una pyme con una mano en el celular, a la luz del día; por eso el tema es claro, de alto contraste, con áreas táctiles de 44 px como mínimo. Manda primero lo urgente (quién falta, qué requiere decisión) y no un tablero de tarjetas con números grandes.

La densidad es de operación: listas blancas con separadores finas sobre un papel gris azulado, filas de tres columnas lógicas (avatar, texto, estado) que se expanden para mostrar la evidencia. No hay imágenes decorativas; la única imagen es la selfie del registro. El tipo es el sans del sistema con numerales tabulares y un monoespaciado reservado a los sellos.

**Key Characteristics:**
- Tema claro único (`color-scheme: light`), azul tinta como único acento de marca.
- Plano: profundidad por contorno y tono, sombra solo en el aviso flotante y la caja de acceso.
- La hora es el elemento gráfico: el sello monoespaciado con borde.
- El estado nunca depende solo del color: el borde (sólido, punteado, grueso, doble) y el texto lo repiten.
- Áreas táctiles de 44 px; movimiento corto (160 a 200 ms) y apagado con `prefers-reduced-motion`.

## Colors

Paleta de azul tinta sobre papel frío, con rojo, ámbar y verde solo como semántica de estado.

### Primary
- **Azul Tinta de Sello** (`tinta-700`, #1e3a8a): botón primario, enlaces, sello normal, destino activo del menú. Su variante `tinta-600` (#2748a8) es hover y anillo de foco.
- **Azul Tinta Noche** (`tinta-900`, #101b3b): barra superior, riel de escritorio y fondo de la pantalla de acceso. `tinta-950` (#0c1530) es el aviso flotante; `tinta-800` (#17275a) es hover del riel y texto de avatar y chip.

### Secondary
- **Rojo de Sello** (`rojo`, #b3261e) con `rojo-fondo` (#fce9e7): retardo, ausencia (grupo Faltan), errores, acción de peligro, contador de pendientes en el menú.
- **Ámbar de Señal** (`ambar`, #7a4b00) con `ambar-fondo` (#fff1d0): señales de riesgo y avisos; informan sin acusar.
- **Verde Sobrio** (`verde`, #1b6b3a) con `verde-fondo` (#e2f3e8): chip de estado correcto y aviso de éxito.

### Neutral
- **Papel Frío** (`papel`, #eef1f7): fondo de la página. **Superficie** (`superficie`, #ffffff): listas, formularios, menú inferior.
- **Línea** (`linea`, #d3dae8) para separadores y bordes de lista; **Línea Fuerte** (`linea-fuerte`, #aab4cc) para campos, selfie y filas expandidas.
- **Texto** (`texto`, #131c36), **Suave** (`suave`, #4f5a76) para texto secundario, **Gris Tinta** (`gris-tinta`, #3b4259) para salida y chip de baja. `tinta-200` (#c9d4f0) es texto sobre fondo oscuro; `tinta-100` (#e3e9f8) es hover de fila y relleno de avatar.

### Named Rules
**The Sello Rojo Rule.** El rojo significa retardo, ausencia o error y nada más. No se usa como decoración ni para botones primarios.
**The Color No Basta Rule.** Todo estado con color lleva además texto o un cambio de borde (grueso, punteado, doble).

## Typography

**Display Font:** no hay; el título más grande es el encabezado de pantalla.
**Body Font:** system-ui (con -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial)
**Label/Mono Font:** ui-monospace (SF Mono, Cascadia Mono, Consolas, Liberation Mono), solo en sellos y en el código de invitación.

**Character:** sans nativo, rápido y sin personalidad propia, para que la personalidad la pongan los sellos. Los numerales tabulares (`font-variant-numeric: tabular-nums` en `body`) alinean las horas en columnas.

### Hierarchy
- **Headline** (700, 1.4375rem, 1.2, -0.01em): título de pantalla (`h1`).
- **Title** (700, 1.1875rem, 1.25): `h2`; los títulos de grupo bajan a 1rem.
- **Body** (400, 1rem, 1.5): texto base. Nombre de fila en 650.
- **Label** (650, 0.9375rem): botones, etiquetas de campo, texto de menú en riel.
- **Caption** (0.8125rem): subtítulos de fila, notas, errores de campo, chips (700), menú inferior (600).
- **Sello** (mono 700): hora a 1rem y tipo a 0.75rem con 0.08em.

Escala completa: `--t-xs` 0.8125, `--t-sm` 0.9375, `--t-md` 1, `--t-lg` 1.1875, `--t-xl` 1.4375 rem; cinco pasos, razón cercana a 1.15.

### Named Rules
**The Hora Es Sello Rule.** Una hora de registro se muestra siempre como sello monoespaciado, nunca como texto suelto.

## Layout

Móvil primero. Una columna de contenido con `max-width` de 60rem, relleno de 1rem y espacio inferior para el menú fijo. A partir de 56rem la barra se vuelve un riel izquierdo de 15rem (sticky, alto completo) con la navegación dentro, y el contenido pasa a la segunda columna (máx. 64rem, relleno 1.75rem 2rem). A partir de 40rem las filas pasan de dos renglones a una sola línea (avatar, texto, estado, flecha), los formularios usan dos columnas (`cuadricula--2`) y el detalle pone la selfie junto a los datos.

Ritmo: pasos de 0.35, 0.5, 0.75, 0.9, 1 y 1.5 rem; los grupos de lista se separan 1.5rem. Las filas miden al menos 56 px y todo control al menos 44 px. Se respetan `env(safe-area-inset-*)` arriba y abajo.

El primer viewport de "Hoy": fecha, renglón de chips con conteos por grupo, y los grupos en orden de urgencia con Faltan primero.

## Elevation & Depth

Plano por defecto. La jerarquía se da con contorno de 1px (`linea`), tono (papel contra superficie blanca) y bordes más gruesos en los sellos. La única sombra (`--sombra`: `0 1px 2px rgb(16 27 59 / 0.08), 0 4px 14px rgb(16 27 59 / 0.06)`) se usa en el aviso flotante y la caja de acceso, que flotan sobre otra capa.

### Named Rules
**The Plano Rule.** Las listas y filas no llevan sombra. La elevación solo aparece en lo que flota sobre el contenido.

## Shapes

Esquinas suaves y medidas: 6px (`rounded.sm`) en botones, campos, sellos, selfie y señales; 10px (`rounded.md`) en listas, formularios, estados vacíos y caja de acceso; píldora (1rem) en chips y contador; círculo en avatares. El anillo de foco usa 4px. Los sellos son rectángulos con borde: el estilo del borde es parte del significado (ver Components).

## Components

### Buttons
- **Shape:** esquina de 6px, alto mínimo de 44px, relleno horizontal de 1rem, texto de 0.9375rem en peso 650, borde de 1.5px.
- **Primary:** fondo `tinta-700`, texto blanco; hover `tinta-600`.
- **Secondary:** fondo blanco, texto `tinta-700`, borde `linea-fuerte`; hover con fondo `tinta-100` y borde `tinta-700`.
- **Peligro:** blanco con texto y borde rojos; hover `rojo-fondo`.
- **Texto / icono:** el de texto va subrayado; el de icono mide 44 por 44.
- **Estados:** `:active` baja 1px; deshabilitado u ocupado a 60% de opacidad; transición de 160 ms.

### Sello (componente firma)
Hora del registro con el tipo en abreviatura. Monoespaciado, fondo transparente, borde de 1.5px del color del texto, esquina de 6px.
- **Entrada:** `tinta-700`, borde sólido. **Salida:** `gris-tinta`. **Pausa (inicio y fin):** `suave`, borde punteado.
- **Retardo:** texto rojo, fondo `rojo-fondo`, borde grueso de 2.5px.
- **Corregido:** borde doble de 4px; así lo corregido se distingue del original.
- **Vacío (sin registro):** rojo, borde punteado, hora `--:--`.

### Chips
Píldora de 0.8125rem en peso 700. Base `tinta-100`; `--ok` verde; `--aviso` ámbar; `--rojo` rojo; `--baja` gris. Sirven para conteos por grupo y estado de empleado.

### Lista y filas expandibles
Contenedor blanco con borde de 1px, esquina de 10px y separadores entre filas. La fila es un botón de tres columnas (avatar de iniciales de 2.5rem, texto, flecha) con el último sello debajo en móvil y a la derecha desde 40rem. Hover `tinta-100`. Al abrir, la flecha gira 180° (200 ms) y aparece el panel de detalle (fondo #f8f9fd, borde superior punteado) con selfie de 3:4, cronología de sellos y señales ámbar. El grupo de alerta (Faltan) pinta título, avatar, borde y fila en rojo suave.

### Inputs / Fields
Alto de 44px, borde de 1.5px `linea-fuerte`, esquina de 6px, fondo blanco; hover con borde `suave`. Foco: anillo de 3px `tinta-600` y borde `tinta-700`. Error: borde rojo, fondo `rojo-fondo` y mensaje en rojo 0.8125rem en peso 600. Etiqueta arriba en peso 650.

### Navigation
Mismo componente en dos formas. En celular, menú inferior fijo de cuatro destinos (Hoy, Equipo, Correcciones, Más) sobre fondo blanco con borde superior; ícono SVG de 24px y texto de 0.8125rem; el destino activo va en `tinta-700` con barra de 3px arriba. Desde 56rem es un riel oscuro dentro de la barra `tinta-900`: enlaces en fila, hover `tinta-800`, activo con fondo `tinta-700` y texto blanco. El contador de pendientes en Correcciones es una píldora roja.

### Estados y avisos
Vacío: caja blanca con borde punteado, texto centrado. Avisos en bloque en ámbar, rojo o verde. Esqueleto de carga con brillo de 1.4s. Aviso flotante en `tinta-950` (rojo si es error) que entra en 200 ms.

## Do's and Don'ts

### Do:
- **Do** poner primero lo urgente: el grupo Faltan va arriba y en rojo.
- **Do** mostrar toda hora de registro como sello, y distinguir lo corregido con el borde doble.
- **Do** mantener 44px de área táctil y el anillo de foco de 3px `tinta-600`.
- **Do** repetir cada estado de color con texto o con un cambio de borde.
- **Do** usar los tokens de `:root` en `styles.css` en lugar de valores nuevos.

### Don't:
- **Don't** usar el rojo fuera de retardo, ausencia o error.
- **Don't** armar tableros de tarjetas con números grandes; las cifras van como chips de conteo.
- **Don't** poner sombra a listas o filas.
- **Don't** presentar una señal ámbar como acusación: informa, no culpa.
- **Don't** mostrar un registro como editable; los cambios son correcciones que se ven como tales.
