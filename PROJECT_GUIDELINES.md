# Project Guidelines — Croquis Map Editor

## Objetivo

Crear una herramienta web local, simple y estable, para editar croquis de mapas sobre una grilla. Debe servir para diseñar recorridos, salas, obstáculos y anotaciones visuales sin depender de herramientas pesadas.

## Principios de diseño

1. Priorizar estabilidad sobre features complejas.
2. Mantener la herramienta usable como archivo local.
3. Evitar dependencias externas salvo necesidad clara.
4. Mantener el modelo de datos retrocompatible.
5. Toda función nueva debe ser simple de probar manualmente.
6. Evitar cambios grandes si una solución incremental alcanza.
7. No romper guardado/carga JSON existentes.
8. No convertir el proyecto en una app compleja si no hace falta.

## Stack

- HTML
- CSS
- JavaScript vanilla
- SVG para render del mapa
- Canvas solo para exportar PNG
- JSON para guardar/cargar

No usar frameworks por ahora.

## Modelo de interacción

- Click en celda vacía con herramienta activa: crear bloque 1x1.
- Click sostenido + drag en vacío con herramienta activa: crear bloque rectangular.
- Click sobre bloque: seleccionar/mover.
- Doble click sobre bloque: enfocar edición de texto.
- Manijas visibles en bloque seleccionado en esta versión base.
- Resize solo mientras se mantiene presionado el mouse.
- Soltar mouse debe limpiar el estado activo de resize.
- Herramienta Seleccionar/mover + drag en vacío: pan/scroll del mapa.
- Flechas del teclado: mover bloque seleccionado una celda.
- Ctrl+Z: deshacer.

## Herramientas actuales

- Seleccionar / mover
- Camino
- Camino cerrado
- Camino en bajada
- Caída
- Camino en subida
- Impulso vertical
- Obstáculo
- Mini sala vacía
- Inicio/Fin
- Status
- Texto libre

## Reglas visuales

- Fondo general gris claro.
- Grilla gris clara.
- Bloques alineados a grilla.
- Texto debe quedar siempre dentro del bloque.
- Si el texto no entra, se recorta.
- Todos los bloques que tengan texto usan wrapping multilínea.
- El bloque Texto libre no muestra texto en la caja de herramientas, pero al colocarlo en mapa trae `texto` por defecto.
- Inicio/Fin no trae texto por defecto.
- Camino puede contener texto.
- Caminos rectangulares no deben mostrar paredes internas.
- Caminos diferentes solo se ven unidos cuando comparten celdas, no cuando están simplemente lado a lado.

## Guardado JSON

El JSON debe mantener retrocompatibilidad.

Debe incluir, como mínimo:

- `schema`
- `version`
- `savedAt`
- `grid`
- `toolOrder`
- `blockCatalog`
- `items`

Cada item debe incluir:

- `id`
- `type`
- `col`
- `row`
- `w`
- `h`
- `text`
- `rotation`
- `textSize`
- `style`
- `meta`

Si en futuras versiones se agregan herramientas nuevas, los JSON viejos deben seguir cargando.

Si un JSON trae una herramienta desconocida pero viene en `blockCatalog`, debe intentar reconstruirse.

## Deshacer

- Mantener historial de 10 estados.
- Ctrl+Z y botón Deshacer deben usar la misma función.
- Deshacer debe cubrir creación, borrado, movimiento, resize, texto, capa, cargar JSON, limpiar mapa y reordenar herramientas.
- Evitar que una acción deje estados activos colgados como `resizeDrag`, `dragMove` o `createDrag`.

## Riesgos conocidos

- El archivo único HTML se volvió demasiado largo para algunos entornos de edición/canvas.
- Mantener el proyecto separado en `index.html`, `styles.css` y `app.js`.
- El guardado directo tipo Word no es confiable en navegador local por permisos. Usar Guardar JSON como descarga/diálogo.
- File System Access API no debe ser requisito.
- Probar siempre en navegador local después de modificar eventos de mouse o teclado.

## Checklist antes de aceptar cambios

Después de cualquier cambio, probar:

1. Carga inicial: aparecen herramientas y grilla.
2. Crear bloque 1x1.
3. Crear bloque rectangular con drag.
4. Seleccionar y mover bloque.
5. Redimensionar bloque con manijas.
6. Editar texto y tamaño.
7. Texto largo se mantiene dentro del bloque.
8. Mover con flechas.
9. Deshacer con botón y Ctrl+Z.
10. Guardar JSON.
11. Cargar JSON.
12. Exportar PNG.
