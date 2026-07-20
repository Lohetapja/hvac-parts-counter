import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { detectLabels, type PdfTextItem } from './detection';
import { exportDate, makeDetailedCsv, makeSummaryCsv, safeFileBase } from './export';
import { distanceToSegment, PDF_POINT_MM, polylinePdfDistance, presetMmPerPdfPoint, routeLengthM, snapPoint } from './measurements';
import { clearSavedProject, loadProject, saveProject } from './storage';
import type { DetectionSuggestion, PartItem, Point, ProjectData, RouteItem, Tool } from './types';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const SYSTEMS = ['Supply air', 'Extract air', 'Outdoor air', 'Exhaust air', 'Transfer air', 'Other'];
const PART_CATEGORIES = ['Bend 15°', 'Bend 30°', 'Bend 45°', 'Bend 90°', 'Tee', 'Branch', 'Reducer', 'Enlargement', 'End cap', 'Damper', 'Fire damper', 'Silencer', 'Flexible connector', 'Vertical rise', 'Vertical drop', 'Air terminal/device', 'Custom item'];
const DEVICE_CATEGORIES = new Set(['Air terminal/device']);
const MAX_CANVAS_PIXELS = 18_000_000;

function now(): string { return new Date().toISOString(); }
function uid(prefix: string): string { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function freshProject(): ProjectData {
  const timestamp = now();
  return {
    version: 2, projectName: 'Tomorrow HVAC Takeoff', drawing: null, page: 1, scaleRatio: 50, customScaleRatio: 50,
    calibration: { mode: 'preset', mmPerPdfPoint: presetMmPerPdfPoint(50) }, routes: [], parts: [],
    rejectedDetectionIds: [], createdAt: timestamp, updatedAt: timestamp,
  };
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}
function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function drawingFingerprint(file: File): string { return `${file.name.toLowerCase()}|${file.size}|${file.lastModified}`; }
function cloneTakeoff(): HistoryState { return structuredClone({ routes: project.routes, parts: project.parts }); }

interface HistoryState { routes: RouteItem[]; parts: PartItem[] }
interface HistoryEntry { before: HistoryState; after: HistoryState }

let project = loadProject() ?? freshProject();
let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
let pdfPage: pdfjsLib.PDFPageProxy | null = null;
let pdfLoadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
let renderTask: pdfjsLib.RenderTask | null = null;
let renderGeneration = 0;
let basePageWidth = 1;
let basePageHeight = 1;
let fitScale = 1;
let zoomFactor = 1;
let renderScale = 1;
let tool: Tool = 'pan';
let currentTrace: Point[] = [];
let previewPoint: Point | null = null;
let calibrationPoints: Point[] = [];
let selectedRouteId: string | null = null;
let selectedPartId: string | null = null;
let detections: DetectionSuggestion[] = [];
let panState: { x: number; y: number; left: number; top: number } | null = null;
let undoStack: HistoryEntry[] = [];
let redoStack: HistoryEntry[] = [];
let saveTimer = 0;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');
app.innerHTML = `
<div class="app-shell">
  <header class="topbar">
    <div class="brand"><div class="brand-mark">HV</div><div><h1>HVAC Parts Counter</h1><p>Local assisted PDF takeoff</p></div></div>
    <div class="workflow" aria-label="Workflow"><span data-step="upload">1 Upload</span><span data-step="calibrate">2 Calibrate</span><span data-step="measure">3 Measure</span><span data-step="parts">4 Add parts</span><span data-step="export">5 Export</span></div>
    <div class="top-actions">
      <input id="pdfInput" class="file-input" type="file" accept="application/pdf,.pdf">
      <button id="uploadBtn" class="btn primary">Upload PDF</button><button id="saveBtn" class="btn">Save project</button>
      <button id="restoreBtn" class="btn">Restore saved</button><button id="newBtn" class="btn ghost">New project</button><button id="clearBtn" class="btn ghost danger">Clear</button>
    </div>
  </header>
  <main class="workspace">
    <aside class="sidebar left">
      <section class="panel"><div class="panel-header"><h2>Project</h2><span id="demoBadge" class="badge muted">Not ready</span></div><div class="panel-body">
        <label class="field"><span class="label">Project name</span><input id="projectName" class="input" maxlength="100"></label>
        <div class="field"><span class="label">Drawing</span><div id="fileName" class="help">No PDF loaded.</div></div>
        <div class="inline"><label class="field"><span class="label">Page</span><select id="pageSelect" class="select" disabled><option>1</option></select></label><div class="field"><span class="label">Local status</span><div id="savedStatus" class="help">Not saved yet</div></div></div>
      </div></section>
      <section class="panel"><div class="panel-header"><h2>Scale & calibration</h2><span id="scaleStatus" class="badge warning">Preset 1:50</span></div><div class="panel-body">
        <label class="field"><span class="label">Drawing scale</span><select id="scalePreset" class="select"><option value="20">1:20</option><option value="50">1:50</option><option value="100">1:100</option><option value="200">1:200</option><option value="custom">Custom</option></select></label>
        <label id="customScaleField" class="field hidden"><span class="label">Custom ratio (1:n)</span><input id="customScale" class="input" type="number" min="1" max="10000" value="50"></label>
        <label class="field"><span class="label">Known reference (mm)</span><input id="knownLength" class="input" type="number" min="1" value="3000"></label>
        <div class="button-row"><button id="calibrateBtn" class="btn">Calibrate: 2 points</button><button id="resetCalibrationBtn" class="btn ghost" disabled>Reset preset</button></div>
        <div id="calibrationInstructions" class="callout hidden">Calibration active: click the two endpoints of the known dimension. Escape cancels.</div>
        <div id="calibrationReadout" class="help"></div>
      </div></section>
      <section class="panel"><div class="panel-header"><h2>Route</h2><span id="activeTool" class="badge">Pan</span></div><div class="panel-body">
        <label class="field"><span class="label">Shape</span><select id="ductShape" class="select"><option value="round">Round</option><option value="rectangular">Rectangular</option></select></label>
        <label class="field"><span class="label">Size</span><input id="ductSize" class="input" value="Ø200" placeholder="Ø200 or 400x300"></label>
        <label class="field"><span class="label">System</span><select id="ductSystem" class="select">${SYSTEMS.map((value) => `<option>${value}</option>`).join('')}</select></label>
        <label class="field"><span class="label">Notes</span><input id="ductNotes" class="input" placeholder="Optional"></label>
        <div class="button-row"><button id="traceBtn" class="btn primary">Trace route</button><button id="finishTraceBtn" class="btn" disabled>Finish</button><button id="undoPointBtn" class="btn ghost" disabled>Undo point</button></div>
        <p class="help">Click centreline points. Shift snaps to 45°/90°. Double-click or Enter finishes; Escape cancels.</p>
        <div id="selectionActions" class="button-row hidden"><button id="updateRouteBtn" class="btn">Update selected</button><button id="deleteRouteBtn" class="btn danger">Delete route</button></div>
      </div></section>
      <section class="panel"><div class="panel-header"><h2>Quick parts</h2></div><div class="panel-body">
        <label class="field"><span class="label">Category</span><select id="partCategory" class="select">${PART_CATEGORIES.map((value) => `<option>${value}</option>`).join('')}</select></label>
        <label class="field"><span class="label">Model / description</span><input id="partModel" class="input" placeholder="Optional model"></label>
        <div class="inline"><label class="field"><span class="label">Size</span><input id="partSize" class="input" placeholder="Ø200"></label><label class="field"><span class="label">Quantity</span><input id="partQuantity" class="input" type="number" min="1" value="1"></label></div>
        <label class="field"><span class="label">System</span><select id="partSystem" class="select">${SYSTEMS.map((value) => `<option>${value}</option>`).join('')}</select></label>
        <div class="inline"><label class="field"><span class="label">Added duct (m)</span><input id="partLength" class="input" type="number" min="0" step="0.1" value="0"></label><label class="field"><span class="label">Status</span><select id="partStatus" class="select"><option value="verified">Verified</option><option value="suggested">Suggested</option></select></label></div>
        <label class="field"><span class="label">Notes</span><input id="partNotes" class="input" placeholder="Optional"></label>
        <div class="button-row"><button id="addPartBtn" class="btn primary">Add part</button><button id="updatePartBtn" class="btn hidden">Update selected</button><button id="deletePartBtn" class="btn danger hidden">Delete</button></div>
      </div></section>
    </aside>
    <section class="viewer-column">
      <div class="viewer-toolbar"><button class="tool active" data-tool="pan">Pan</button><button class="tool" data-tool="calibrate">Scale</button><button class="tool" data-tool="trace">Trace</button><i></i><button id="zoomOutBtn" class="tool">−</button><span id="zoomReadout" class="zoom-readout">Fit</span><button id="zoomInBtn" class="tool">+</button><button id="fitBtn" class="tool">Fit</button><i></i><button id="undoBtn" class="tool" disabled>Undo</button><button id="redoBtn" class="tool" disabled>Redo</button><div id="progress" class="progress"><span></span></div></div>
      <div id="viewerScroll" class="viewer-scroll"><div id="canvasStage" class="canvas-stage empty"><div id="emptyState" class="empty-state"><h2>Upload an HVAC PDF drawing</h2><p>The drawing stays in this browser. Saved takeoff data can be restored without storing the PDF.</p><button id="emptyUploadBtn" class="btn primary">Choose PDF</button></div><canvas id="pdfCanvas"></canvas><canvas id="overlayCanvas"></canvas></div></div>
      <div class="statusbar"><span id="statusText">Ready. Upload a PDF to begin.</span><span><strong>Private:</strong> no uploads, APIs, or tracking</span></div>
    </section>
    <aside class="sidebar right">
      <section class="panel summary-panel"><div class="panel-header"><h2>Live takeoff</h2><div><button id="exportSummaryBtn" class="btn small">Summary CSV</button><button id="exportDetailBtn" class="btn small">Details CSV</button><button id="exportJsonBtn" class="btn small">JSON</button></div></div><div class="panel-body">
        <div class="headline-grid"><div><b id="totalDuct">0.00 m</b><span>Duct</span></div><div><b id="totalRoutes">0</b><span>Routes</span></div><div><b id="totalFittings">0</b><span>Fittings</span></div><div><b id="totalDevices">0</b><span>Devices</span></div><div><b id="unverifiedCount">0</b><span>Unverified</span></div></div>
        <h3>Duct groups</h3><div id="ductSummary" class="item-list"></div><h3>Parts & devices</h3><div id="partSummary" class="item-list"></div>
      </div></section>
      <section class="panel"><div class="panel-header"><h2>Detailed items</h2></div><div class="panel-body"><div id="detailList" class="item-list"></div></div></section>
      <section class="panel"><div class="panel-header"><h2>Detected labels</h2><button id="scanBtn" class="btn small" disabled>Scan page</button></div><div class="panel-body"><p class="help">Suggestions from PDF text only. Review, edit, accept, or reject.</p><div id="detectionList" class="detection-list"></div></div></section>
    </aside>
  </main>
</div><div id="toast" class="toast"></div>`;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
const els = {
  pdfInput: byId<HTMLInputElement>('pdfInput'), uploadBtn: byId<HTMLButtonElement>('uploadBtn'), emptyUploadBtn: byId<HTMLButtonElement>('emptyUploadBtn'),
  saveBtn: byId<HTMLButtonElement>('saveBtn'), restoreBtn: byId<HTMLButtonElement>('restoreBtn'), newBtn: byId<HTMLButtonElement>('newBtn'), clearBtn: byId<HTMLButtonElement>('clearBtn'),
  projectName: byId<HTMLInputElement>('projectName'), fileName: byId<HTMLDivElement>('fileName'), pageSelect: byId<HTMLSelectElement>('pageSelect'), savedStatus: byId<HTMLDivElement>('savedStatus'), demoBadge: byId<HTMLSpanElement>('demoBadge'),
  scalePreset: byId<HTMLSelectElement>('scalePreset'), customScaleField: byId<HTMLElement>('customScaleField'), customScale: byId<HTMLInputElement>('customScale'), knownLength: byId<HTMLInputElement>('knownLength'), calibrateBtn: byId<HTMLButtonElement>('calibrateBtn'), resetCalibrationBtn: byId<HTMLButtonElement>('resetCalibrationBtn'), scaleStatus: byId<HTMLSpanElement>('scaleStatus'), calibrationInstructions: byId<HTMLDivElement>('calibrationInstructions'), calibrationReadout: byId<HTMLDivElement>('calibrationReadout'),
  ductShape: byId<HTMLSelectElement>('ductShape'), ductSize: byId<HTMLInputElement>('ductSize'), ductSystem: byId<HTMLSelectElement>('ductSystem'), ductNotes: byId<HTMLInputElement>('ductNotes'), traceBtn: byId<HTMLButtonElement>('traceBtn'), finishTraceBtn: byId<HTMLButtonElement>('finishTraceBtn'), undoPointBtn: byId<HTMLButtonElement>('undoPointBtn'), activeTool: byId<HTMLSpanElement>('activeTool'), selectionActions: byId<HTMLDivElement>('selectionActions'), updateRouteBtn: byId<HTMLButtonElement>('updateRouteBtn'), deleteRouteBtn: byId<HTMLButtonElement>('deleteRouteBtn'),
  partCategory: byId<HTMLSelectElement>('partCategory'), partModel: byId<HTMLInputElement>('partModel'), partSize: byId<HTMLInputElement>('partSize'), partQuantity: byId<HTMLInputElement>('partQuantity'), partSystem: byId<HTMLSelectElement>('partSystem'), partLength: byId<HTMLInputElement>('partLength'), partStatus: byId<HTMLSelectElement>('partStatus'), partNotes: byId<HTMLInputElement>('partNotes'), addPartBtn: byId<HTMLButtonElement>('addPartBtn'), updatePartBtn: byId<HTMLButtonElement>('updatePartBtn'), deletePartBtn: byId<HTMLButtonElement>('deletePartBtn'),
  viewerScroll: byId<HTMLDivElement>('viewerScroll'), canvasStage: byId<HTMLDivElement>('canvasStage'), emptyState: byId<HTMLDivElement>('emptyState'), pdfCanvas: byId<HTMLCanvasElement>('pdfCanvas'), overlayCanvas: byId<HTMLCanvasElement>('overlayCanvas'), zoomOutBtn: byId<HTMLButtonElement>('zoomOutBtn'), zoomInBtn: byId<HTMLButtonElement>('zoomInBtn'), fitBtn: byId<HTMLButtonElement>('fitBtn'), zoomReadout: byId<HTMLSpanElement>('zoomReadout'), undoBtn: byId<HTMLButtonElement>('undoBtn'), redoBtn: byId<HTMLButtonElement>('redoBtn'), progress: byId<HTMLDivElement>('progress'), statusText: byId<HTMLSpanElement>('statusText'),
  totalDuct: byId<HTMLElement>('totalDuct'), totalRoutes: byId<HTMLElement>('totalRoutes'), totalFittings: byId<HTMLElement>('totalFittings'), totalDevices: byId<HTMLElement>('totalDevices'), unverifiedCount: byId<HTMLElement>('unverifiedCount'), ductSummary: byId<HTMLDivElement>('ductSummary'), partSummary: byId<HTMLDivElement>('partSummary'), detailList: byId<HTMLDivElement>('detailList'), scanBtn: byId<HTMLButtonElement>('scanBtn'), detectionList: byId<HTMLDivElement>('detectionList'), exportSummaryBtn: byId<HTMLButtonElement>('exportSummaryBtn'), exportDetailBtn: byId<HTMLButtonElement>('exportDetailBtn'), exportJsonBtn: byId<HTMLButtonElement>('exportJsonBtn'), toast: byId<HTMLDivElement>('toast'),
};

function toast(message: string): void { els.toast.textContent = message; els.toast.classList.add('show'); window.setTimeout(() => els.toast.classList.remove('show'), 2200); }
function status(message: string): void { els.statusText.textContent = message; }
function loading(active: boolean): void { els.progress.classList.toggle('active', active); }
function markChanged(): void {
  project.updatedAt = now();
  window.clearTimeout(saveTimer);
  els.savedStatus.textContent = 'Unsaved changes…';
  saveTimer = window.setTimeout(() => persist(false), 500);
  renderUi();
}
function persist(notify = true): void {
  project.projectName = els.projectName.value.trim() || 'Untitled HVAC Takeoff';
  project.updatedAt = now(); saveProject(project);
  els.savedStatus.textContent = `Saved locally ${new Date(project.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (notify) toast('Project saved locally');
}
function recordChange(before: HistoryState): void {
  undoStack.push({ before, after: cloneTakeoff() });
  if (undoStack.length > 80) undoStack.shift();
  redoStack = []; markChanged();
}
function applyHistory(state: HistoryState): void { project.routes = structuredClone(state.routes); project.parts = structuredClone(state.parts); selectedRouteId = null; selectedPartId = null; markChanged(); }
function undo(): void { const entry = undoStack.pop(); if (!entry) return; redoStack.push(entry); applyHistory(entry.before); toast('Undid last takeoff change'); }
function redo(): void { const entry = redoStack.pop(); if (!entry) return; undoStack.push(entry); applyHistory(entry.after); toast('Redid takeoff change'); }

function setTool(next: Tool): void {
  if (next !== 'trace' && currentTrace.length) cancelTrace(false);
  if (next !== 'calibrate') calibrationPoints = [];
  tool = next; previewPoint = null;
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === next));
  els.activeTool.textContent = next === 'pan' ? 'Pan' : next === 'trace' ? 'Trace active' : 'Calibration active';
  els.activeTool.classList.toggle('warning', next !== 'pan');
  els.calibrationInstructions.classList.toggle('hidden', next !== 'calibrate');
  els.overlayCanvas.style.cursor = next === 'pan' ? 'grab' : 'crosshair';
  status(next === 'pan' ? 'Pan mode. Drag the drawing; click a completed route to select it.' : next === 'trace' ? 'Trace mode: click centreline points. Shift snaps. Enter or double-click finishes.' : 'Calibration mode: click two endpoints of the known dimension.');
  drawOverlay();
}

function selectedScale(): number {
  return els.scalePreset.value === 'custom' ? Math.max(1, Number(els.customScale.value) || 50) : Number(els.scalePreset.value);
}
function resetCalibration(): void {
  project.scaleRatio = selectedScale(); project.customScaleRatio = Number(els.customScale.value) || 50;
  project.calibration = { mode: 'preset', mmPerPdfPoint: presetMmPerPdfPoint(project.scaleRatio) };
  markChanged(); toast(`Scale reset to 1:${project.scaleRatio}`);
}
function applyCalibration(): void {
  if (calibrationPoints.length !== 2) return;
  const known = Number(els.knownLength.value);
  const distance = polylinePdfDistance(calibrationPoints);
  if (!Number.isFinite(known) || known <= 0) { calibrationPoints = []; toast('Enter a valid known reference length'); return; }
  if (distance < 8) { calibrationPoints = []; drawOverlay(); toast('Calibration line is too short. Use endpoints farther apart.'); return; }
  const mmPerPdfPoint = known / distance;
  project.calibration = { mode: 'calibrated', mmPerPdfPoint, knownLengthMm: known, measuredPdfPoints: distance, effectiveScale: mmPerPdfPoint / PDF_POINT_MM };
  calibrationPoints = []; setTool('pan'); markChanged(); toast('Two-point calibration applied');
}

async function loadPdf(file: File): Promise<void> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { toast('Choose a PDF file'); status('The selected file is not a PDF.'); return; }
  const fingerprint = drawingFingerprint(file);
  if (project.drawing && project.drawing.fingerprint !== fingerprint && (project.routes.length || project.parts.length)) {
    const keep = window.confirm(`This appears to be a different drawing than “${project.drawing.fileName}”.\n\nOK keeps the saved overlays. Cancel starts a clean takeoff for the new drawing.`);
    if (!keep) { project.routes = []; project.parts = []; project.rejectedDetectionIds = []; undoStack = []; redoStack = []; }
  }
  loading(true); status(`Loading ${file.name} locally…`);
  try {
    renderGeneration += 1;
    renderTask?.cancel();
    if (pdfLoadingTask) { try { await pdfLoadingTask.destroy(); } catch (error) { console.warn('Previous PDF cleanup failed', error); } }
    const buffer = await file.arrayBuffer();
    pdfLoadingTask = pdfjsLib.getDocument({ data: buffer });
    pdfDoc = await pdfLoadingTask.promise;
    const requestedPage = Math.min(Math.max(1, project.page), pdfDoc.numPages);
    project.drawing = { fileName: file.name, fingerprint, pageCount: pdfDoc.numPages };
    project.page = requestedPage;
    els.pageSelect.replaceChildren(...Array.from({ length: pdfDoc.numPages }, (_, index) => new Option(`Page ${index + 1}`, String(index + 1))));
    els.pageSelect.value = String(requestedPage); els.pageSelect.disabled = pdfDoc.numPages <= 1;
    els.canvasStage.classList.remove('empty'); els.emptyState.hidden = true; els.scanBtn.disabled = false;
    await openPage(requestedPage, true);
    markChanged(); toast(`Loaded ${file.name}`); status(`Loaded ${file.name} — ${pdfDoc.numPages} page${pdfDoc.numPages === 1 ? '' : 's'}.`);
  } catch (error) {
    console.error(error); pdfDoc = null; pdfPage = null; els.scanBtn.disabled = true;
    status('PDF loading failed. The file may be damaged, encrypted, or unsupported.'); toast('Could not load this PDF');
  } finally { loading(false); }
}
async function openPage(pageNumber: number, fit = false): Promise<void> {
  if (!pdfDoc) return;
  pdfPage = await pdfDoc.getPage(pageNumber); project.page = pageNumber;
  const viewport = pdfPage.getViewport({ scale: 1 }); basePageWidth = viewport.width; basePageHeight = viewport.height;
  detections = []; renderDetections();
  if (fit) await fitAndRender(); else await renderPage();
}
async function fitAndRender(): Promise<void> {
  if (!pdfPage) return;
  const widthScale = Math.max(0.05, (els.viewerScroll.clientWidth - 56) / basePageWidth);
  const heightScale = Math.max(0.05, (els.viewerScroll.clientHeight - 56) / basePageHeight);
  fitScale = Math.min(widthScale, heightScale, 1.5); zoomFactor = 1;
  await renderPage(); els.viewerScroll.scrollTo({ left: 0, top: 0 });
}
async function renderPage(): Promise<void> {
  if (!pdfPage) return;
  const generation = ++renderGeneration; loading(true);
  try {
    if (renderTask) { renderTask.cancel(); try { await renderTask.promise; } catch { /* expected cancellation */ } }
    const requested = fitScale * zoomFactor;
    const pixelLimitScale = Math.sqrt(MAX_CANVAS_PIXELS / (basePageWidth * basePageHeight));
    renderScale = Math.min(requested, pixelLimitScale);
    if (renderScale < requested) status('Zoom limited to protect browser memory on this large drawing.');
    const viewport = pdfPage.getViewport({ scale: renderScale });
    const width = Math.max(1, Math.floor(viewport.width)); const height = Math.max(1, Math.floor(viewport.height));
    els.pdfCanvas.width = width; els.pdfCanvas.height = height; els.overlayCanvas.width = width; els.overlayCanvas.height = height;
    els.canvasStage.style.width = `${width}px`; els.canvasStage.style.height = `${height}px`;
    const context = els.pdfCanvas.getContext('2d', { alpha: false }); if (!context) throw new Error('Canvas unavailable');
    renderTask = pdfPage.render({ canvas: els.pdfCanvas, canvasContext: context, viewport }); await renderTask.promise;
    if (generation !== renderGeneration) return;
    els.zoomReadout.textContent = `${Math.round(renderScale / fitScale * 100)}%`;
    drawOverlay();
  } catch (error) {
    if (!(error instanceof Error && error.name === 'RenderingCancelledException')) { console.error(error); status('Drawing render failed. Try Fit or a lower zoom.'); }
  } finally { if (generation === renderGeneration) { renderTask = null; loading(false); } }
}

function eventPoint(event: PointerEvent | MouseEvent): Point {
  const rect = els.overlayCanvas.getBoundingClientRect();
  const candidate = { x: (event.clientX - rect.left) / renderScale, y: (event.clientY - rect.top) / renderScale };
  return event.shiftKey && currentTrace.length ? snapPoint(currentTrace[currentTrace.length - 1], candidate) : candidate;
}
function drawPolyline(context: CanvasRenderingContext2D, points: Point[], color: string, width: number, dashed = false): void {
  if (!points.length) return;
  context.save(); context.beginPath(); context.setLineDash(dashed ? [9, 7] : []); context.moveTo(points[0].x * renderScale, points[0].y * renderScale);
  points.slice(1).forEach((point) => context.lineTo(point.x * renderScale, point.y * renderScale)); context.strokeStyle = color; context.lineWidth = width; context.lineJoin = 'round'; context.lineCap = 'round'; context.stroke();
  points.forEach((point) => { context.beginPath(); context.arc(point.x * renderScale, point.y * renderScale, 3.5, 0, Math.PI * 2); context.fillStyle = color; context.fill(); }); context.restore();
}
function drawOverlay(): void {
  const context = els.overlayCanvas.getContext('2d'); if (!context) return; context.clearRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);
  project.routes.filter((route) => route.page === project.page).forEach((route) => {
    const selected = route.id === selectedRouteId; const color = selected ? '#ffe08a' : route.system.includes('Extract') || route.system.includes('Exhaust') ? '#ff9d7a' : '#57c7ff';
    drawPolyline(context, route.points, color, selected ? 7 : 4);
    const point = route.points[Math.floor(route.points.length / 2)]; if (!point) return;
    const label = `${route.size} · ${routeLengthM(route, project).toFixed(2)} m`; context.save(); context.font = '600 12px system-ui';
    const width = context.measureText(label).width + 12; context.fillStyle = 'rgba(7,16,25,.9)'; context.fillRect(point.x * renderScale - width / 2, point.y * renderScale - 25, width, 19); context.fillStyle = selected ? '#ffe08a' : '#eef7ff'; context.fillText(label, point.x * renderScale - width / 2 + 6, point.y * renderScale - 11); context.restore();
  });
  const live = previewPoint && currentTrace.length ? [...currentTrace, previewPoint] : currentTrace;
  if (live.length) drawPolyline(context, live, '#8ee3c2', 4, true);
  if (calibrationPoints.length) drawPolyline(context, calibrationPoints, '#f9c66f', 4, true);
}
function hitRoute(point: Point): RouteItem | null {
  const threshold = 10 / renderScale;
  return [...project.routes].reverse().find((route) => route.page === project.page && route.points.slice(1).some((end, index) => distanceToSegment(point, route.points[index], end) <= threshold)) ?? null;
}
function startTrace(): void { if (!pdfPage) { toast('Upload a PDF first'); return; } currentTrace = []; previewPoint = null; selectedRouteId = null; setTool('trace'); renderUi(); }
function finishTrace(): void {
  if (currentTrace.length < 2) { toast('A route needs at least two points'); return; }
  const before = cloneTakeoff();
  project.routes.push({ id: uid('route'), page: project.page, shape: els.ductShape.value === 'rectangular' ? 'rectangular' : 'round', size: els.ductSize.value.trim() || 'Unspecified', system: els.ductSystem.value, notes: els.ductNotes.value.trim(), points: structuredClone(currentTrace), createdAt: now(), status: 'verified' });
  currentTrace = []; previewPoint = null; setTool('pan'); recordChange(before); toast('Duct route added');
}
function cancelTrace(notify = true): void { currentTrace = []; previewPoint = null; drawOverlay(); renderUi(); if (notify) toast('Current route cancelled'); }
function selectRoute(route: RouteItem | null): void {
  selectedRouteId = route?.id ?? null; selectedPartId = null;
  if (route) { els.ductShape.value = route.shape; els.ductSize.value = route.size; els.ductSystem.value = route.system; els.ductNotes.value = route.notes; }
  renderUi();
}
function updateSelectedRoute(): void {
  const route = project.routes.find((item) => item.id === selectedRouteId); if (!route) return;
  const before = cloneTakeoff(); route.shape = els.ductShape.value === 'rectangular' ? 'rectangular' : 'round'; route.size = els.ductSize.value.trim() || 'Unspecified'; route.system = els.ductSystem.value; route.notes = els.ductNotes.value.trim(); recordChange(before); toast('Route metadata updated');
}
function deleteSelection(): void {
  if (selectedRouteId) { const before = cloneTakeoff(); project.routes = project.routes.filter((route) => route.id !== selectedRouteId); selectedRouteId = null; recordChange(before); toast('Route deleted'); return; }
  if (selectedPartId) { const before = cloneTakeoff(); project.parts = project.parts.filter((part) => part.id !== selectedPartId); selectedPartId = null; recordChange(before); toast('Part deleted'); }
}
function addPart(): void {
  const quantity = Math.floor(Number(els.partQuantity.value)); const addedLengthM = Number(els.partLength.value);
  if (!Number.isFinite(quantity) || quantity < 1 || !Number.isFinite(addedLengthM) || addedLengthM < 0) { toast('Enter a valid quantity and added length'); return; }
  const before = cloneTakeoff(); project.parts.push({ id: uid('part'), category: els.partCategory.value, model: els.partModel.value.trim(), size: els.partSize.value.trim(), system: els.partSystem.value, quantity, addedLengthM, notes: els.partNotes.value.trim(), source: 'manual', status: els.partStatus.value === 'suggested' ? 'suggested' : 'verified', page: project.page, createdAt: now() }); recordChange(before); toast(`${els.partCategory.value} added`);
}
function selectPart(part: PartItem): void {
  selectedPartId = part.id; selectedRouteId = null; els.partCategory.value = part.category; els.partModel.value = part.model; els.partSize.value = part.size; els.partQuantity.value = String(part.quantity); els.partSystem.value = part.system; els.partLength.value = String(part.addedLengthM); els.partStatus.value = part.status; els.partNotes.value = part.notes; renderUi();
}
function updateSelectedPart(): void {
  const part = project.parts.find((item) => item.id === selectedPartId); if (!part) return;
  const quantity = Math.floor(Number(els.partQuantity.value)); const length = Number(els.partLength.value); if (quantity < 1 || length < 0) { toast('Enter valid values'); return; }
  const before = cloneTakeoff(); Object.assign(part, { category: els.partCategory.value, model: els.partModel.value.trim(), size: els.partSize.value.trim(), quantity, system: els.partSystem.value, addedLengthM: length, status: els.partStatus.value === 'suggested' ? 'suggested' : 'verified', notes: els.partNotes.value.trim() }); recordChange(before); toast('Part updated');
}

async function scanPage(): Promise<void> {
  if (!pdfPage) return; loading(true); status(`Scanning page ${project.page} text for supported HVAC labels…`);
  try {
    const text = await pdfPage.getTextContent();
    const items = text.items.filter((item): item is PdfTextItem & typeof item => 'str' in item && 'transform' in item).map((item) => ({ str: item.str, transform: [...item.transform], width: item.width }));
    detections = detectLabels(items, project.page).filter((item) => !project.rejectedDetectionIds.includes(item.id));
    renderDetections(); status(`Found ${detections.length} review suggestion${detections.length === 1 ? '' : 's'} on page ${project.page}.`); toast(`Found ${detections.length} suggestion${detections.length === 1 ? '' : 's'}`);
  } catch (error) { console.error(error); status('Text scan failed. The PDF may not contain an accessible text layer.'); toast('Could not scan PDF text'); }
  finally { loading(false); }
}
function acceptDetection(id: string): void {
  const suggestion = detections.find((item) => item.id === id); if (!suggestion) return;
  if (project.parts.some((part) => part.detectionId === id)) { toast('This suggestion was already accepted'); return; }
  const modelInput = byId<HTMLInputElement>(`det-model-${id}`); const quantityInput = byId<HTMLInputElement>(`det-qty-${id}`);
  const quantity = Math.floor(Number(quantityInput.value)); if (quantity < 1) { toast('Enter a valid quantity'); return; }
  const before = cloneTakeoff(); project.parts.push({ id: uid('part'), category: 'Air terminal/device', model: modelInput.value.trim() || suggestion.model, size: '', system: 'Other', quantity, addedLengthM: 0, notes: `Detected on page ${suggestion.page}. Raw: ${suggestion.raw}`, source: 'detected', status: 'verified', page: suggestion.page, createdAt: now(), detectionId: id }); recordChange(before); renderDetections(); toast('Detected label accepted');
}
function rejectDetection(id: string): void { if (!project.rejectedDetectionIds.includes(id)) project.rejectedDetectionIds.push(id); detections = detections.filter((item) => item.id !== id); markChanged(); renderDetections(); toast('Suggestion rejected'); }

function renderDetections(): void {
  if (!detections.length) { els.detectionList.innerHTML = '<div class="empty-mini">No active suggestions. Load a PDF and scan the current page.</div>'; return; }
  els.detectionList.innerHTML = detections.map((item) => {
    const accepted = project.parts.some((part) => part.detectionId === item.id);
    return `<div class="detection-card"><div class="inline"><label class="field"><span class="label">Normalized label</span><input id="det-model-${item.id}" class="input" value="${escapeHtml(item.model)}"></label><label class="field qty"><span class="label">Qty</span><input id="det-qty-${item.id}" class="input" type="number" min="1" value="${item.quantity}"></label></div><div class="item-meta">${item.occurrences} matched occurrence${item.occurrences === 1 ? '' : 's'} · Page ${item.page}<br>Raw: ${escapeHtml(item.raw)}</div><div class="button-row"><button class="btn small" data-accept="${item.id}" ${accepted ? 'disabled' : ''}>${accepted ? 'Accepted' : 'Accept'}</button><button class="btn small ghost danger" data-reject="${item.id}">Reject</button></div></div>`;
  }).join('');
}

function renderUi(): void {
  const totalLength = project.routes.reduce((sum, route) => sum + routeLengthM(route, project), 0) + project.parts.reduce((sum, part) => sum + part.addedLengthM * part.quantity, 0);
  const fittingQuantity = project.parts.filter((part) => !DEVICE_CATEGORIES.has(part.category)).reduce((sum, part) => sum + part.quantity, 0);
  const deviceQuantity = project.parts.filter((part) => DEVICE_CATEGORIES.has(part.category)).reduce((sum, part) => sum + part.quantity, 0);
  const pendingDetections = detections.filter((item) => !project.parts.some((part) => part.detectionId === item.id)).length;
  const unverified = project.parts.filter((part) => part.status === 'suggested').reduce((sum, part) => sum + part.quantity, 0) + pendingDetections;
  els.totalDuct.textContent = `${totalLength.toFixed(2)} m`; els.totalRoutes.textContent = String(project.routes.length); els.totalFittings.textContent = String(fittingQuantity); els.totalDevices.textContent = String(deviceQuantity); els.unverifiedCount.textContent = String(unverified);
  els.fileName.textContent = pdfDoc ? `${project.drawing?.fileName ?? 'PDF'} · ${pdfDoc.numPages} page${pdfDoc.numPages === 1 ? '' : 's'}` : project.drawing ? `${project.drawing.fileName} · reload PDF to view overlays` : 'No PDF loaded.';
  els.demoBadge.textContent = pdfDoc && (project.routes.length || project.parts.length) ? 'Demo ready' : 'Not ready'; els.demoBadge.classList.toggle('ready', Boolean(pdfDoc && (project.routes.length || project.parts.length)));
  els.selectionActions.classList.toggle('hidden', !selectedRouteId); els.updatePartBtn.classList.toggle('hidden', !selectedPartId); els.deletePartBtn.classList.toggle('hidden', !selectedPartId); els.addPartBtn.classList.toggle('hidden', Boolean(selectedPartId));
  els.finishTraceBtn.disabled = currentTrace.length < 2; els.undoPointBtn.disabled = currentTrace.length === 0; els.undoBtn.disabled = !undoStack.length; els.redoBtn.disabled = !redoStack.length;
  els.resetCalibrationBtn.disabled = project.calibration.mode === 'preset';
  if (project.calibration.mode === 'calibrated') {
    els.scaleStatus.textContent = `Calibrated ≈ 1:${project.calibration.effectiveScale?.toFixed(1)}`; els.scaleStatus.classList.remove('warning');
    els.calibrationReadout.textContent = `Known ${project.calibration.knownLengthMm?.toFixed(0)} mm · measured ${project.calibration.measuredPdfPoints?.toFixed(2)} PDF pt · ${project.calibration.mmPerPdfPoint.toFixed(3)} real mm/PDF pt.`;
  } else {
    els.scaleStatus.textContent = `Preset 1:${project.scaleRatio}`; els.scaleStatus.classList.add('warning');
    els.calibrationReadout.textContent = `1 PDF point = ${project.calibration.mmPerPdfPoint.toFixed(3)} real mm. At 1:${project.scaleRatio}, 20 drawing mm = ${(20 * project.scaleRatio / 1000).toFixed(2)} real m.`;
  }
  const ducts = new Map<string, { shape: string; size: string; system: string; count: number; length: number }>();
  project.routes.forEach((route) => { const key = `${route.shape}|${route.size}|${route.system}`; const value = ducts.get(key) ?? { shape: route.shape, size: route.size, system: route.system, count: 0, length: 0 }; value.count += 1; value.length += routeLengthM(route, project); ducts.set(key, value); });
  els.ductSummary.innerHTML = ducts.size ? [...ducts.values()].map((item) => `<div class="summary-row"><b>${escapeHtml(item.size)}</b><span>${escapeHtml(item.shape)} · ${escapeHtml(item.system)} · ${item.count} route${item.count === 1 ? '' : 's'}</span><strong>${item.length.toFixed(2)} m</strong></div>`).join('') : '<div class="empty-mini">No duct groups yet.</div>';
  const groups = new Map<string, { label: string; system: string; status: string; quantity: number }>();
  project.parts.forEach((part) => { const key = `${part.category}|${part.model}|${part.size}|${part.system}|${part.status}`; const value = groups.get(key) ?? { label: [part.category, part.model, part.size].filter(Boolean).join(' · '), system: part.system, status: part.status, quantity: 0 }; value.quantity += part.quantity; groups.set(key, value); });
  els.partSummary.innerHTML = groups.size ? [...groups.values()].map((item) => `<div class="summary-row"><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.system)} · ${escapeHtml(item.status)}</span><strong>${item.quantity}×</strong></div>`).join('') : '<div class="empty-mini">No parts or devices yet.</div>';
  const routeCards = project.routes.map((route) => `<button class="item-card selectable ${route.id === selectedRouteId ? 'selected' : ''}" data-route="${route.id}"><span><b>${escapeHtml(route.size)} · ${routeLengthM(route, project).toFixed(2)} m</b><small>${escapeHtml(route.shape)} · ${escapeHtml(route.system)} · Page ${route.page}${route.notes ? ` · ${escapeHtml(route.notes)}` : ''}</small></span></button>`);
  const partCards = project.parts.map((part) => `<button class="item-card selectable ${part.id === selectedPartId ? 'selected' : ''}" data-part="${part.id}"><span><b>${part.quantity}× ${escapeHtml(part.category)}${part.model ? ` · ${escapeHtml(part.model)}` : ''}</b><small>${escapeHtml(part.size || 'No size')} · ${escapeHtml(part.system)} · ${part.source}/${part.status} · Page ${part.page}</small></span></button>`);
  els.detailList.innerHTML = routeCards.length || partCards.length ? [...routeCards, ...partCards].join('') : '<div class="empty-mini">Trace a route or add a part to build the takeoff.</div>';
  document.querySelectorAll<HTMLElement>('.workflow span').forEach((step) => { const name = step.dataset.step; const active = name === 'upload' ? Boolean(pdfDoc) : name === 'calibrate' ? project.calibration.mode === 'calibrated' : name === 'measure' ? project.routes.length > 0 : name === 'parts' ? project.parts.length > 0 : false; step.classList.toggle('done', active); });
  drawOverlay();
}

function restoreSaved(notify = true): void {
  const saved = loadProject(); if (!saved) { if (notify) toast('No saved project found'); return; }
  if (pdfDoc && project.drawing && saved.drawing && project.drawing.fingerprint !== saved.drawing.fingerprint && !window.confirm(`The open PDF is “${project.drawing.fileName}”, but the saved takeoff belongs to “${saved.drawing.fileName}”. Restore its overlays anyway?`)) return;
  project = saved; selectedRouteId = null; selectedPartId = null; undoStack = []; redoStack = [];
  els.projectName.value = project.projectName; els.scalePreset.value = [20, 50, 100, 200].includes(project.scaleRatio) ? String(project.scaleRatio) : 'custom'; els.customScale.value = String(project.customScaleRatio || project.scaleRatio); els.customScaleField.classList.toggle('hidden', els.scalePreset.value !== 'custom');
  els.savedStatus.textContent = `Restored ${new Date(project.updatedAt).toLocaleString()}`; renderUi(); if (notify) toast('Saved project restored — reload its PDF to view the drawing');
}
function newProject(): void {
  if ((project.routes.length || project.parts.length) && !window.confirm('Start a new project? Unsaved takeoff changes will be replaced.')) return;
  project = freshProject(); selectedRouteId = null; selectedPartId = null; undoStack = []; redoStack = []; detections = []; currentTrace = []; calibrationPoints = []; els.projectName.value = project.projectName; els.scalePreset.value = '50'; els.customScale.value = '50'; renderDetections(); markChanged(); toast('New project started');
}
function clearProject(): void {
  if (!window.confirm('Clear this project and its locally saved takeoff data? This cannot be undone.')) return;
  project = freshProject(); clearSavedProject(); selectedRouteId = null; selectedPartId = null; undoStack = []; redoStack = []; detections = []; currentTrace = []; calibrationPoints = []; els.projectName.value = project.projectName; els.savedStatus.textContent = 'Local project cleared'; renderDetections(); renderUi(); toast('Project data cleared');
}
function exportProject(kind: 'summary' | 'detail' | 'json'): void {
  project.projectName = els.projectName.value.trim() || project.projectName; const base = `${safeFileBase(project.projectName)}-${exportDate()}`;
  if (kind === 'summary') download(`${base}-summary.csv`, makeSummaryCsv(project), 'text/csv;charset=utf-8');
  else if (kind === 'detail') download(`${base}-details.csv`, makeDetailedCsv(project), 'text/csv;charset=utf-8');
  else download(`${base}.json`, JSON.stringify(project, null, 2), 'application/json');
  toast(`${kind === 'json' ? 'JSON' : 'CSV'} export created`);
}

els.uploadBtn.addEventListener('click', () => els.pdfInput.click()); els.emptyUploadBtn.addEventListener('click', () => els.pdfInput.click());
els.pdfInput.addEventListener('change', () => { const file = els.pdfInput.files?.[0]; if (file) void loadPdf(file); els.pdfInput.value = ''; });
els.projectName.addEventListener('input', markChanged); els.saveBtn.addEventListener('click', () => persist()); els.restoreBtn.addEventListener('click', () => restoreSaved()); els.newBtn.addEventListener('click', newProject); els.clearBtn.addEventListener('click', clearProject);
els.scalePreset.addEventListener('change', () => { els.customScaleField.classList.toggle('hidden', els.scalePreset.value !== 'custom'); resetCalibration(); }); els.customScale.addEventListener('change', resetCalibration); els.calibrateBtn.addEventListener('click', () => { if (!pdfPage) { toast('Upload a PDF first'); return; } calibrationPoints = []; setTool('calibrate'); }); els.resetCalibrationBtn.addEventListener('click', resetCalibration);
els.traceBtn.addEventListener('click', startTrace); els.finishTraceBtn.addEventListener('click', finishTrace); els.undoPointBtn.addEventListener('click', () => { currentTrace.pop(); previewPoint = null; renderUi(); }); els.updateRouteBtn.addEventListener('click', updateSelectedRoute); els.deleteRouteBtn.addEventListener('click', deleteSelection);
els.addPartBtn.addEventListener('click', addPart); els.updatePartBtn.addEventListener('click', updateSelectedPart); els.deletePartBtn.addEventListener('click', deleteSelection);
els.zoomInBtn.addEventListener('click', () => { zoomFactor = Math.min(6, zoomFactor * 1.25); void renderPage(); }); els.zoomOutBtn.addEventListener('click', () => { zoomFactor = Math.max(0.25, zoomFactor / 1.25); void renderPage(); }); els.fitBtn.addEventListener('click', () => void fitAndRender()); els.undoBtn.addEventListener('click', undo); els.redoBtn.addEventListener('click', redo);
els.pageSelect.addEventListener('change', () => { const page = Number(els.pageSelect.value); void openPage(page, true).then(() => { markChanged(); status(`Viewing page ${page}.`); }).catch((error: unknown) => { console.error(error); toast('Could not open that page'); }); });
els.scanBtn.addEventListener('click', () => void scanPage()); els.exportSummaryBtn.addEventListener('click', () => exportProject('summary')); els.exportDetailBtn.addEventListener('click', () => exportProject('detail')); els.exportJsonBtn.addEventListener('click', () => exportProject('json'));
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool as Tool)));

els.overlayCanvas.addEventListener('pointerdown', (event) => {
  if (!pdfPage) return;
  if (tool === 'pan') {
    const route = hitRoute(eventPoint(event)); if (route) { selectRoute(route); return; }
    selectedRouteId = null; renderUi(); els.overlayCanvas.setPointerCapture(event.pointerId); panState = { x: event.clientX, y: event.clientY, left: els.viewerScroll.scrollLeft, top: els.viewerScroll.scrollTop }; els.overlayCanvas.style.cursor = 'grabbing'; return;
  }
  const point = eventPoint(event);
  if (tool === 'trace') { currentTrace.push(point); previewPoint = null; renderUi(); }
  else { calibrationPoints.push(point); drawOverlay(); if (calibrationPoints.length === 2) applyCalibration(); }
});
els.overlayCanvas.addEventListener('pointermove', (event) => {
  if (tool === 'pan' && panState) { els.viewerScroll.scrollLeft = panState.left - (event.clientX - panState.x); els.viewerScroll.scrollTop = panState.top - (event.clientY - panState.y); }
  else if (tool === 'trace' && currentTrace.length) { previewPoint = eventPoint(event); drawOverlay(); }
});
els.overlayCanvas.addEventListener('pointerleave', () => { if (tool === 'trace') { previewPoint = null; drawOverlay(); } });
els.overlayCanvas.addEventListener('pointerup', (event) => { if (panState) { panState = null; if (els.overlayCanvas.hasPointerCapture(event.pointerId)) els.overlayCanvas.releasePointerCapture(event.pointerId); els.overlayCanvas.style.cursor = 'grab'; } });
els.overlayCanvas.addEventListener('pointercancel', () => { panState = null; els.overlayCanvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair'; });
els.overlayCanvas.addEventListener('dblclick', (event) => { if (tool === 'trace') { event.preventDefault(); if (currentTrace.length > 2) currentTrace.pop(); finishTrace(); } });
els.viewerScroll.addEventListener('wheel', (event) => { if (!event.ctrlKey || !pdfPage) return; event.preventDefault(); zoomFactor = Math.max(0.25, Math.min(6, zoomFactor * (event.deltaY < 0 ? 1.15 : 1 / 1.15))); void renderPage(); }, { passive: false });
els.detectionList.addEventListener('click', (event) => { const target = event.target as HTMLElement; const accept = target.dataset.accept; const reject = target.dataset.reject; if (accept) acceptDetection(accept); if (reject) rejectDetection(reject); });
els.detailList.addEventListener('click', (event) => { const target = (event.target as HTMLElement).closest<HTMLElement>('[data-route],[data-part]'); if (!target) return; if (target.dataset.route) selectRoute(project.routes.find((route) => route.id === target.dataset.route) ?? null); if (target.dataset.part) { const part = project.parts.find((item) => item.id === target.dataset.part); if (part) selectPart(part); } });
document.addEventListener('keydown', (event) => {
  const inputActive = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); persist(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
  if (inputActive) return;
  if (event.key === 'Enter' && tool === 'trace') { event.preventDefault(); finishTrace(); }
  else if (event.key === 'Escape' && tool === 'trace') { cancelTrace(); setTool('pan'); }
  else if (event.key === 'Escape' && tool === 'calibrate') { calibrationPoints = []; setTool('pan'); toast('Calibration cancelled'); }
  else if (event.key === 'Backspace' && tool === 'trace') { event.preventDefault(); currentTrace.pop(); renderUi(); }
  else if (event.key === 'Delete' && (selectedRouteId || selectedPartId)) { event.preventDefault(); deleteSelection(); }
});
window.addEventListener('resize', () => { if (pdfPage && Math.abs(zoomFactor - 1) < 0.01) void fitAndRender(); });

els.projectName.value = project.projectName;
els.scalePreset.value = [20, 50, 100, 200].includes(project.scaleRatio) ? String(project.scaleRatio) : 'custom';
els.customScale.value = String(project.customScaleRatio || project.scaleRatio);
els.customScaleField.classList.toggle('hidden', els.scalePreset.value !== 'custom');
if (loadProject()) els.savedStatus.textContent = `Restored ${new Date(project.updatedAt).toLocaleString()} — reload PDF to view drawing`;
renderDetections(); renderUi();
