---
version: 1
slug: "docs-panel"
primary_target: "docs/panel"
related_targets: []
---

# Panel de RelojChecador (docs/panel)

Modo: Operate. Construcción: code-led (sin comps de imagen). Superficie: panel de administración móvil primero, sitio estático.

## Direction contract

THESIS: el panel se lee como la tarjeta de un reloj checador: lo normal en azul tinta de sello, el retardo en rojo, y cada hora es un sello. Rechaza el tablero genérico de tarjetas con números grandes: manda primero quién falta y qué requiere decisión.

OWN-WORLD: barra azul tinta muy oscura con riel en escritorio y menú inferior en celular; papel gris azulado claro; superficies blancas en listas con separadores; sellos en tipografía monoespaciada con borde de 1.5 px (salida gris tinta, pausa punteada, retardo rojo con relleno suave y borde grueso, corregido con borde doble, "faltan" con sello rojo punteado vacío); señales en ámbar; sans del sistema con numerales tabulares.

STORY: el dueño abre el panel con una mano, ve de inmediato quién falta y quién llegó tarde, abre un empleado para ver su evidencia (selfie, ubicación, señales) y resuelve una corrección en dos toques.

FIRST VIEWPORT: "Hoy" con la fecha, un renglón de conteos por grupo y luego los grupos en orden de urgencia (Faltan primero, en rojo), cada empleado como fila con avatar de iniciales y su último sello; el menú inferior de cuatro destinos.

FORM: tablero de operación de tres columnas lógicas (avatar, texto, estado) con filas expandibles; elegido por el usuario entre tres direcciones presentadas en texto (tarjeta de reloj, verde WhatsApp sobrio, estándar neutro). dirección fijada por el usuario entre tres opciones; no se corrió concept-seed (una dirección fijada por el usuario tiene prioridad sobre el sorteo).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
