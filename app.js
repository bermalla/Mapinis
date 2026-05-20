const gridSize = 28;
const cols = 100;
const rows = 72;
const canvasWidth = cols * gridSize;
const canvasHeight = rows * gridSize;
const undoLimit = 10;

const toolDefinitions = [
  { id: "select", label: "Seleccionar / mover", kind: "select", className: "text", text: "↖", textColor: "#1f4fa3" },
  { id: "path", label: "Camino", fill: "#ffffff", stroke: "#222222", text: "", className: "path", textColor: "#1f4fa3" },
  { id: "closed", label: "Camino cerrado", fill: "#777777", stroke: "#222222", text: "X", className: "closed", textColor: "#ffffff" },
  { id: "down", label: "Camino en bajada", fill: "#5c91e6", stroke: "#222222", text: "↓", className: "down", textColor: "#ffffff" },
  { id: "drop", label: "Caída", fill: "#2453b3", stroke: "#222222", text: "↓", className: "drop", textColor: "#ffffff" },
  { id: "up", label: "Camino en subida", fill: "#29bf55", stroke: "#222222", text: "↑", className: "up", textColor: "#ffffff" },
  { id: "verticalBoost", label: "Impulso vertical", fill: "#d9b3ff", stroke: "#6d3aa8", text: "⇧", className: "verticalBoost", textColor: "#1f4fa3" },
  { id: "obstacle", label: "Obstáculo", fill: "#444444", stroke: "#222222", text: "", className: "obstacle", textColor: "#ffffff" },
  { id: "mini", label: "Mini sala vacía", fill: "#ffc0c0", stroke: "#ff3d3d", text: "", className: "mini", textColor: "#1f4fa3" },
  { id: "start", label: "Inicio/Fin", fill: "#fff4b8", stroke: "#222222", text: "", className: "start", textColor: "#1f4fa3" },
  { id: "statusBlock", label: "Status", fill: "#ffd84d", stroke: "#222222", text: "", className: "statusBlock", textColor: "#1f4fa3" },
  { id: "note", label: "Texto libre", fill: "transparent", stroke: "transparent", text: "texto", paletteText: "", className: "text", textColor: "#222222" },
];

let tools = toolDefinitions.map((tool) => ({ ...tool }));
let toolMap = new Map(tools.map((tool) => [tool.id, tool]));
let activeTool = "path";
let items = [];
let selectedId = null;
let selectedIds = [];
let editingId = null;
let showNotes = true;
let dragMove = null;
let createDrag = null;
let selectionDrag = null;
let panDrag = null;
let resizeDrag = null;
let previewRect = null;
let mouseDownState = null;
let lastMouseDown = { id: null, time: 0 };
let zoomLevel = 1;
const minZoom = 0.1;
const maxZoom = 2;
const zoomStep = 0.05;
let centerViewPending = true;
let undoStack = [];
let hasUnsavedChanges = false;
let saveButtonTimer = null;

const svg = document.getElementById("mapSvg");
const palette = document.getElementById("palette");
const status = document.getElementById("status");
const propText = document.getElementById("propText");
const propTextSize = document.getElementById("propTextSize");
const propNotes = document.getElementById("propNotes");
const layerUp = document.getElementById("layerUp");
const layerDown = document.getElementById("layerDown");
const toggleShowNotesBtn = document.getElementById("toggleShowNotes");
const undoBtn = document.getElementById("undoBtn");
const saveJsonBtn = document.getElementById("saveJson");
const jsonInput = document.getElementById("jsonInput");
const jsonBackup = document.getElementById("jsonBackup");
const mapScroller = document.getElementById("mapScroller");
const zoomIndicator = document.getElementById("zoomIndicator");
const currentFileNameNode = document.getElementById("currentFileName");
let currentFilename = null;
const toolEditorModal = document.getElementById("toolEditorModal");
const toolEditorForm = document.getElementById("toolEditorForm");
const toolEditorLabel = document.getElementById("toolEditorLabel");
const toolEditorText = document.getElementById("toolEditorText");
const toolEditorPaletteText = document.getElementById("toolEditorPaletteText");
const toolEditorFill = document.getElementById("toolEditorFill");
const toolEditorFillTransparent = document.getElementById("toolEditorFillTransparent");
const toolEditorStroke = document.getElementById("toolEditorStroke");
const toolEditorStrokeTransparent = document.getElementById("toolEditorStrokeTransparent");
const toolEditorTextColor = document.getElementById("toolEditorTextColor");
const toolEditorCancel = document.getElementById("toolEditorCancel");
const addToolButton = document.getElementById("addToolButton");
const toolEditorDelete = document.getElementById("toolEditorDelete");
let toolBeingEdited = null;
let toolEditorOriginalFill = null;
let toolEditorOriginalStroke = null;
let toolEditorOriginalTextColor = null;

function uid() {
  return window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

function rebuildToolMap() {
  toolMap = new Map(tools.map((tool) => [tool.id, tool]));
}

function getTool(id) {
  return toolMap.get(id) || null;
}

function getToolOrFallback(id) {
  return getTool(id) || getTool("path") || tools[0];
}

function registerLoadedTool(tool) {
  if (!tool || !tool.id || toolMap.has(tool.id)) return;
  tools.push({
    id: tool.id,
    label: tool.label || `Bloque desconocido: ${tool.id}`,
    fill: tool.fill || "#ffffff",
    stroke: tool.stroke || "#222222",
    text: typeof tool.text === "string" ? tool.text : "?",
    textColor: typeof tool.textColor === "string" ? tool.textColor : "#1f4fa3",
    className: tool.className || "text",
    paletteText: typeof tool.paletteText === "string" ? tool.paletteText : undefined,
  });
  rebuildToolMap();
}

function getHotkeyForToolIndex(index) {
  if (index < 0 || index > 9) return "";
  return index === 9 ? "0" : String(index + 1);
}

function focusEditor() {
  window.focus();
  svg.focus();
}

function isTypingTarget(target) {
  return target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function showStatus(message) {
  status.textContent = message;
}

function markDirty() {
  hasUnsavedChanges = true;
}

function markSaved() {
  hasUnsavedChanges = false;
  flashSaveButton();
}

function flashSaveButton() {
  if (saveButtonTimer) clearTimeout(saveButtonTimer);
  saveJsonBtn.textContent = "Guardado";
  saveButtonTimer = setTimeout(() => {
    saveJsonBtn.textContent = "Guardar JSON";
  }, 2000);
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function pushUndoState() {
  markDirty();
  undoStack.push({
    items: cloneState(items),
    tools: cloneState(tools),
    activeTool,
    selectedId,
    selectedIds: cloneState(selectedIds),
  });
  if (undoStack.length > undoLimit) undoStack.shift();
  updateUndoButton();
}

function updateUndoButton() {
  undoBtn.disabled = undoStack.length === 0;
}

function undoLastAction() {
  const previous = undoStack.pop();
  if (!previous) {
    showStatus("No hay acciones para deshacer");
    updateUndoButton();
    return;
  }

  items = previous.items;
  tools = previous.tools;
  rebuildToolMap();
  activeTool = previous.activeTool;
  selectedId = previous.selectedId;
  selectedIds = Array.isArray(previous.selectedIds) ? previous.selectedIds : selectedId ? [selectedId] : [];
  dragMove = null;
  createDrag = null;
  selectionDrag = null;
  panDrag = null;
  resizeDrag = null;
  previewRect = null;
  render();
  updateUndoButton();
  markDirty();
  showStatus("Acción deshecha");
}

function resetInteractionState() {
  selectedId = null;
  selectedIds = [];
  editingId = null;
  dragMove = null;
  createDrag = null;
  selectionDrag = null;
  panDrag = null;
  resizeDrag = null;
  previewRect = null;
  mouseDownState = null;
}

function getDesignBounds() {
  const visible = items.filter(isItemVisible);
  if (!visible || !visible.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  visible.forEach((item) => {
    left = Math.min(left, item.col);
    top = Math.min(top, item.row);
    right = Math.max(right, item.col + item.w - 1);
    bottom = Math.max(bottom, item.row + item.h - 1);
  });
  return {
    col: left,
    row: top,
    w: right - left + 1,
    h: bottom - top + 1,
  };
}

function centerMapView() {
  const containerRect = mapScroller.getBoundingClientRect();
  const bounds = getDesignBounds();
  const contentWidth = canvasWidth * zoomLevel;
  const contentHeight = canvasHeight * zoomLevel;
  let centerX = contentWidth / 2;
  let centerY = contentHeight / 2;
  if (bounds) {
    const designX = (bounds.col + bounds.w / 2) * gridSize * zoomLevel;
    const designY = (bounds.row + bounds.h / 2) * gridSize * zoomLevel;
    centerX = Math.min(Math.max(designX, containerRect.width / 2), contentWidth - containerRect.width / 2);
    centerY = Math.min(Math.max(designY, containerRect.height / 2), contentHeight - containerRect.height / 2);
  }
  mapScroller.scrollLeft = Math.max(0, centerX - containerRect.width / 2);
  mapScroller.scrollTop = Math.max(0, centerY - containerRect.height / 2);
  centerViewPending = false;
}

function getExportBounds() {
  if (!items || !items.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  items.forEach((item) => {
    left = Math.min(left, item.col);
    top = Math.min(top, item.row);
    right = Math.max(right, item.col + item.w - 1);
    bottom = Math.max(bottom, item.row + item.h - 1);
  });
  if (right === -Infinity) return null;
  return {
    x: left * gridSize,
    y: top * gridSize,
    width: (right - left + 1) * gridSize,
    height: (bottom - top + 1) * gridSize,
  };
}

function applyZoom(newZoom, pointerX, pointerY) {
  const oldZoom = zoomLevel;
  zoomLevel = Math.max(minZoom, Math.min(maxZoom, Math.round(newZoom / zoomStep) * zoomStep));
  if (zoomLevel === oldZoom) return;

  const containerRect = mapScroller.getBoundingClientRect();
  const offsetLeft = pointerX !== undefined ? pointerX : containerRect.left + mapScroller.scrollLeft;
  const offsetTop = pointerY !== undefined ? pointerY : containerRect.top + mapScroller.scrollTop;
  const pointerXInContent = offsetLeft - containerRect.left + mapScroller.scrollLeft;
  const pointerYInContent = offsetTop - containerRect.top + mapScroller.scrollTop;

  svg.style.width = `${canvasWidth * zoomLevel}px`;
  svg.style.height = `${canvasHeight * zoomLevel}px`;

  mapScroller.scrollLeft = Math.max(0, Math.min(canvasWidth * zoomLevel - containerRect.width, pointerXInContent * (zoomLevel / oldZoom) - (offsetLeft - containerRect.left)));
  mapScroller.scrollTop = Math.max(0, Math.min(canvasHeight * zoomLevel - containerRect.height, pointerYInContent * (zoomLevel / oldZoom) - (offsetTop - containerRect.top)));

  updateZoomIndicator();
}

function updateZoomIndicator() {
  if (!zoomIndicator) return;
  if (zoomLevel === 1) {
    zoomIndicator.style.display = "none";
    return;
  }
  zoomIndicator.style.display = "block";
  zoomIndicator.textContent = `Zoom ${Math.round(zoomLevel * 100)}%`;
}

function selectToolByIndex(index) {
  const tool = tools[index];
  if (!tool) return;
  activeTool = tool.id;
  resetInteractionState();
  render();
  focusEditor();
}

function focusSelectedProperties() {
  if (selectedIds.length !== 1 || !selectedId) return;
  updatePropertiesPanel();
  propText.focus();
  propText.select();
  showStatus("Editando bloque seleccionado");
}

function buildSaveData() {
  return {
    schema: "croquis-map-editor",
    version: 8,
    savedAt: new Date().toISOString(),
    grid: { cols, rows, gridSize },
    toolOrder: tools.map((tool) => tool.id),
    blockCatalog: tools
      .filter((tool) => tool.id !== "select")
      .map((tool) => {
        const data = {
          id: tool.id,
          label: tool.label,
          fill: tool.fill,
          stroke: tool.stroke,
          text: tool.text,
          className: tool.className,
        };
        if (tool.paletteText) data.paletteText = tool.paletteText;
        if (typeof tool.textColor === "string" && tool.textColor.length > 0) data.textColor = tool.textColor;
        return data;
      }),
    items: items.map((item) => {
      return {
        id: item.id,
        type: item.type,
        col: item.col,
        row: item.row,
        w: item.w,
        h: item.h,
        text: item.text,
        rotation: item.rotation,
        textSize: item.textSize,
        textColor: item.textColor,
        style: { fill: item.fill, stroke: item.stroke },
        meta: item.meta || {},
      };
    }),
  };
}

function buildSaveJson() {
  return JSON.stringify(buildSaveData(), null, 2);
}

function updateCurrentFilenameDisplay() {
  if (!currentFileNameNode) return;
  currentFileNameNode.textContent = currentFilename ? `(${currentFilename})` : "";
}

function setCurrentFilename(filename) {
  currentFilename = filename ? String(filename) : null;
  updateCurrentFilenameDisplay();
}

function getMousePoint(event) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvasWidth / rect.width),
    y: (event.clientY - rect.top) * (canvasHeight / rect.height),
  };
}

function getMouseCell(event) {
  const point = getMousePoint(event);
  return {
    col: Math.max(0, Math.min(cols - 1, Math.floor(point.x / gridSize))),
    row: Math.max(0, Math.min(rows - 1, Math.floor(point.y / gridSize))),
  };
}

function rectFromCells(a, b) {
  return {
    col: Math.min(a.col, b.col),
    row: Math.min(a.row, b.row),
    w: Math.abs(a.col - b.col) + 1,
    h: Math.abs(a.row - b.row) + 1,
  };
}

function createItem(toolId, col, row, w = 1, h = 1) {
  const tool = getToolOrFallback(toolId);
  return {
    id: uid(),
    type: tool.id,
    col,
    row,
    w,
    h,
    fill: tool.fill,
    stroke: tool.stroke,
    text: tool.text || "",
    rotation: 0,
    textSize: tool.textSize || (tool.id === "note" ? 14 : 18),
    textColor: tool.textColor || "#1f4fa3",
    meta: {},
  };
}

function getItemAtCell(col, row) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if ((!item.meta || !item.meta.notes || showNotes) && col >= item.col && col < item.col + item.w && row >= item.row && row < item.row + item.h) return item;
  }
  return null;
}

function isItemVisible(item) {
  return !(item && item.meta && item.meta.notes) || showNotes;
}

function deleteSelectedItem() {
  if (!selectedIds.length) {
    showStatus("No hay ningún bloque seleccionado para borrar");
    return;
  }
  pushUndoState();
  const before = items.length;
  items = items.filter((item) => !selectedIds.includes(item.id));
  const deleted = before - items.length;
  resetInteractionState();
  render();
  showStatus(deleted === 0 ? "No se encontró el bloque seleccionado" : `Se eliminaron ${deleted} bloque${deleted === 1 ? "" : "s"}`);
}

function renderPalette() {
  palette.innerHTML = "";
  tools.forEach((tool, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.draggable = true;
    button.dataset.toolId = tool.id;
    button.className = activeTool === tool.id ? "active" : "";
    const swatchStyle = `background:${tool.fill}; color:${tool.textColor || "#1f4fa3"}; border-color:${tool.stroke};`;
    button.innerHTML = `
      <span class="swatch ${tool.className || "text"}" style="${swatchStyle}">${tool.paletteText ?? tool.text ?? ""}</span>
      <span>${tool.label}</span>
      <span class="hotkey">${getHotkeyForToolIndex(index)}</span>
    `;

    button.addEventListener("click", () => {
      focusEditor();
      activeTool = tool.id;
      resetInteractionState();
      render();
    });

    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (tool.id === "select") return;
      openToolEditor(tool);
    });

    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", tool.id);
      event.dataTransfer.effectAllowed = "move";
      button.classList.add("dragging");
    });

    button.addEventListener("dragend", () => {
      button.classList.remove("dragging");
      palette.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target"));
    });

    button.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      button.classList.add("drop-target");
    });

    button.addEventListener("dragleave", () => {
      button.classList.remove("drop-target");
    });

    button.addEventListener("drop", (event) => {
      event.preventDefault();
      button.classList.remove("drop-target");
      const draggedId = event.dataTransfer.getData("text/plain");
      const targetId = tool.id;
      if (!draggedId || draggedId === targetId) return;
      const draggedIndex = tools.findIndex((candidate) => candidate.id === draggedId);
      if (draggedIndex < 0) return;
      pushUndoState();
      const [draggedTool] = tools.splice(draggedIndex, 1);
      const targetIndex = tools.findIndex((candidate) => candidate.id === targetId);
      tools.splice(targetIndex < 0 ? tools.length : targetIndex, 0, draggedTool);
      rebuildToolMap();
      render();
      focusEditor();
    });

    palette.appendChild(button);
  });
}

function openToolEditor(tool) {
  toolBeingEdited = tool;
  toolEditorLabel.value = tool.label || "";
  toolEditorText.value = tool.text || "";
  toolEditorPaletteText.value = tool.paletteText || "";
  toolEditorOriginalFill = tool.fill;
  toolEditorOriginalStroke = tool.stroke;
  toolEditorOriginalTextColor = tool.textColor;
  toolEditorFillTransparent.checked = tool.fill === "transparent";
  toolEditorStrokeTransparent.checked = tool.stroke === "transparent";
  toolEditorFill.value = /^#([0-9A-Fa-f]{3}){1,2}$/.test(tool.fill) ? tool.fill : "#ffffff";
  toolEditorStroke.value = /^#([0-9A-Fa-f]{3}){1,2}$/.test(tool.stroke) ? tool.stroke : "#222222";
  toolEditorTextColor.value = /^#([0-9A-Fa-f]{3}){1,2}$/.test(tool.textColor) ? tool.textColor : "#1f4fa3";
  toolEditorFill.disabled = toolEditorFillTransparent.checked;
  toolEditorStroke.disabled = toolEditorStrokeTransparent.checked;
  toolEditorFill.dataset.touched = "false";
  toolEditorStroke.dataset.touched = "false";
  toolEditorTextColor.dataset.touched = "false";
  toolEditorDelete.disabled = tool.id === "select" || tool.id === "note";
  toolEditorModal.hidden = false;
  updateToolEditorPreview();
}

function createNewTool() {
  pushUndoState();
  const newToolId = `block-${Date.now()}`;
  const newTool = {
    id: newToolId,
    label: "Nuevo bloque",
    fill: "#ffffff",
    stroke: "#222222",
    text: "",
    textColor: "#1f4fa3",
    className: "path",
  };
  tools.push(newTool);
  rebuildToolMap();
  activeTool = newTool.id;
  render();
  openToolEditor(newTool);
}

function deleteToolBeingEdited() {
  if (!toolBeingEdited) return;
  if (toolBeingEdited.id === "select" || toolBeingEdited.id === "note") {
    showStatus("Esta herramienta no puede eliminarse");
    return;
  }
  const confirmed = confirm("¿Eliminar este bloque? Se eliminarán también los bloques existentes de este tipo.");
  if (!confirmed) return;
  pushUndoState();

  items = items.filter((item) => item.type !== toolBeingEdited.id);
  tools = tools.filter((tool) => tool.id !== toolBeingEdited.id);
  rebuildToolMap();
  if (activeTool === toolBeingEdited.id) {
    activeTool = "select";
  }
  closeToolEditor();
  resetInteractionState();
  render();
  showStatus("Herramienta eliminada");
}


function closeToolEditor() {
  toolEditorModal.hidden = true;
  toolBeingEdited = null;
}

function updateToolEditorPreview() {
  const preview = document.getElementById("toolEditorPreview");
  if (!preview || !toolBeingEdited) return;
  const fill = toolEditorFillTransparent.checked ? "transparent" : toolEditorFill.value || "#ffffff";
  const stroke = toolEditorStrokeTransparent.checked ? "transparent" : toolEditorStroke.value || "#222222";
  const textColor = toolEditorTextColor.value || "#1f4fa3";
  const text = String(toolEditorText.value || toolBeingEdited.text || "").trim() || String(toolEditorPaletteText.value || toolBeingEdited.paletteText || toolBeingEdited.text || "");
  preview.innerHTML = `<div class="preview-swatch" style="background:${fill};border:2px solid ${stroke};color:${textColor};">${text}</div>`;
}

function applyToolEditorChanges() {
  if (!toolBeingEdited) return;
  const trimmedLabel = String(toolEditorLabel.value || "").trim();
  if (trimmedLabel) {
    toolBeingEdited.label = trimmedLabel;
  }
  toolBeingEdited.text = String(toolEditorText.value || "");
  const paletteTextValue = String(toolEditorPaletteText.value || "").trim();
  toolBeingEdited.paletteText = paletteTextValue || undefined;
  if (toolEditorFillTransparent.checked) {
    toolBeingEdited.fill = "transparent";
  } else if (toolEditorFill.dataset.touched === "true" || /^#([0-9A-Fa-f]{3}){1,2}$/.test(toolEditorOriginalFill)) {
    toolBeingEdited.fill = toolEditorFill.value || toolBeingEdited.fill;
  } else {
    toolBeingEdited.fill = toolEditorOriginalFill;
  }
  if (toolEditorStrokeTransparent.checked) {
    toolBeingEdited.stroke = "transparent";
  } else if (toolEditorStroke.dataset.touched === "true" || /^#([0-9A-Fa-f]{3}){1,2}$/.test(toolEditorOriginalStroke)) {
    toolBeingEdited.stroke = toolEditorStroke.value || toolBeingEdited.stroke;
  } else {
    toolBeingEdited.stroke = toolEditorOriginalStroke;
  }
  if (toolEditorTextColor.dataset.touched === "true" || /^#([0-9A-Fa-f]{3}){1,2}$/.test(toolEditorOriginalTextColor)) {
    toolBeingEdited.textColor = toolEditorTextColor.value || toolBeingEdited.textColor;
  } else {
    toolBeingEdited.textColor = toolEditorOriginalTextColor;
  }

  items.forEach((item) => {
    if (item.type === toolBeingEdited.id) {
      item.fill = toolBeingEdited.fill;
      item.stroke = toolBeingEdited.stroke;
      item.textColor = toolBeingEdited.textColor;
    }
  });

  rebuildToolMap();
  render();
}

function renderGrid() {
  let grid = "";
  for (let c = 0; c <= cols; c++) {
    const x = c * gridSize;
    grid += `<line x1="${x}" y1="0" x2="${x}" y2="${canvasHeight}" stroke="#cccccc" stroke-width="1" />`;
  }
  for (let r = 0; r <= rows; r++) {
    const y = r * gridSize;
    grid += `<line x1="0" y1="${y}" x2="${canvasWidth}" y2="${y}" stroke="#cccccc" stroke-width="1" />`;
  }
  return `<g id="grid">${grid}</g>`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapTextToLines(text, maxWidth, fontSize) {
  const cleanText = String(text || "").trim();
  if (!cleanText) return [];
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * 0.58)));
  const words = cleanText.split(" ").filter(Boolean);
  const lines = [];
  let currentLine = "";

  function pushLongWord(word) {
    for (let i = 0; i < word.length; i += maxChars) {
      lines.push(word.slice(i, i + maxChars));
    }
  }

  words.forEach((word) => {
    if (word.length > maxChars) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }
      pushLongWord(word);
      return;
    }
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (candidate.length <= maxChars) currentLine = candidate;
    else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  });

  if (currentLine) lines.push(currentLine);
  return lines;
}

function renderWrappedText(item, x, y, w, h, centerX, centerY, textSize, textColor) {
  const padding = 4;
  const innerWidth = Math.max(1, w - padding * 2);
  const innerHeight = Math.max(1, h - padding * 2);
  const lineHeight = textSize * 1.2;
  const maxLines = Math.max(1, Math.floor(innerHeight / lineHeight));
  const lines = wrapTextToLines(item.text, innerWidth, textSize).slice(0, maxLines);
  if (!lines.length) return "";

  const clipId = `clip-${String(item.id || "preview").replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const firstBaseline = centerY - (lines.length * lineHeight) / 2 + lineHeight * 0.8;
  const tspans = lines.map((line, index) => `<tspan x="${centerX}" y="${firstBaseline + index * lineHeight}">${escapeXml(line)}</tspan>`).join("");

  return `
    <clipPath id="${clipId}">
      <rect x="${x + padding}" y="${y + padding}" width="${innerWidth}" height="${innerHeight}" />
    </clipPath>
    <text text-anchor="middle" font-size="${textSize}" font-weight="400" fill="${textColor}" transform="rotate(${item.rotation || 0}, ${centerX}, ${centerY})" pointer-events="none" clip-path="url(#${clipId})">${tspans}</text>
  `;
}

function getCellsForItem(item) {
  const cells = [];
  for (let row = item.row; row < item.row + item.h; row++) {
    for (let col = item.col; col < item.col + item.w; col++) {
      cells.push({ col, row });
    }
  }
  return cells;
}

function buildPathCellOwners() {
  const owners = new Map();
  items
    .filter((item) => item.type === "path" && isItemVisible(item))
    .forEach((item) => {
      getCellsForItem(item).forEach((cell) => {
        const key = `${cell.col},${cell.row}`;
        if (!owners.has(key)) owners.set(key, new Set());
        owners.get(key).add(item.id);
      });
    });
  return owners;
}

function cellsShareAnyPathItem(aKey, bKey, owners) {
  const aOwners = owners.get(aKey);
  const bOwners = owners.get(bKey);
  if (!aOwners || !bOwners) return false;
  for (const ownerId of aOwners) {
    if (bOwners.has(ownerId)) return true;
  }
  return false;
}

function renderResizeHandles(item) {
  const x = item.col * gridSize;
  const y = item.row * gridSize;
  const w = item.w * gridSize;
  const h = item.h * gridSize;
  const size = 8;
  const half = size / 2;
  const left = x + half;
  const right = x + w - half;
  const top = y + half;
  const bottom = y + h - half;
  const midX = x + w / 2;
  const midY = y + h / 2;
  const points = [
    { x: midX, y: top, cursor: "ns-resize" },
    { x: right, y: midY, cursor: "ew-resize" },
    { x: midX, y: bottom, cursor: "ns-resize" },
    { x: left, y: midY, cursor: "ew-resize" },
    { x: left, y: top, cursor: "nwse-resize" },
    { x: right, y: top, cursor: "nesw-resize" },
    { x: right, y: bottom, cursor: "nwse-resize" },
    { x: left, y: bottom, cursor: "nesw-resize" },
  ];
  return points.map((point) => `
    <rect x="${point.x - half}" y="${point.y - half}" width="${size}" height="${size}" fill="#ff9f1c" stroke="#222222" stroke-width="1" style="cursor:${point.cursor};" />
  `).join("");
}

function getResizeEdgeForItem(point, item) {
  const x = item.col * gridSize;
  const y = item.row * gridSize;
  const w = item.w * gridSize;
  const h = item.h * gridSize;
  const threshold = 7;
  const inset = 4;
  if (point.x < x || point.x > x + w || point.y < y || point.y > y + h) return null;
  const nearLeft = Math.abs(point.x - (x + inset)) <= threshold;
  const nearRight = Math.abs(point.x - (x + w - inset)) <= threshold;
  const nearTop = Math.abs(point.y - (y + inset)) <= threshold;
  const nearBottom = Math.abs(point.y - (y + h - inset)) <= threshold;
  if (nearLeft && nearTop) return "top-left";
  if (nearRight && nearTop) return "top-right";
  if (nearRight && nearBottom) return "bottom-right";
  if (nearLeft && nearBottom) return "bottom-left";
  if (nearLeft) return "left";
  if (nearRight) return "right";
  if (nearTop) return "top";
  if (nearBottom) return "bottom";
  return null;
}

function resizeItemFromCell(item, edge, cell, original) {
  const originalRight = original.col + original.w - 1;
  const originalBottom = original.row + original.h - 1;
  let newCol = original.col;
  let newRow = original.row;
  let newRight = originalRight;
  let newBottom = originalBottom;

  if (edge.includes("left")) newCol = Math.max(0, Math.min(cell.col, originalRight));
  if (edge.includes("right")) newRight = Math.max(original.col, Math.min(cell.col, cols - 1));
  if (edge.includes("top")) newRow = Math.max(0, Math.min(cell.row, originalBottom));
  if (edge.includes("bottom")) newBottom = Math.max(original.row, Math.min(cell.row, rows - 1));

  item.col = newCol;
  item.row = newRow;
  item.w = Math.max(1, newRight - newCol + 1);
  item.h = Math.max(1, newBottom - newRow + 1);
}

function renderPathItem(item, isPreview, pathOwners) {
  const x = item.col * gridSize;
  const y = item.row * gridSize;
  const w = item.w * gridSize;
  const h = item.h * gridSize;
  const isSelected = selectedIds.includes(item.id);
  const isEditing = item.id === editingId;
  const opacity = isPreview ? 0.55 : 1;
  const strokeColor = isPreview ? "#ff9f1c" : item.stroke;
  const strokeWidth = isPreview ? 3 : 1.5;
  const cells = getCellsForItem(item);
  const owners = isPreview ? new Map(cells.map((cell) => [`${cell.col},${cell.row}`, new Set([item.id])])) : pathOwners;
  let borders = "";

  cells.forEach((cell) => {
    const cellX = cell.col * gridSize;
    const cellY = cell.row * gridSize;
    const current = `${cell.col},${cell.row}`;
    const neighbors = {
      top: `${cell.col},${cell.row - 1}`,
      right: `${cell.col + 1},${cell.row}`,
      bottom: `${cell.col},${cell.row + 1}`,
      left: `${cell.col - 1},${cell.row}`,
    };

    if (!cellsShareAnyPathItem(current, neighbors.top, owners)) borders += `<line x1="${cellX}" y1="${cellY}" x2="${cellX + gridSize}" y2="${cellY}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`;
    if (!cellsShareAnyPathItem(current, neighbors.right, owners)) borders += `<line x1="${cellX + gridSize}" y1="${cellY}" x2="${cellX + gridSize}" y2="${cellY + gridSize}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`;
    if (!cellsShareAnyPathItem(current, neighbors.bottom, owners)) borders += `<line x1="${cellX}" y1="${cellY + gridSize}" x2="${cellX + gridSize}" y2="${cellY + gridSize}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`;
    if (!cellsShareAnyPathItem(current, neighbors.left, owners)) borders += `<line x1="${cellX}" y1="${cellY}" x2="${cellX}" y2="${cellY + gridSize}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`;
  });

  const centerX = x + w / 2;
  const centerY = y + h / 2;
  const textSize = Number(item.textSize) || 18;
  const textColor = item.textColor || "#1f4fa3";
  const textMarkup = item.text ? renderWrappedText(item, x, y, w, h, centerX, centerY, textSize, textColor) : "";
  const selectionMarkup = isSelected && !isPreview ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ff9f1c" stroke-width="3" />${isEditing ? renderResizeHandles(item) : ""}` : "";

  return `
    <g class="item" data-id="${item.id || "preview"}" opacity="${opacity}" style="cursor:move;">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${item.fill}" stroke="none" />
      ${borders}
      ${textMarkup}
      ${selectionMarkup}
    </g>
  `;
}

function renderItem(item, isPreview = false, pathOwners = buildPathCellOwners()) {
  if (item.type === "path") return renderPathItem(item, isPreview, pathOwners);

  const x = item.col * gridSize;
  const y = item.row * gridSize;
  const w = item.w * gridSize;
  const h = item.h * gridSize;
  const isSelected = selectedIds.includes(item.id);
  const isEditing = item.id === editingId;
  const stroke = isPreview ? "#ff9f1c" : isSelected ? "#ff9f1c" : item.stroke;
  const strokeWidth = isPreview || isSelected ? 3 : 1.5;
  const opacity = isPreview ? 0.55 : 1;
  const centerX = x + w / 2;
  const centerY = y + h / 2;
  const textColor = item.textColor || (["closed", "down", "drop", "up", "obstacle"].includes(item.type) ? "#ffffff" : "#1f4fa3");
  const textSize = Number(item.textSize) || (item.type === "note" ? 14 : 18);
  const textMarkup = item.text ? renderWrappedText(item, x, y, w, h, centerX, centerY, textSize, textColor) : "";

  return `
    <g class="item" data-id="${item.id || "preview"}" opacity="${opacity}" style="cursor:move;">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${item.fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />
      ${textMarkup}
      ${isSelected && isEditing && !isPreview ? renderResizeHandles(item) : ""}
    </g>
  `;
}

function renderItems() {
  const visibleItems = items.filter(isItemVisible);
  const owners = buildPathCellOwners();
  return visibleItems.map((item) => renderItem(item, false, owners)).join("");
}

function renderSelectionBox() {
  if (!previewRect || !selectionDrag) return "";
  const x = previewRect.col * gridSize;
  const y = previewRect.row * gridSize;
  const w = previewRect.w * gridSize;
  const h = previewRect.h * gridSize;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#0077cc" stroke-width="2" stroke-dasharray="8,4" />`;
}

function renderPreview() {
  if (!previewRect || activeTool === "select") return "";
  const tool = getToolOrFallback(activeTool);
  return renderItem({
    id: "preview",
    type: tool.id,
    col: previewRect.col,
    row: previewRect.row,
    w: previewRect.w,
    h: previewRect.h,
    fill: tool.fill,
    stroke: tool.stroke,
    text: tool.text || "",
    rotation: 0,
    textSize: tool.textSize || (tool.id === "note" ? 14 : 18),
  }, true);
}

function render() {
  svg.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);
  svg.style.width = `${canvasWidth * zoomLevel}px`;
  svg.style.height = `${canvasHeight * zoomLevel}px`;
  svg.innerHTML = `
    <rect x="0" y="0" width="${canvasWidth}" height="${canvasHeight}" fill="#e6e6e6" />
    ${renderGrid()}
    ${renderItems()}
    ${renderSelectionBox()}
    ${renderPreview()}
  `;
  renderPalette();
  updatePropertiesPanel();
  const statusMessage = selectionDrag && previewRect
    ? `Seleccionando ${previewRect.w}x${previewRect.h}`
    : previewRect
    ? `Creando ${previewRect.w}x${previewRect.h}`
    : selectedIds.length > 1
    ? `${selectedIds.length} elementos seleccionados`
    : selectedId
    ? "Elemento seleccionado"
    : `Herramienta: ${getToolOrFallback(activeTool).label}`;
  showStatus(statusMessage);
  updateZoomIndicator();
  if (centerViewPending) centerMapView();
}

function updatePropertiesPanel() {
  const selected = selectedIds.length === 1 ? items.find((item) => item.id === selectedId) : null;
  propText.value = selected ? selected.text : "";
  propTextSize.value = selected ? Number(selected.textSize) || (selected.type === "note" ? 14 : 18) : "";
  propNotes.checked = selected ? Boolean(selected.meta && selected.meta.notes) : false;
  const disabled = !selected;
  [propText, propTextSize, propNotes, layerUp, layerDown].forEach((element) => {
    element.disabled = disabled;
  });
}

svg.addEventListener("mousedown", (event) => {
  if (event.button === 1) {
    event.preventDefault();
    panDrag = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: mapScroller.scrollLeft,
      scrollTop: mapScroller.scrollTop,
    };
    return;
  }

  event.preventDefault();
  focusEditor();
  const cell = getMouseCell(event);
  const clickedItem = getItemAtCell(cell.col, cell.row);

  if (clickedItem) {
    const now = Date.now();
    const isDoubleClick = lastMouseDown.id === clickedItem.id && now - lastMouseDown.time < 350;
    const clickedIsSelected = selectedIds.includes(clickedItem.id);
    const additiveSelection = event.shiftKey && activeTool === "select";
    lastMouseDown = { id: clickedItem.id, time: now };
    activeTool = "select";
    selectedId = clickedItem.id;
    if (additiveSelection) {
      if (clickedIsSelected) {
        selectedIds = selectedIds.filter((id) => id !== clickedItem.id);
      } else {
        selectedIds = [...selectedIds, clickedItem.id];
      }
    } else if (clickedIsSelected) {
      selectedIds = selectedIds.slice();
    } else {
      selectedIds = [clickedItem.id];
    }
    const isSameEditingItem = editingId === clickedItem.id;
    if (isDoubleClick) {
      selectedIds = [clickedItem.id];
      editingId = clickedItem.id;
    } else {
      editingId = isSameEditingItem ? clickedItem.id : null;
    }
    previewRect = null;
    selectionDrag = null;
    createDrag = null;
    panDrag = null;
    resizeDrag = null;
    dragMove = null;
    mouseDownState = null;

    if (isDoubleClick) {
      render();
      window.setTimeout(focusSelectedProperties, 0);
      return;
    }

    const edge = editingId === clickedItem.id ? getResizeEdgeForItem(getMousePoint(event), clickedItem) : null;
    mouseDownState = {
      id: clickedItem.id,
      edge,
      startCell: cell,
      offsetCol: cell.col - clickedItem.col,
      offsetRow: cell.row - clickedItem.row,
      startPoint: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    render();
    return;
  }

  lastMouseDown = { id: null, time: 0 };
  if (activeTool === "select") {
    selectedId = null;
    if (!event.shiftKey) {
      selectedIds = [];
      editingId = null;
    }
    dragMove = null;
    createDrag = null;
    resizeDrag = null;
    previewRect = null;
    selectionDrag = { startCell: cell, currentCell: cell, additive: event.shiftKey };
    previewRect = rectFromCells(cell, cell);
    render();
    return;
  }

  selectedId = null;
  selectedIds = [];
  editingId = null;
  dragMove = null;
  resizeDrag = null;
  panDrag = null;
  createDrag = { toolId: activeTool, startCell: cell, currentCell: cell };
  previewRect = rectFromCells(cell, cell);
  render();
});

window.addEventListener("mousemove", (event) => {
  if (mouseDownState && !mouseDownState.moved) {
    const dx = event.clientX - mouseDownState.startPoint.x;
    const dy = event.clientY - mouseDownState.startPoint.y;
    const cell = getMouseCell(event);
    const movedDistance = Math.sqrt(dx * dx + dy * dy);
    if (movedDistance > 4 || cell.col !== mouseDownState.startCell.col || cell.row !== mouseDownState.startCell.row) {
      const item = items.find((candidate) => candidate.id === mouseDownState.id);
      if (item) {
        if (mouseDownState.edge) {
          pushUndoState();
          resizeDrag = {
            id: item.id,
            edge: mouseDownState.edge,
            original: { col: item.col, row: item.row, w: item.w, h: item.h },
          };
          resizeItemFromCell(item, resizeDrag.edge, cell, resizeDrag.original);
          render();
        } else {
          pushUndoState();
          dragMove = {
            ids: selectedIds.slice(),
            originalPositions: items
              .filter((candidate) => selectedIds.includes(candidate.id))
              .map((candidate) => ({ id: candidate.id, col: candidate.col, row: candidate.row })),
            startCell: mouseDownState.startCell,
          };
          const deltaCol = cell.col - dragMove.startCell.col;
          const deltaRow = cell.row - dragMove.startCell.row;
          dragMove.originalPositions.forEach((position) => {
            const target = items.find((candidate) => candidate.id === position.id);
            if (target) {
              target.col = Math.max(0, Math.min(cols - target.w, position.col + deltaCol));
              target.row = Math.max(0, Math.min(rows - target.h, position.row + deltaRow));
            }
          });
          render();
        }
      }
      mouseDownState.moved = true;
    }
  }

  if (selectionDrag) {
    const cell = getMouseCell(event);
    selectionDrag.currentCell = cell;
    previewRect = rectFromCells(selectionDrag.startCell, cell);
    render();
    return;
  }

  if (resizeDrag) {
    const item = items.find((candidate) => candidate.id === resizeDrag.id);
    if (!item) return;
    resizeItemFromCell(item, resizeDrag.edge, getMouseCell(event), resizeDrag.original);
    render();
    return;
  }

  if (dragMove) {
    const cell = getMouseCell(event);
    const deltaCol = cell.col - dragMove.startCell.col;
    const deltaRow = cell.row - dragMove.startCell.row;
    dragMove.originalPositions.forEach((position) => {
      const target = items.find((candidate) => candidate.id === position.id);
      if (target) {
        target.col = Math.max(0, Math.min(cols - target.w, position.col + deltaCol));
        target.row = Math.max(0, Math.min(rows - target.h, position.row + deltaRow));
      }
    });
    render();
    return;
  }

  if (panDrag) {
    mapScroller.scrollLeft = panDrag.scrollLeft - (event.clientX - panDrag.startX);
    mapScroller.scrollTop = panDrag.scrollTop - (event.clientY - panDrag.startY);
    return;
  }

  if (createDrag) {
    const cell = getMouseCell(event);
    createDrag.currentCell = cell;
    previewRect = rectFromCells(createDrag.startCell, cell);
    render();
  }
});

window.addEventListener("mouseup", () => {
  if (createDrag) {
    const rect = previewRect || rectFromCells(createDrag.startCell, createDrag.currentCell);
    const item = createItem(createDrag.toolId, rect.col, rect.row, rect.w, rect.h);
    pushUndoState();
    items.push(item);
    selectedId = null;
    selectedIds = [];
    editingId = null;
    createDrag = null;
    previewRect = null;
    render();
  }

  if (selectionDrag) {
    const rect = previewRect || rectFromCells(selectionDrag.startCell, selectionDrag.currentCell);
    const selected = items.filter((item) => {
      if (!isItemVisible(item)) return false;
      const itemRect = {
        left: item.col,
        top: item.row,
        right: item.col + item.w - 1,
        bottom: item.row + item.h - 1,
      };
      const selectionRect = {
        left: rect.col,
        top: rect.row,
        right: rect.col + rect.w - 1,
        bottom: rect.row + rect.h - 1,
      };
      return (
        itemRect.left <= selectionRect.right &&
        itemRect.right >= selectionRect.left &&
        itemRect.top <= selectionRect.bottom &&
        itemRect.bottom >= selectionRect.top
      );
    });
    const selectedIdsFromDrag = selected.map((item) => item.id);
    if (selectionDrag.additive) {
      selectedIds = Array.from(new Set([...selectedIds, ...selectedIdsFromDrag]));
    } else {
      selectedIds = selectedIdsFromDrag;
    }
    selectedId = selectedIds[0] || null;
    editingId = null;
    selectionDrag = null;
    previewRect = null;
    render();
  }

  if (resizeDrag) {
    resizeDrag = null;
    render();
    window.setTimeout(focusSelectedProperties, 0);
  }

  dragMove = null;
  panDrag = null;
  mouseDownState = null;
});

svg.addEventListener("wheel", (event) => {
  if (event.ctrlKey) return;
  event.preventDefault();
  const pointerX = event.clientX;
  const pointerY = event.clientY;
  const delta = event.deltaY < 0 ? zoomStep : -zoomStep;
  applyZoom(zoomLevel + delta, pointerX, pointerY);
});

document.addEventListener("keydown", (event) => {
  const isUndoShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z";
  if (isUndoShortcut) {
    event.preventDefault();
    undoLastAction();
    return;
  }

  if (isTypingTarget(event.target)) return;

  if (/^[0-9]$/.test(event.key)) {
    event.preventDefault();
    selectToolByIndex(event.key === "0" ? 9 : Number(event.key) - 1);
    return;
  }

  if (event.key === "Backspace" || event.key === "Delete" || event.code === "Delete") {
    event.preventDefault();
    focusEditor();
    deleteSelectedItem();
    return;
  }

  if (!selectedId) return;
  const selected = items.find((item) => item.id === selectedId);
  if (!selected) return;

  const moves = {
    ArrowLeft: { dx: -1, dy: 0 },
    ArrowRight: { dx: 1, dy: 0 },
    ArrowUp: { dx: 0, dy: -1 },
    ArrowDown: { dx: 0, dy: 1 },
  };

  if (moves[event.key]) {
    event.preventDefault();
    const move = moves[event.key];
    const canMoveAll = selectedIds.every((id) => {
      const item = items.find((candidate) => candidate.id === id);
      if (!item) return false;
      const nextCol = item.col + move.dx;
      const nextRow = item.row + move.dy;
      return nextCol >= 0 && nextRow >= 0 && nextCol <= cols - item.w && nextRow <= rows - item.h;
    });
    if (!canMoveAll) return;
    pushUndoState();
    selectedIds.forEach((id) => {
      const item = items.find((candidate) => candidate.id === id);
      if (item) {
        item.col += move.dx;
        item.row += move.dy;
      }
    });
    render();
    showStatus(`${selectedIds.length > 1 ? `${selectedIds.length} bloques movidos` : "Bloque movido 1 celda"}`);
    return;
  }

  if (event.key.toLowerCase() === "r") {
    event.preventDefault();
    pushUndoState();
    selected.rotation = (selected.rotation + 90) % 360;
    render();
    return;
  }

  if (event.key.toLowerCase() === "d") {
    event.preventDefault();
    pushUndoState();
    const duplicate = {
      ...selected,
      id: uid(),
      col: Math.min(cols - selected.w, selected.col + 1),
      row: Math.min(rows - selected.h, selected.row + 1),
    };
    items.push(duplicate);
    selectedId = duplicate.id;
    render();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    resetInteractionState();
    render();
  }
});

function applySelectedProperties(push = true) {
  const selected = items.find((item) => item.id === selectedId);
  if (!selected) return;
  if (push) pushUndoState();
  selected.text = propText.value;
  selected.meta = selected.meta || {};
  selected.meta.notes = Boolean(propNotes.checked);
  selected.textSize = Math.max(6, Math.min(72, Number(propTextSize.value) || (selected.type === "note" ? 14 : 18)));
  selected.col = Math.min(cols - selected.w, selected.col);
  selected.row = Math.min(rows - selected.h, selected.row);
  render();
  showStatus("Propiedades actualizadas");
}

function updateSelectedPropertiesLive() {
  if (!selectedId) return;
  pushUndoState();
  applySelectedProperties(false);
}

[propText, propTextSize].forEach((input) => {
  input.addEventListener("input", updateSelectedPropertiesLive);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applySelectedProperties();
    editingId = null;
    input.blur();
    render();
  });
});

if (propNotes) {
  propNotes.addEventListener("change", (event) => {
    if (!selectedId) return;
    const selected = items.find((item) => item.id === selectedId);
    if (!selected) return;
    pushUndoState();
    selected.meta = selected.meta || {};
    selected.meta.notes = Boolean(propNotes.checked);
    render();
  });
}

if (toggleShowNotesBtn) {
  const updateToggleText = () => {
    toggleShowNotesBtn.textContent = showNotes ? "Ocultar notas" : "Mostrar notas";
  };
  updateToggleText();
  toggleShowNotesBtn.addEventListener("click", (event) => {
    event.preventDefault();
    showNotes = !showNotes;
    // remove hidden items from selection
    selectedIds = selectedIds.filter((id) => {
      const it = items.find((candidate) => candidate.id === id);
      return isItemVisible(it);
    });
    selectedId = selectedIds[0] || null;
    if (selectedId) editingId = editingId === selectedId ? editingId : null;
    else editingId = null;
    updateToggleText();
    render();
    showStatus(showNotes ? "Notas mostradas" : "Notas ocultas");
  });
}

function moveSelectedLayer(direction) {
  if (!selectedId) {
    showStatus("No hay ningún bloque seleccionado");
    return;
  }
  const index = items.findIndex((item) => item.id === selectedId);
  if (index < 0) return;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= items.length) {
    showStatus(direction > 0 ? "El bloque ya está arriba" : "El bloque ya está abajo");
    return;
  }
  pushUndoState();
  const [item] = items.splice(index, 1);
  items.splice(targetIndex, 0, item);
  render();
  showStatus(direction > 0 ? "Bloque subido de capa" : "Bloque bajado de capa");
}

layerUp.addEventListener("click", (event) => {
  event.preventDefault();
  moveSelectedLayer(1);
});

layerDown.addEventListener("click", (event) => {
  event.preventDefault();
  moveSelectedLayer(-1);
});

undoBtn.addEventListener("click", (event) => {
  event.preventDefault();
  undoLastAction();
});

document.getElementById("clearMap").addEventListener("click", (event) => {
  event.preventDefault();
  focusEditor();
  if (!confirm("¿Limpiar todo el mapa? Esta acción borra todos los bloques.")) return;
  pushUndoState();
  items = [];
  resetInteractionState();
  centerViewPending = true;
  render();
  showStatus("Mapa limpiado");
});

saveJsonBtn.addEventListener("click", async (event) => {
  event.preventDefault();
  focusEditor();
  const json = buildSaveJson();
  jsonBackup.value = json;
  const savedName = await saveTextFile("mapa-croquis.json", json, "application/json;charset=utf-8");
  if (savedName) setCurrentFilename(savedName);
});

document.getElementById("copyJson").addEventListener("click", async (event) => {
  event.preventDefault();
  const json = buildSaveJson();
  jsonBackup.value = json;
  jsonBackup.focus();
  jsonBackup.select();
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(json);
      showStatus("JSON copiado al portapapeles");
    } else {
      document.execCommand("copy");
      showStatus("JSON seleccionado/copiado con método alternativo");
    }
  } catch {
    showStatus("No se pudo copiar automáticamente; el JSON quedó seleccionado");
  }
});

document.getElementById("loadJson").addEventListener("click", (event) => {
  event.preventDefault();
  focusEditor();
  jsonInput.value = "";
  jsonInput.click();
});

function loadJsonFromText(text, filename) {
  try {
    const data = JSON.parse(String(text));
    if (!data || !Array.isArray(data.items)) throw new Error("Formato inválido");
    pushUndoState();
    console.log("blockCatalog cargado del JSON:", data.blockCatalog);
    if (Array.isArray(data.blockCatalog)) {
      data.blockCatalog.forEach((toolData) => {
        if (!toolData || !toolData.id) return;
        const existingTool = tools.find((candidate) => candidate.id === toolData.id);
        console.log(`Actualizando tool "${toolData.id}": text="${toolData.text}" -> existingTool.text="${existingTool?.text}"`);
        if (existingTool) {
          if (typeof toolData.label === "string") existingTool.label = toolData.label;
          if (typeof toolData.fill === "string") existingTool.fill = toolData.fill;
          if (typeof toolData.stroke === "string") existingTool.stroke = toolData.stroke;
          if (typeof toolData.text === "string") existingTool.text = toolData.text;
          if (typeof toolData.textColor === "string") existingTool.textColor = toolData.textColor;
          console.log(`  -> Ahora existingTool.text="${existingTool.text}"`);
          if (typeof toolData.className === "string") existingTool.className = toolData.className;
          if (typeof toolData.paletteText === "string") existingTool.paletteText = toolData.paletteText;
        } else {
          registerLoadedTool(toolData);
        }
      });
      console.log("tools después de cargar blockCatalog:", tools);
      rebuildToolMap();
    }
    if (Array.isArray(data.toolOrder)) {
      const ordered = [];
      data.toolOrder.forEach((id) => {
        const tool = tools.find((candidate) => candidate.id === id);
        if (tool && !ordered.includes(tool)) ordered.push(tool);
      });
      tools.forEach((tool) => {
        if (!ordered.includes(tool)) ordered.push(tool);
      });
      tools = ordered;
      rebuildToolMap();
    }

    items = data.items.map((item) => {
      const tool = getToolOrFallback(item.type || "path");
      const style = item.style || {};
      const itemText = typeof item.text === "string" ? item.text : (typeof tool.text === "string" ? tool.text : "");
      return {
        id: item.id || uid(),
        type: item.type || tool.id,
        col: Math.max(0, Math.min(cols - 1, Number(item.col) || 0)),
        row: Math.max(0, Math.min(rows - 1, Number(item.row) || 0)),
        w: Math.max(1, Math.min(cols, Number(item.w) || 1)),
        h: Math.max(1, Math.min(rows, Number(item.h) || 1)),
        fill: style.fill || item.fill || tool.fill,
        stroke: style.stroke || item.stroke || tool.stroke,
        text: itemText,
        rotation: Number(item.rotation) || 0,
        textSize: Math.max(6, Math.min(72, Number(item.textSize) || (tool.id === "note" ? 14 : 18))),
        textColor: typeof item.textColor === "string" ? item.textColor : tool.textColor || (tool.id === "note" ? "#222222" : "#1f4fa3"),
        meta: item.meta || {},
      };
    });
    console.log("tools finales antes de renderizar:", tools);
    console.log("items cargados:", items);
    resetInteractionState();
    centerViewPending = true;
    render();
    markSaved();
    if (filename) setCurrentFilename(filename);
    showStatus("JSON cargado correctamente");
  } catch (error) {
    console.error(error);
    alert("No se pudo cargar el JSON. Verificá que sea un archivo guardado desde esta herramienta.");
    showStatus("Error al cargar JSON");
  }
}

jsonInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    showStatus("No se seleccionó ningún JSON");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => loadJsonFromText(reader.result, file.name);
  reader.onerror = () => {
    alert("No se pudo leer el archivo JSON.");
    showStatus("Error de lectura del archivo");
  };
  reader.readAsText(file);
});

toolEditorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!toolBeingEdited) return;
  pushUndoState();
  applyToolEditorChanges();
  closeToolEditor();
  focusEditor();
});

toolEditorCancel.addEventListener("click", (event) => {
  event.preventDefault();
  closeToolEditor();
  focusEditor();
});

toolEditorDelete.addEventListener("click", (event) => {
  event.preventDefault();
  deleteToolBeingEdited();
});

toolEditorModal.addEventListener("click", (event) => {
  if (event.target === toolEditorModal) {
    closeToolEditor();
    focusEditor();
  }
});

if (addToolButton) {
  addToolButton.addEventListener("click", (event) => {
    event.preventDefault();
    createNewTool();
  });
}


toolEditorFill.addEventListener("input", () => {
  toolEditorFill.dataset.touched = "true";
  updateToolEditorPreview();
});

toolEditorFillTransparent.addEventListener("change", () => {
  toolEditorFill.disabled = toolEditorFillTransparent.checked;
  updateToolEditorPreview();
});

toolEditorStroke.addEventListener("input", () => {
  toolEditorStroke.dataset.touched = "true";
  updateToolEditorPreview();
});

toolEditorStrokeTransparent.addEventListener("change", () => {
  toolEditorStroke.disabled = toolEditorStrokeTransparent.checked;
  updateToolEditorPreview();
});

toolEditorTextColor.addEventListener("input", () => {
  toolEditorTextColor.dataset.touched = "true";
  updateToolEditorPreview();
});

toolEditorText.addEventListener("input", updateToolEditorPreview);

toolEditorPaletteText.addEventListener("input", updateToolEditorPreview);

toolEditorLabel.addEventListener("input", updateToolEditorPreview);

document.getElementById("exportPng").addEventListener("click", async (event) => {
  event.preventDefault();
  focusEditor();
  await exportMapAsPng();
});

function createExportLegendGroup(width, height) {
  const xmlns = "http://www.w3.org/2000/svg";
  const legendTools = tools.filter((tool) => !["select", "start", "note"].includes(tool.id));
  const padding = 16;
  const itemHeight = 26;
  const swatchSize = 16;
  const labelX = padding + swatchSize + 10;
  const titleHeight = 20;
  const topOffset = padding + titleHeight + 8;

  const legendGroup = document.createElementNS(xmlns, "g");

  const background = document.createElementNS(xmlns, "rect");
  background.setAttribute("x", "0");
  background.setAttribute("y", "0");
  background.setAttribute("width", String(width));
  background.setAttribute("height", String(height));
  background.setAttribute("fill", "#ffffff");
  legendGroup.appendChild(background);

  const title = document.createElementNS(xmlns, "text");
  title.setAttribute("x", String(padding));
  title.setAttribute("y", String(padding + 14));
  title.setAttribute("font-family", "Arial, sans-serif");
  title.setAttribute("font-size", "16");
  title.setAttribute("font-weight", "700");
  title.setAttribute("fill", "#222222");
  title.textContent = "Leyenda";
  legendGroup.appendChild(title);

  legendTools.forEach((tool, index) => {
    const y = topOffset + index * itemHeight;
    const group = document.createElementNS(xmlns, "g");
    group.setAttribute("transform", `translate(${padding}, ${y})`);

    const swatch = document.createElementNS(xmlns, "rect");
    swatch.setAttribute("x", "0");
    swatch.setAttribute("y", "0");
    swatch.setAttribute("width", String(swatchSize));
    swatch.setAttribute("height", String(swatchSize));
    swatch.setAttribute("fill", tool.fill || "#ffffff");
    swatch.setAttribute("stroke", tool.stroke || "#222222");
    swatch.setAttribute("stroke-width", "1.5");
    group.appendChild(swatch);

    const label = document.createElementNS(xmlns, "text");
    label.setAttribute("x", String(labelX));
    label.setAttribute("y", String(swatchSize - 2));
    label.setAttribute("font-family", "Arial, sans-serif");
    label.setAttribute("font-size", "14");
    label.setAttribute("fill", "#222222");
    label.textContent = tool.label;
    group.appendChild(label);

    legendGroup.appendChild(group);
  });

  return legendGroup;
}

async function exportMapAsPng() {
  try {
    const exportBounds = getExportBounds();
    const paddingCells = 1; // add one cell padding around content
    let contentWidth, contentHeight, viewBoxX, viewBoxY;
    if (exportBounds) {
      const padPx = paddingCells * gridSize;
      viewBoxX = Math.max(0, exportBounds.x - padPx);
      viewBoxY = Math.max(0, exportBounds.y - padPx);
      const maxX = Math.min(canvasWidth, exportBounds.x + exportBounds.width + padPx);
      const maxY = Math.min(canvasHeight, exportBounds.y + exportBounds.height + padPx);
      contentWidth = Math.max(1, maxX - viewBoxX);
      contentHeight = Math.max(1, maxY - viewBoxY);
    } else {
      viewBoxX = 0;
      viewBoxY = 0;
      contentWidth = canvasWidth;
      contentHeight = canvasHeight;
    }
    const legendWidth = 260;
    const exportWidth = contentWidth + legendWidth;
    const exportHeight = contentHeight;

    const exportSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    exportSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    exportSvg.setAttribute("width", String(exportWidth));
    exportSvg.setAttribute("height", String(exportHeight));
    exportSvg.setAttribute("viewBox", `0 0 ${exportWidth} ${exportHeight}`);

    const legendGroup = createExportLegendGroup(legendWidth, exportHeight);
    exportSvg.appendChild(legendGroup);

    const cloneSvg = svg.cloneNode(true);
    cloneSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    cloneSvg.setAttribute("viewBox", `${viewBoxX} ${viewBoxY} ${contentWidth} ${contentHeight}`);
    cloneSvg.setAttribute("x", String(legendWidth));
    cloneSvg.setAttribute("y", "0");
    cloneSvg.setAttribute("width", String(contentWidth));
    cloneSvg.setAttribute("height", String(contentHeight));
    cloneSvg.querySelectorAll("#grid line").forEach((line) => line.setAttribute("stroke", "#dddddd"));

    exportSvg.appendChild(cloneSvg);

    const source = new XMLSerializer().serializeToString(exportSvg);
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = exportWidth;
      canvas.height = exportHeight;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, exportWidth, exportHeight);
      ctx.drawImage(img, 0, 0, exportWidth, exportHeight);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) {
          showStatus("No se pudo generar el PNG");
          return;
        }
        downloadBlobFallback("mapa-croquis.png", blob);
        showStatus("PNG generado para descarga");
      }, "image/png");
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      showStatus("No se pudo renderizar el mapa como PNG");
    };

    img.src = url;
  } catch (error) {
    console.error(error);
    showStatus("Error al exportar PNG");
  }
}

async function saveTextFile(filename, content, type) {
  try {
    if (window.showSaveFilePicker && window.isSecureContext) {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Archivo JSON", accept: { "application/json": [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([content], { type }));
      await writable.close();
      markSaved();
      showStatus("JSON guardado correctamente");
      return handle.name || filename;
    }
    const ok = downloadFileFallback(filename, content, type);
    if (ok) {
      markSaved();
      showStatus("JSON generado como descarga");
      return filename;
    } else {
      showStatus("Descarga bloqueada: usá Copiar JSON");
      return null;
    }
  } catch (error) {
    if (error && error.name === "AbortError") {
      showStatus("Guardado cancelado");
      return null;
    }
    console.error(error);
    const ok = downloadFileFallback(filename, content, type);
    if (ok) {
      markSaved();
      showStatus("JSON generado con descarga alternativa");
      return filename;
    } else {
      showStatus("No se pudo guardar. Probá con Copiar JSON.");
      return null;
    }
  }
}

function downloadFileFallback(filename, content, type) {
  try {
    return downloadBlobFallback(filename, new Blob([content], { type }));
  } catch (error) {
    console.error(error);
    return false;
  }
}

function downloadBlobFallback(filename, blob) {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.target = "_self";
    link.style.position = "fixed";
    link.style.left = "-9999px";
    link.style.top = "-9999px";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (link.parentNode) link.parentNode.removeChild(link);
      URL.revokeObjectURL(url);
    }, 1000);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = "Tenés cambios sin guardar. ¿Seguro que querés salir?";
});

render();
updateUndoButton();
focusEditor();
