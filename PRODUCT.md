# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

HTML, CSS y JavaScript sin paso de compilación (decisión del usuario, 2026-10-19). Backend: Supabase (Auth, Postgres con RLS, Storage, Edge Functions). Se publica como sitio estático en GitHub Pages, carpeta `docs/` del repositorio público; el NAS no tiene Node.

## Users

Dueños y administradores de pymes mexicanas que controlan la asistencia de su personal. Usan el panel sobre todo desde el celular (revisar quién llegó, aprobar una corrección, invitar a un empleado) y desde computadora para reportes. Sus empleados no usan el panel: registran la asistencia por WhatsApp. Rol secundario: supervisor de sede, que ve solo sus sedes.

## Product Purpose

Panel de administración de RelojChecador, un control de asistencia por WhatsApp. El empleado manda su ubicación y una selfie al bot; el panel le muestra al dueño qué pasó: quién llegó, quién falta, con qué evidencia, y le deja invitar empleados y resolver correcciones. Éxito: el dueño sabe en segundos quién está en cada sede y puede confiar en cada registro como evidencia.

## Positioning

Registro por WhatsApp sin instalar una app, con evidencia por registro (ubicación validada contra la geocerca de la sede y selfie) y registros inmutables: los cambios se hacen con correcciones que dejan constancia. Precio y alcance frente a la competencia aún sin decidir.

## Operating Context

- Cada registro nace en una conversación de WhatsApp: tipo (entrada, salida, pausa), hora del servidor, ubicación, distancia a la geocerca, selfie y señales de riesgo (secuencia inusual, ubicación elegida o repetida, foto repetida, cambio de número reciente, hora desfasada). Las señales marcan, no bloquean.
- Empresa, sedes (con zona horaria y geocerca), empleados, horarios y roles (dueño, admin, supervisor, consulta) ya existen en la base. El supervisor ve solo sus sedes (RLS).
- La invitación al empleado es un enlace de WhatsApp con un código de un solo uso, que genera la función `crear-invitacion`; solo dueño o administrador pueden invitar.
- Las correcciones (agregar, cambiar hora, anular) las piden supervisor, admin o dueño y se aprueban con una función que valida rol y alcance.
- Zona horaria por sede; México usa varias.

## Capabilities and Constraints

- La interfaz y todo el texto en español de México.
- Los registros no se editan ni se borran; el panel solo los lee. Escrituras operativas van por funciones del servidor.
- La selfie está en un bucket privado de Supabase Storage; el panel debe pedirla con la sesión del usuario.
- Primera versión: inicio de sesión, tablero del día, empleados con invitación y correcciones. Reportes, horarios, sedes/geocercas en mapa, facturación y roles avanzados quedan para después.
- Aún sin decidir: cómo se da de alta la primera empresa y su dueño (hoy por SQL), y cómo se administran sedes y horarios desde el panel.

## Brand Commitments

Nombre del producto: RelojChecador. No hay logotipo, paleta ni voz de marca definidos; el usuario no ha fijado ninguna restricción visual.

## Evidence on Hand

- Documentación del proyecto en `docs/` (funcionalidades, esquema, webhook) y análisis de competidores hechos durante el proyecto.
- Datos reales de prueba: una empresa, una sede, un empleado y un registro de entrada con selfie hechos desde un celular real.
- No hay clientes, testimonios, cifras de uso ni precios reales; no inventarlos.

## Product Principles

1. El registro es evidencia: el panel nunca da a entender que un registro se puede alterar; lo corregido se distingue del original.
2. Primero lo urgente: quién falta y qué requiere decisión, antes que reportes.
3. Pensado para el celular del dueño: una mano, conexión irregular, decisiones en pocos toques.
4. Las señales de riesgo informan sin acusar: un empleado no es culpable por una señal.
5. Cada usuario ve solo lo que le corresponde por empresa y sede.

## Accessibility & Inclusion

Uso al aire libre y con una mano en celulares comunes. Texto legible y áreas táctiles amplias; el color nunca es el único indicador de estado. No se estableció un estándar formal adicional.
