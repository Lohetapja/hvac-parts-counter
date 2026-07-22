import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { detectLabelLocations, detectLabels, type PdfTextItem } from './detection';
import { chooseDuctReference, classifyAirflow, extractLineSegments, findArrowCandidates, nearestArrowCandidate, similarArrow, type ArrowCandidate, type DuctReference, type LineSegment } from './airflow';
import { exportDate, makeDetailedCsv, makeSummaryCsv, safeFileBase } from './export';
import { distanceToSegment, PDF_POINT_MM, polylinePdfDistance, presetMmPerPdfPoint, routeLengthM, snapPoint } from './measurements';
import { clearSavedProject, loadProject, saveProject } from './storage';
import { initCustomPartBuilder } from './custom-part-builder';
import { profileForEnd, syncCustomPartAssembly } from './custom-part-assembly';
import { downloadCustomPartPdf } from './custom-part-pdf';
import { ensureDuctDefaults, initDuctNetworkUi, type DuctNetworkController } from './duct-network-ui';
import { networkTotals, countNetworkParts, removeNetwork } from './duct-network';
import { scanDrawing } from './duct-scan';
import { scaleRatioFromTitleBlock } from './title-block';
import { takeoffReportBlob } from './takeoff-report';
import type { ScanMetadata } from './duct-network-types';
import type { AirflowClassification, AirflowMarker, CustomPart, DetectionLocation, DetectionSuggestion, PartItem, Point, ProjectData, RouteItem, Tool } from './types';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const SYSTEMS = ['Supply air', 'Extract air', 'Outdoor air', 'Exhaust air', 'Transfer air', 'Other'];
const PART_CATEGORIES = ['Bend 15°', 'Bend 30°', 'Bend 45°', 'Bend 90°', 'Tee', 'Branch', 'Reducer', 'Enlargement', 'End cap', 'Damper', 'Fire damper', 'Silencer', 'Flexible connector', 'Vertical rise', 'Vertical drop', 'Air terminal/device', 'Custom item'];
const DEVICE_CATEGORIES = new Set(['Air terminal/device']);
const MAX_CANVAS_PIXELS = 18_000_000;
// Individual airflow arrows are internal classification evidence only; they are no
// longer a user-facing workflow, so they are not drawn unless debugging.
const SHOW_AIRFLOW_DEBUG = false;

function now(): string { return new Date().toISOString(); }
function uid(prefix: string): string { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function freshProject(): ProjectData {
  const timestamp = now();
  return {
    version: 9, projectName: 'Tomorrow HVAC Takeoff', drawing: null, page: 1, scaleRatio: 50, customScaleRatio: 50,
    calibration: { mode: 'preset', mmPerPdfPoint: presetMmPerPdfPoint(50) }, routes: [], parts: [], customParts: [], personalTemplates: [],
    airflowMarkers: [], temporaryDuctAxes: [], airflowVisibility: { showSupply: true, showExtract: true, showUncertain: true, verifiedOnly: false, showLabels: true, showVectors: true },
    rejectedDetectionIds: [],
    ductNetworks: [], ductSegments: [], ductNodes: [], ductLabels: [], ductPartMappings: [], contractBoundaries: [], customCatalogue: [], disabledCatalogueIds: [],
    ductHighlight: { active: false, scope: 'none', showOnly: false, dimOthers: false, selectedNetworkId: null },
    scan: { ranAt: null, page: null, metadata: null, summary: null, diagnostics: null },
    createdAt: timestamp, updatedAt: timestamp,
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
project.customParts ??= [];
ensureDuctDefaults(project);
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
let labelLocations: DetectionLocation[] = [];
let selectedLabelModel: string | null = null;
let selectedLabelId: string | null = null;
let selectedAirflowIds = new Set<string>();
let focusedAirflowId: string | null = null;
let airflowSelectionScopeTouched = false;
let airflowSelectionCursor = 0;
let airflowDraft: Point[] = [];
let forceManualAirflow = false;
let axisDraft: Point[] = [];
let pageSegments = new Map<number, LineSegment[]>();
let pageArrowCandidates = new Map<number, ArrowCandidate[]>();
let scanCancelled = false;
let panState: { x: number; y: number; left: number; top: number } | null = null;
const activePointers = new Map<number, { x: number; y: number }>();
let pinchState: { startDistance: number; startZoom: number } | null = null;
let undoStack: HistoryEntry[] = [];
let redoStack: HistoryEntry[] = [];
let saveTimer = 0;
let activeWorkspace: 'takeoff' | 'builder' | 'materials' = 'takeoff';
let builderController: ReturnType<typeof initCustomPartBuilder>;
let ductUi: DuctNetworkController;
let scanBusy = false;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');
app.innerHTML = `
<div class="app-shell">
  <header class="topbar">
    <div class="brand"><div class="brand-mark">HV</div><div><h1>HVAC Parts Counter</h1><p>Local assisted PDF takeoff</p></div></div>
    <nav class="workspace-tabs" aria-label="Major workspaces"><button class="active" data-workspace="takeoff">Drawing Takeoff</button><button data-workspace="builder">Custom Part Builder</button><button data-workspace="materials">Material List <span id="materialNavCount">0</span></button></nav>
    <div class="top-actions">
      <input id="pdfInput" class="file-input" type="file" accept="application/pdf,.pdf">
      <button id="uploadBtn" class="btn primary">Upload PDF</button><button id="saveBtn" class="btn">Save project</button>
      <button id="restoreBtn" class="btn">Restore saved</button><button id="newBtn" class="btn ghost">New project</button><button id="clearBtn" class="btn ghost danger">Clear</button>
    </div>
  </header>
  <main id="takeoffWorkspace" class="workspace major-workspace">
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
      <section class="panel hidden" data-legacy-workflow><div class="panel-header"><h2>Route</h2><span id="activeTool" class="badge">Pan</span></div><div class="panel-body">
        <label class="field"><span class="label">Shape</span><select id="ductShape" class="select"><option value="round">Round</option><option value="rectangular">Rectangular</option></select></label>
        <label class="field"><span class="label">Size</span><input id="ductSize" class="input" value="Ø200" placeholder="Ø200 or 400x300"></label>
        <label class="field"><span class="label">System</span><select id="ductSystem" class="select">${SYSTEMS.map((value) => `<option>${value}</option>`).join('')}</select></label>
        <label class="field"><span class="label">Notes</span><input id="ductNotes" class="input" placeholder="Optional"></label>
        <div class="button-row"><button id="traceBtn" class="btn primary">Trace route</button><button id="finishTraceBtn" class="btn" disabled>Finish</button><button id="undoPointBtn" class="btn ghost" disabled>Undo point</button></div>
        <p class="help">Click centreline points. Shift snaps to 45°/90°. Double-click or Enter finishes; Escape cancels.</p>
        <div id="selectionActions" class="button-row hidden"><button id="updateRouteBtn" class="btn">Update selected</button><button id="deleteRouteBtn" class="btn danger">Delete route</button></div>
      </div></section>
      <section class="panel airflow-panel hidden" data-legacy-workflow><div class="panel-header"><h2>Airflow Points</h2><span id="airflowCount" class="badge muted">0 points</span></div><div class="panel-body">
        <p class="help airflow-rule">Individual arrow markers (Tuloilmavirran / Poistoilmavirran nuolet). Separate from whole duct-system highlighting. Arrows pointing away from the duct are <b>Tulo / Supply</b>; toward the duct are <b>Poisto / Extract</b>.</p>
        <div class="button-row"><button id="markAirflowBtn" class="btn primary">Mark airflow arrow</button><button id="manualAirflowBtn" class="btn">Manual: 2 points</button></div>
        <div class="button-row"><button id="temporaryAxisBtn" class="btn">Select temporary duct axis</button><button id="scanSimilarBtn" class="btn" disabled>Find similar arrows</button><button id="cancelAirflowScanBtn" class="btn ghost hidden">Cancel scan</button></div>
        <label class="field"><span class="label">Scan scope</span><select id="airflowScope" class="select"><option value="visible">Visible area</option><option value="route">Selected duct</option><option value="page">Entire page</option></select></label>
        <div id="airflowInstructions" class="callout hidden"></div>
        <div class="airflow-legend" aria-label="Airflow overlay legend"><span class="supply">T▲ Tulo / Supply</span><span class="extract">P◆ Poisto / Extract</span><span class="uncertain">? Epävarma / Uncertain</span><span class="verified">solid = Vahvistettu / Verified</span></div>
        <div class="toggle-grid"><label><input id="showSupply" type="checkbox" checked> Show Tulo</label><label><input id="showExtract" type="checkbox" checked> Show Poisto</label><label><input id="showUncertain" type="checkbox" checked> Show uncertain</label><label><input id="verifiedOnly" type="checkbox"> Verified only</label><label><input id="showAirflowLabels" type="checkbox" checked> Show labels</label><label><input id="showAirflowVectors" type="checkbox" checked> Show vectors</label></div>
        <label class="field"><span class="label">Bulk-selection scope</span><select id="airflowSelectionScope" class="select"><option value="page">Current page</option><option value="route">Selected duct</option><option value="visible">Visible area</option><option value="project">Entire project</option></select></label>
        <div id="airflowSelectionScopeStatus" class="item-meta">Scope: Current page</div>
        <div class="button-row"><button id="selectSupplyBtn" class="btn small">Select Tulo arrows</button><button id="selectExtractBtn" class="btn small">Select Poisto arrows</button></div>
        <div class="button-row"><button id="selectUncertainAirflowBtn" class="btn small">Select uncertain arrows</button><button id="clearAirflowSelectionBtn" class="btn small ghost" disabled>Clear airflow-marker selection</button></div>
        <div id="airflowSelectionStatus" class="selection-feedback" aria-live="polite">No airflow markers selected.</div>
        <div class="button-row"><button id="showSelectedAirflowBtn" class="btn small ghost hidden">Show selected markers</button><button id="clearAirflowBtn" class="btn small ghost danger">Clear airflow scan</button></div>
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
      <div class="viewer-toolbar"><button class="tool active" data-tool="pan">Select / Pan</button><button class="tool" data-tool="calibrate">Scale</button><button class="tool" data-tool="network-seed">Duct system</button><button class="tool" data-tool="label">Pick label</button><i></i><button id="zoomOutBtn" class="tool">−</button><span id="zoomReadout" class="zoom-readout">Fit</span><button id="zoomInBtn" class="tool">+</button><button id="fitBtn" class="tool">Fit</button><i></i><button id="undoBtn" class="tool" disabled>Undo</button><button id="redoBtn" class="tool" disabled>Redo</button><div id="progress" class="progress"><span></span></div></div>
      <div id="viewerScroll" class="viewer-scroll"><div id="canvasStage" class="canvas-stage empty"><div id="emptyState" class="empty-state"><h2>Upload an HVAC PDF drawing</h2><p>The drawing stays in this browser. Saved takeoff data can be restored without storing the PDF.</p><button id="emptyUploadBtn" class="btn primary">Choose PDF</button></div><canvas id="pdfCanvas"></canvas><canvas id="overlayCanvas"></canvas></div></div>
      <div class="statusbar"><span id="statusText">Ready. Upload a PDF to begin.</span><span><strong>Private:</strong> no uploads, APIs, or tracking</span></div>
    </section>
    <aside class="sidebar right">
      <section class="panel summary-panel"><div class="panel-header"><h2>Live takeoff</h2><div><button id="exportSummaryBtn" class="btn small">Summary CSV</button><button id="exportDetailBtn" class="btn small">Details CSV</button><button id="exportJsonBtn" class="btn small">JSON</button></div></div><div class="panel-body">
        <div class="headline-grid"><div><b id="totalDuct">0.00 m</b><span>Duct</span></div><div><b id="totalRoutes">0</b><span>Routes</span></div><div><b id="totalFittings">0</b><span>Fittings</span></div><div><b id="totalDevices">0</b><span>Devices</span></div><div><b id="unverifiedCount">0</b><span>Unverified</span></div></div>
        <h3>Duct groups</h3><div id="ductSummary" class="item-list"></div><h3>Parts & devices</h3><div id="partSummary" class="item-list"></div>
      </div></section>
      <section class="panel"><div class="panel-header"><h2>Detailed items</h2></div><div class="panel-body"><div id="detailList" class="item-list"></div></div></section>
      <section class="panel airflow-review-panel hidden" data-legacy-workflow><div class="panel-header"><h2>Airflow review</h2><span id="airflowReviewCount" class="badge">0 shown</span></div><div class="panel-body">
        <div id="airflowTotals" class="airflow-totals" aria-live="polite"></div>
        <div class="inline"><label class="field"><span class="label">Filter</span><select id="airflowFilter" class="select"><option value="all">All</option><option value="supply">Tulo</option><option value="extract">Poisto</option><option value="uncertain">Uncertain</option><option value="suggested">Suggested</option><option value="verified">Verified</option></select></label><label class="field"><span class="label">Sort</span><select id="airflowSort" class="select"><option value="position">Page position</option><option value="classification">Classification</option><option value="confidence">Confidence</option><option value="duct">Related duct</option></select></label></div>
        <div class="button-row"><button id="verifyAirflowBtn" class="btn small" disabled>Verify selected</button><button id="flipAirflowBtn" class="btn small" disabled>Flip selected</button><button id="rejectAirflowBtn" class="btn small" disabled>Reject selected</button><button id="deleteAirflowBtn" class="btn small danger" disabled>Delete selected</button></div>
        <div class="button-row"><button id="setSupplyBtn" class="btn small" disabled>Mark Tulo</button><button id="setExtractBtn" class="btn small" disabled>Mark Poisto</button><button id="setUncertainBtn" class="btn small" disabled>Mark uncertain</button></div>
        <div class="button-row"><button id="fitSelectedAirflowBtn" class="btn small" disabled>Fit selected</button><button id="previousSelectedAirflowBtn" class="btn small" disabled>Previous</button><button id="nextSelectedAirflowBtn" class="btn small" disabled>Next</button><button id="clearReviewSelectionBtn" class="btn small ghost" disabled>Clear selection</button></div>
        <label class="field"><span class="label">Related duct / temporary axis</span><select id="airflowRoute" class="select"><option value="">Keep automatic association</option></select></label>
        <label class="field"><span class="label">Related model for selected</span><input id="airflowModel" class="input" placeholder="e.g. KTS-125-0-C-125"></label>
        <label class="field"><span class="label">Notes for selected</span><input id="airflowNotes" class="input" placeholder="Review notes"></label><div class="button-row"><button id="updateAirflowBtn" class="btn small" disabled>Update selected</button><button id="associateLabelBtn" class="btn small" disabled>Associate picked label</button></div>
        <div id="selectedLabelPanel" class="selected-label-panel"></div><div id="airflowGroups" class="airflow-groups"></div><div id="airflowReviewList" class="item-list"></div>
      </div></section>
      <section class="panel"><div class="panel-header"><h2>Detected labels</h2><button id="scanBtn" class="btn small" disabled>Scan page</button></div><div class="panel-body"><p class="help">Suggestions from PDF text only. Review, edit, accept, or reject.</p><div id="detectionList" class="detection-list"></div></div></section>
    </aside>
  </main>
  <section id="customBuilderWorkspace" class="major-workspace custom-builder-workspace hidden"></section>
  <section id="materialWorkspace" class="major-workspace material-workspace hidden">
    <div class="material-header"><div><span class="eyebrow">Project materials</span><h2>Material List</h2><p>Measured ducts, manual items, detected devices, and parametric custom parts.</p></div><div class="button-row"><button id="materialExportSummary" class="btn">Summary CSV</button><button id="materialExportDetails" class="btn">Details CSV</button><button id="materialExportJson" class="btn">JSON</button></div></div>
    <div id="materialHeadline" class="material-headline"></div>
    <div class="material-columns"><section class="panel"><div class="panel-header"><h2>Ducts and standard parts</h2></div><div id="materialStandardList" class="panel-body material-list"></div></section><section class="panel custom-material-panel"><div class="panel-header"><h2>Custom parametric parts</h2><button id="materialNewCustom" class="btn small primary">New custom part</button></div><div id="materialCustomList" class="panel-body material-list"></div></section></div>
  </section>
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
  takeoffWorkspace: byId<HTMLElement>('takeoffWorkspace'), customBuilderWorkspace: byId<HTMLElement>('customBuilderWorkspace'), materialWorkspace: byId<HTMLElement>('materialWorkspace'), materialNavCount: byId<HTMLElement>('materialNavCount'), materialHeadline: byId<HTMLDivElement>('materialHeadline'), materialStandardList: byId<HTMLDivElement>('materialStandardList'), materialCustomList: byId<HTMLDivElement>('materialCustomList'), materialNewCustom: byId<HTMLButtonElement>('materialNewCustom'), materialExportSummary: byId<HTMLButtonElement>('materialExportSummary'), materialExportDetails: byId<HTMLButtonElement>('materialExportDetails'), materialExportJson: byId<HTMLButtonElement>('materialExportJson'),
  airflowCount: byId<HTMLElement>('airflowCount'), markAirflowBtn: byId<HTMLButtonElement>('markAirflowBtn'), manualAirflowBtn: byId<HTMLButtonElement>('manualAirflowBtn'), temporaryAxisBtn: byId<HTMLButtonElement>('temporaryAxisBtn'), scanSimilarBtn: byId<HTMLButtonElement>('scanSimilarBtn'), cancelAirflowScanBtn: byId<HTMLButtonElement>('cancelAirflowScanBtn'), airflowScope: byId<HTMLSelectElement>('airflowScope'), airflowSelectionScope: byId<HTMLSelectElement>('airflowSelectionScope'), airflowSelectionScopeStatus: byId<HTMLElement>('airflowSelectionScopeStatus'), airflowSelectionStatus: byId<HTMLElement>('airflowSelectionStatus'), airflowInstructions: byId<HTMLDivElement>('airflowInstructions'), showSupply: byId<HTMLInputElement>('showSupply'), showExtract: byId<HTMLInputElement>('showExtract'), showUncertain: byId<HTMLInputElement>('showUncertain'), verifiedOnly: byId<HTMLInputElement>('verifiedOnly'), showAirflowLabels: byId<HTMLInputElement>('showAirflowLabels'), showAirflowVectors: byId<HTMLInputElement>('showAirflowVectors'), selectSupplyBtn: byId<HTMLButtonElement>('selectSupplyBtn'), selectExtractBtn: byId<HTMLButtonElement>('selectExtractBtn'), selectUncertainAirflowBtn: byId<HTMLButtonElement>('selectUncertainAirflowBtn'), clearAirflowSelectionBtn: byId<HTMLButtonElement>('clearAirflowSelectionBtn'), showSelectedAirflowBtn: byId<HTMLButtonElement>('showSelectedAirflowBtn'), clearAirflowBtn: byId<HTMLButtonElement>('clearAirflowBtn'),
  airflowReviewCount: byId<HTMLElement>('airflowReviewCount'), airflowTotals: byId<HTMLDivElement>('airflowTotals'), airflowFilter: byId<HTMLSelectElement>('airflowFilter'), airflowSort: byId<HTMLSelectElement>('airflowSort'), verifyAirflowBtn: byId<HTMLButtonElement>('verifyAirflowBtn'), flipAirflowBtn: byId<HTMLButtonElement>('flipAirflowBtn'), rejectAirflowBtn: byId<HTMLButtonElement>('rejectAirflowBtn'), deleteAirflowBtn: byId<HTMLButtonElement>('deleteAirflowBtn'), setSupplyBtn: byId<HTMLButtonElement>('setSupplyBtn'), setExtractBtn: byId<HTMLButtonElement>('setExtractBtn'), setUncertainBtn: byId<HTMLButtonElement>('setUncertainBtn'), fitSelectedAirflowBtn: byId<HTMLButtonElement>('fitSelectedAirflowBtn'), previousSelectedAirflowBtn: byId<HTMLButtonElement>('previousSelectedAirflowBtn'), nextSelectedAirflowBtn: byId<HTMLButtonElement>('nextSelectedAirflowBtn'), clearReviewSelectionBtn: byId<HTMLButtonElement>('clearReviewSelectionBtn'), airflowRoute: byId<HTMLSelectElement>('airflowRoute'), airflowModel: byId<HTMLInputElement>('airflowModel'), airflowNotes: byId<HTMLInputElement>('airflowNotes'), updateAirflowBtn: byId<HTMLButtonElement>('updateAirflowBtn'), associateLabelBtn: byId<HTMLButtonElement>('associateLabelBtn'), selectedLabelPanel: byId<HTMLDivElement>('selectedLabelPanel'), airflowGroups: byId<HTMLDivElement>('airflowGroups'), airflowReviewList: byId<HTMLDivElement>('airflowReviewList'),
};

function toast(message: string): void { els.toast.textContent = message; els.toast.classList.add('show'); window.setTimeout(() => els.toast.classList.remove('show'), 2200); }
function status(message: string): void { els.statusText.textContent = message; }
function loading(active: boolean): void { els.progress.classList.toggle('active', active); }

function switchWorkspace(workspace: 'takeoff' | 'builder' | 'materials'): void {
  activeWorkspace = workspace;
  els.takeoffWorkspace.classList.toggle('hidden', workspace !== 'takeoff');
  els.customBuilderWorkspace.classList.toggle('hidden', workspace !== 'builder');
  els.materialWorkspace.classList.toggle('hidden', workspace !== 'materials');
  document.querySelectorAll<HTMLButtonElement>('[data-workspace]').forEach((button) => button.classList.toggle('active', button.dataset.workspace === workspace));
  builderController.setActive(workspace === 'builder');
  if (workspace === 'materials') renderMaterialWorkspace();
}

function saveCustomPart(part: CustomPart): void {
  part = syncCustomPartAssembly(part);
  const existingIndex = project.customParts.findIndex((item) => item.id === part.id);
  if (existingIndex >= 0) {
    part.createdAt = project.customParts[existingIndex].createdAt;
    part.updatedAt = now(); project.customParts[existingIndex] = part; toast('Custom part updated');
  } else {
    part.createdAt = now(); part.updatedAt = part.createdAt; project.customParts.push(part); toast('Custom part saved to material list');
  }
  markChanged(); switchWorkspace('materials');
}
function updateCustomPartDraft(part: CustomPart): void {
  const index = project.customParts.findIndex((item) => item.id === part.id); if (index < 0) return;
  part.createdAt = project.customParts[index].createdAt; part.updatedAt = now(); project.customParts[index] = syncCustomPartAssembly(part); markChanged();
}

function editCustomPart(id: string): void {
  const part = project.customParts.find((item) => item.id === id); if (!part) return;
  builderController.load(part); switchWorkspace('builder');
}

function duplicateCustomPart(id: string): void {
  const source = project.customParts.find((item) => item.id === id); if (!source) return;
  const time = now(); const duplicate = structuredClone(source); duplicate.id = uid('custom'); duplicate.name = `${source.name} copy`; duplicate.createdAt = time; duplicate.updatedAt = time;
  builderController.load(syncCustomPartAssembly(duplicate), false); switchWorkspace('builder'); toast('Duplicate loaded; save it to create a new record');
}

function deleteCustomPart(id: string): void {
  const part = project.customParts.find((item) => item.id === id); if (!part) return;
  if (!window.confirm(`Delete custom part “${part.name}”?`)) return;
  project.customParts = project.customParts.filter((item) => item.id !== id); markChanged(); toast('Custom part deleted');
}

function renderMaterialWorkspace(): void {
  const measuredLength = project.routes.reduce((sum, route) => sum + routeLengthM(route, project), 0)
    + project.ductNetworks.reduce((sum, network) => sum + networkTotals(project, network).lengthM, 0);
  const standardQuantity = project.parts.reduce((sum, part) => sum + part.quantity, 0);
  const customQuantity = project.customParts.reduce((sum, part) => sum + part.quantity, 0);
  els.materialNavCount.textContent = String(project.routes.length + standardQuantity + customQuantity);
  els.materialHeadline.innerHTML = `<div><b>${measuredLength.toFixed(2)} m</b><span>Measured duct</span></div><div><b>${project.routes.length}</b><span>Duct routes</span></div><div><b>${standardQuantity}</b><span>Standard items</span></div><div><b>${customQuantity}</b><span>Custom fittings</span></div>`;
  const routes = project.routes.map((route) => `<div class="material-card"><div><b>${escapeHtml(route.size)} duct</b><span>${escapeHtml(route.shape)} · ${escapeHtml(route.system)} · ${routeLengthM(route, project).toFixed(2)} m</span></div><strong>1×</strong></div>`);
  const parts = project.parts.map((part) => `<div class="material-card"><div><b>${escapeHtml(part.category)}${part.model ? ` · ${escapeHtml(part.model)}` : ''}</b><span>${escapeHtml(part.size || 'No size')} · ${escapeHtml(part.system)} · ${part.source}/${part.status}</span></div><strong>${part.quantity}×</strong></div>`);
  const ductSection = renderDuctMaterialGroups();
  const standardBody = [...routes, ...parts].join('');
  els.materialStandardList.innerHTML = (ductSection || standardBody) ? `${ductSection}${standardBody || (ductSection ? '' : '<div class="empty-mini">No measured ducts, standard parts, or airflow points yet.</div>')}` : '<div class="empty-mini">No measured ducts, standard parts, or airflow points yet.</div>';
  els.materialCustomList.innerHTML = project.customParts.length ? project.customParts.map((part) => { const a = profileForEnd(part, 'a') === 'round' ? `Ø${part.endADiameterMm}` : `${part.endAWidthMm}×${part.endAHeightMm}`; const b = profileForEnd(part, 'b') === 'round' ? `Ø${part.endBDiameterMm}` : `${part.endBWidthMm}×${part.endBHeightMm}`; return `<article class="custom-material-card"><div class="custom-material-main"><span class="badge ${part.verificationStatus === 'suggested' ? 'warning' : ''}">${escapeHtml(part.verificationStatus)}</span><h3>${escapeHtml(part.name)}</h3><p>P1 ${a} → P2 ${b} mm · L${part.lengthMm} · X${part.horizontalOffsetMm > 0 ? '+' : ''}${part.horizontalOffsetMm} · Y${part.verticalOffsetMm > 0 ? '+' : ''}${part.verticalOffsetMm} · H${part.outletHorizontalAngleDeg}° / V${part.outletVerticalAngleDeg}°</p><small>${escapeHtml(part.partType)} · ${escapeHtml(part.system)} · ${escapeHtml(part.material)} · ${part.thicknessMm} mm · source: custom-builder</small></div><strong class="material-qty">${part.quantity}×</strong><div class="custom-material-actions"><button class="btn small" data-edit-custom="${part.id}">Open / edit</button><button class="btn small" data-pdf-custom="${part.id}">Drawing PDF</button><button class="btn small" data-duplicate-custom="${part.id}">Duplicate</button><button class="btn small ghost danger" data-delete-custom="${part.id}">Delete</button></div></article>`; }).join('') : '<div class="empty-state material-empty"><h2>No custom parts yet</h2><p>Build a rectangular, rectangular-to-round, or round-to-rectangular transition and keep its assembly parameters with this project.</p><button class="btn primary" data-new-custom>Open Custom Part Builder</button></div>';
}
function renderDuctMaterialGroups(): string {
  if (!project.ductNetworks.length) return '';
  const groupOf = (network: ProjectData['ductNetworks'][number]): 'TULO SYSTEMS' | 'POISTO SYSTEMS' | 'OTHER SYSTEMS' =>
    network.systemType === 'supply' ? 'TULO SYSTEMS' : (network.systemType === 'extract' || network.systemType === 'exhaust') ? 'POISTO SYSTEMS' : 'OTHER SYSTEMS';
  const groups: Array<'TULO SYSTEMS' | 'POISTO SYSTEMS' | 'OTHER SYSTEMS'> = ['TULO SYSTEMS', 'POISTO SYSTEMS', 'OTHER SYSTEMS'];
  const sections = groups.map((group) => {
    const networks = project.ductNetworks.filter((network) => groupOf(network) === group);
    if (!networks.length) return '';
    const cards = networks.map((network) => {
      const totals = networkTotals(project, network);
      const rows = countNetworkParts(project, network);
      const items = rows.map((row) => `<li>${escapeHtml(row.label)}${row.lengthM !== undefined ? `: ${row.lengthM.toFixed(1)} m` : ''} <b>${row.quantity}×</b> <span class="duct-mat-status">${escapeHtml(row.status)}</span></li>`).join('');
      return `<div class="material-card duct-material-card"><div><b>${escapeHtml(network.name)}</b><span>${escapeHtml(systemLabelShort(network.systemType))} · ${network.verificationStatus} · ${totals.segments} segments · ${totals.lengthM.toFixed(2)} m</span><ul class="duct-material-parts">${items || '<li class="empty-mini">No parts yet.</li>'}</ul></div></div>`;
    }).join('');
    return `<div class="material-subhead">${group}</div>${cards}`;
  }).join('');
  return sections;
}
function systemLabelShort(type: ProjectData['ductNetworks'][number]['systemType']): string {
  return type === 'supply' ? 'Tulo / Supply' : type === 'extract' ? 'Poisto / Extract' : type === 'exhaust' ? 'Jäte / Exhaust' : type === 'outdoor' ? 'Ulko / Outdoor' : type === 'transfer' ? 'Siirto / Transfer' : type === 'other' ? 'Muu / Other' : 'Unknown';
}
function markChanged(): void {
  project.updatedAt = now();
  window.clearTimeout(saveTimer);
  els.savedStatus.textContent = 'Unsaved changes…';
  saveTimer = window.setTimeout(() => persist(false), 500);
  renderUi();
}
function persist(notify = true): void {
  project.projectName = els.projectName.value.trim() || 'Untitled HVAC Takeoff';
  project.updatedAt = now();
  if (!saveProject(project)) {
    els.savedStatus.textContent = 'Local save failed';
    status('Local save failed. Browser storage may be unavailable or full.');
    if (notify) toast('Could not save project locally');
    return;
  }
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
  if (next !== 'airflow') airflowDraft = [];
  if (next !== 'airflow') forceManualAirflow = false;
  if (next !== 'axis') axisDraft = [];
  tool = next; previewPoint = null;
  ductUi?.handleToolChange(next);
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === next));
  const toolLabels: Record<Tool, string> = { pan: 'Select / Pan', trace: 'Trace duct', calibrate: 'Calibration', airflow: 'Mark airflow', axis: 'Temporary axis', label: 'Pick label', 'network-seed': 'Select duct system', 'network-trace': 'Trace centreline' };
  els.activeTool.textContent = toolLabels[next];
  els.activeTool.classList.toggle('warning', next !== 'pan');
  els.calibrationInstructions.classList.toggle('hidden', next !== 'calibrate');
  els.airflowInstructions.classList.toggle('hidden', next !== 'airflow' && next !== 'axis' && next !== 'label');
  els.airflowInstructions.textContent = next === 'airflow' ? 'Click near a vector arrow. If no safe match is found, that click becomes the tail; click the tip second. Escape cancels.' : next === 'axis' ? 'Click two points along the related duct. This axis is an analysis reference only.' : next === 'label' ? 'Click close to a recognizable HVAC product label to highlight matching labels.' : '';
  els.overlayCanvas.style.cursor = next === 'pan' ? 'grab' : 'crosshair';
  const messages: Record<Tool, string> = { pan: 'Select / Pan mode. Drag the drawing; click a route, airflow marker, or duct network to select it.', trace: 'Trace duct: click centreline points. Shift snaps. Enter or double-click finishes.', calibrate: 'Calibration mode: click two endpoints of the known dimension.', airflow: 'Mark airflow arrow: selected route is preferred. Click near an arrow or mark tail then tip.', axis: 'Temporary duct axis: click two points along the duct.', label: 'Pick label: click close to an HVAC product label.', 'network-seed': 'Select duct system: click a seed segment, label, or terminal branch.', 'network-trace': 'Trace centreline: click points; Enter or double-click finishes; Escape cancels.' };
  status(messages[next]);
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
    if (!keep) { project.routes = []; project.parts = []; project.airflowMarkers = []; project.temporaryDuctAxes = []; project.rejectedDetectionIds = []; undoStack = []; redoStack = []; }
  }
  loading(true); status(`Loading ${file.name} locally…`);
  try {
    renderGeneration += 1;
    renderTask?.cancel();
    if (pdfLoadingTask) { try { await pdfLoadingTask.destroy(); } catch (error) { console.warn('Previous PDF cleanup failed', error); } }
    const buffer = await file.arrayBuffer();
    pdfLoadingTask = pdfjsLib.getDocument({ data: buffer });
    pdfDoc = await pdfLoadingTask.promise;
    pageSegments.clear(); pageArrowCandidates.clear();
    const requestedPage = Math.min(Math.max(1, project.page), pdfDoc.numPages);
    project.drawing = { fileName: file.name, fingerprint, pageCount: pdfDoc.numPages };
    project.page = requestedPage;
    els.pageSelect.replaceChildren(...Array.from({ length: pdfDoc.numPages }, (_, index) => new Option(`Page ${index + 1}`, String(index + 1))));
    els.pageSelect.value = String(requestedPage); els.pageSelect.disabled = pdfDoc.numPages <= 1;
    els.canvasStage.classList.remove('empty'); els.emptyState.hidden = true; els.scanBtn.disabled = false;
    await openPage(requestedPage, true, false);
    markChanged(); toast(`Loaded ${file.name}`); status(`Loaded ${file.name} — ${pdfDoc.numPages} page${pdfDoc.numPages === 1 ? '' : 's'}. Rendering continues in the background; you can scan now.`);
  } catch (error) {
    console.error(error); pdfDoc = null; pdfPage = null; els.scanBtn.disabled = true;
    status('PDF loading failed. The file may be damaged, encrypted, or unsupported.'); toast('Could not load this PDF');
  } finally { loading(false); }
}
// waitForRender=false lets the page become scannable as soon as the PDF page object
// exists. Large-format drawings (4167x2544, ~20k operators) take a long time to
// rasterise, and geometry analysis reads the operator list, not the canvas.
async function openPage(pageNumber: number, fit = false, waitForRender = true): Promise<void> {
  if (!pdfDoc) return;
  pdfPage = await pdfDoc.getPage(pageNumber); project.page = pageNumber;
  const viewport = pdfPage.getViewport({ scale: 1 }); basePageWidth = viewport.width; basePageHeight = viewport.height;
  detections = []; labelLocations = []; selectedLabelModel = null; renderDetections();
  const rendering = fit ? fitAndRender() : renderPage();
  if (waitForRender) await rendering;
  else void rendering.catch((error: unknown) => console.warn('Background page render failed', error));
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
  ductUi?.draw(context, renderScale);
  if (tool === 'network-trace' && previewPoint) {
    const draft = ductUi?.getTraceDraft() ?? [];
    if (draft.length) drawPolyline(context, [draft[draft.length - 1], previewPoint], '#8ee3c2', 3, true);
  }
  project.routes.filter((route) => route.page === project.page).forEach((route) => {
    const selected = route.id === selectedRouteId; const color = selected ? '#ffe08a' : route.system.includes('Extract') || route.system.includes('Exhaust') ? '#ff9d7a' : '#57c7ff';
    drawPolyline(context, route.points, color, selected ? 7 : 4);
    const point = route.points[Math.floor(route.points.length / 2)]; if (!point) return;
    const label = `${route.size} · ${routeLengthM(route, project).toFixed(2)} m`; context.save(); context.font = '600 12px system-ui';
    const width = context.measureText(label).width + 12; context.fillStyle = 'rgba(7,16,25,.9)'; context.fillRect(point.x * renderScale - width / 2, point.y * renderScale - 25, width, 19); context.fillStyle = selected ? '#ffe08a' : '#eef7ff'; context.fillText(label, point.x * renderScale - width / 2 + 6, point.y * renderScale - 11); context.restore();
  });
  project.temporaryDuctAxes.filter((axis) => axis.pageNumber === project.page).forEach((axis) => drawPolyline(context, [axis.start, axis.end], '#b88cff', 3, true));
  if (selectedLabelModel) labelLocations.filter((location) => location.model === selectedLabelModel).forEach((location) => { context.save(); context.strokeStyle = location.id === selectedLabelId ? '#ffe08a' : '#9ef0c9'; context.lineWidth = location.id === selectedLabelId ? 4 : 2; context.setLineDash([6, 4]); context.strokeRect(location.x * renderScale - 4, location.y * renderScale - 4, Math.max(12, location.width * renderScale + 8), Math.max(12, location.height * renderScale + 8)); context.restore(); });
  if (SHOW_AIRFLOW_DEBUG) project.airflowMarkers.filter(visibleAirflow).forEach((marker) => {
    const selected = selectedAirflowIds.has(marker.id); const color = marker.classification === 'supply' ? '#52d6ff' : marker.classification === 'extract' ? '#ff9b6b' : '#ffd66b';
    const tail = { x: marker.tail.x * renderScale, y: marker.tail.y * renderScale }; const tip = { x: marker.tip.x * renderScale, y: marker.tip.y * renderScale }; const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
    if (selected) { context.save(); context.beginPath(); context.arc(tip.x, tip.y, marker.id === focusedAirflowId ? 17 : 14, 0, Math.PI * 2); context.strokeStyle = marker.id === focusedAirflowId ? '#ffffff' : '#ff66da'; context.lineWidth = marker.id === focusedAirflowId ? 4 : 3; context.setLineDash([4, 3]); context.stroke(); context.restore(); }
    context.save(); context.strokeStyle = selected ? '#ff66da' : color; context.fillStyle = selected ? '#ff66da' : color; context.lineWidth = selected ? 5 : marker.verificationStatus === 'verified' ? 3.5 : 2.5; context.setLineDash(marker.verificationStatus === 'verified' ? [] : [7, 5]);
    if (project.airflowVisibility.showVectors) { context.beginPath(); context.moveTo(tail.x, tail.y); context.lineTo(tip.x, tip.y); context.stroke(); context.beginPath(); context.moveTo(tip.x, tip.y); context.lineTo(tip.x - Math.cos(angle - .55) * 12, tip.y - Math.sin(angle - .55) * 12); context.moveTo(tip.x, tip.y); context.lineTo(tip.x - Math.cos(angle + .55) * 12, tip.y - Math.sin(angle + .55) * 12); context.stroke(); }
    context.setLineDash([]); context.beginPath();
    if (marker.classification === 'supply') { context.moveTo(tip.x, tip.y - 7); context.lineTo(tip.x + 7, tip.y + 7); context.lineTo(tip.x - 7, tip.y + 7); context.closePath(); }
    else if (marker.classification === 'extract') { context.moveTo(tip.x, tip.y - 7); context.lineTo(tip.x + 7, tip.y); context.lineTo(tip.x, tip.y + 7); context.lineTo(tip.x - 7, tip.y); context.closePath(); }
    else context.arc(tip.x, tip.y, 7, 0, Math.PI * 2);
    marker.verificationStatus === 'verified' ? context.fill() : context.stroke();
    if (project.airflowVisibility.showLabels) { const label = marker.classification === 'supply' ? 'T' : marker.classification === 'extract' ? 'P' : '?'; context.font = '700 12px system-ui'; context.fillStyle = '#081018'; context.fillRect(tip.x + 9, tip.y - 15, 18, 17); context.fillStyle = color; context.fillText(label, tip.x + 14, tip.y - 2); }
    context.restore();
  });
  const live = previewPoint && currentTrace.length ? [...currentTrace, previewPoint] : currentTrace;
  if (live.length) drawPolyline(context, live, '#8ee3c2', 4, true);
  if (calibrationPoints.length) drawPolyline(context, calibrationPoints, '#f9c66f', 4, true);
  if (airflowDraft.length) drawPolyline(context, previewPoint ? [airflowDraft[0], previewPoint] : airflowDraft, '#ff66da', 3, true);
  if (axisDraft.length) drawPolyline(context, previewPoint ? [axisDraft[0], previewPoint] : axisDraft, '#b88cff', 3, true);
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
  if (!airflowSelectionScopeTouched) els.airflowSelectionScope.value = route ? 'route' : 'page';
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

function airflowLabel(classification: AirflowClassification): string {
  return classification === 'supply' ? 'Tulo / Supply' : classification === 'extract' ? 'Poisto / Extract' : 'Epävarma / Uncertain';
}

function addAirflowMarker(tail: Point, tip: Point, source: AirflowMarker['source'], detectionConfidence = 1, updateUi = true): AirflowMarker | null {
  const reference = chooseDuctReference(tip, project.page, selectedRouteId, project.routes, project.temporaryDuctAxes);
  if (!reference) { toast('Select or trace the related duct before classifying airflow.'); status('Select or trace the related duct before classifying airflow. You can also select a temporary duct axis.'); return null; }
  if (Math.hypot(tip.x - tail.x, tip.y - tail.y) < 3) { toast('Arrow is too short. Mark a clearer tail-to-tip vector.'); return null; }
  const timestamp = now(); const diagnostic = classifyAirflow(tail, tip, reference);
  const marker: AirflowMarker = {
    id: uid('airflow'), pageNumber: project.page, tail, tip, nearestRouteId: reference.routeId, temporaryAxisId: reference.axisId,
    ...diagnostic, confidence: Math.min(diagnostic.confidence, detectionConfidence), verificationStatus: 'suggested', source,
    system: reference.system, notes: '', createdAt: timestamp, updatedAt: timestamp,
  };
  project.airflowMarkers.push(marker);
  if (updateUi) { selectedAirflowIds = new Set([marker.id]); markChanged(); toast(`${airflowLabel(marker.classification)} suggestion added`); }
  return marker;
}

async function ensurePageGeometry(): Promise<ArrowCandidate[]> {
  if (!pdfPage) return [];
  const cached = pageArrowCandidates.get(project.page); if (cached) return cached;
  loading(true); status('Reading local PDF line geometry once for airflow assistance…');
  try {
    const operatorList = await pdfPage.getOperatorList(); const viewport = pdfPage.getViewport({ scale: 1 });
    const segments = extractLineSegments({ fnArray: [...operatorList.fnArray], argsArray: operatorList.argsArray as unknown[] }, [...viewport.transform]);
    const candidates = findArrowCandidates(segments); pageSegments.set(project.page, segments); pageArrowCandidates.set(project.page, candidates);
    status(`Cached ${segments.length} short line segments and ${candidates.length} conservative arrow candidates on page ${project.page}.`); return candidates;
  } catch (error) {
    console.warn('Airflow vector parsing was unavailable; manual marking remains active.', error); status('Automatic vector picking was unavailable. Use the two-point airflow marker.'); return [];
  } finally { loading(false); }
}

async function handleAirflowClick(point: Point): Promise<void> {
  if (!pdfPage) { toast('Upload a PDF first'); return; }
  if (!chooseDuctReference(point, project.page, selectedRouteId, project.routes, project.temporaryDuctAxes)) { toast('Select or trace the related duct before classifying airflow.'); return; }
  if (!airflowDraft.length) {
    if (!forceManualAirflow) {
      const candidate = nearestArrowCandidate(await ensurePageGeometry(), point, 28);
      if (candidate) { addAirflowMarker(candidate.tail, candidate.tip, 'vector-detected', candidate.confidence); setTool('pan'); return; }
    }
    airflowDraft = [point];
    status(forceManualAirflow ? 'Manual airflow: tail set; click the arrow tip.' : 'No safe vector match found. Manual fallback active: tail set; click the arrow tip.');
    drawOverlay();
    return;
  }
  addAirflowMarker(airflowDraft[0], point, 'manual-two-point'); airflowDraft = []; setTool('pan');
}

function handleAxisClick(point: Point): void {
  axisDraft.push(point); if (axisDraft.length < 2) { status('Temporary duct axis: click the second point along the duct.'); drawOverlay(); return; }
  if (polylinePdfDistance(axisDraft) < 8) { axisDraft = []; toast('Temporary axis is too short'); drawOverlay(); return; }
  project.temporaryDuctAxes.push({ id: uid('axis'), pageNumber: project.page, start: axisDraft[0], end: axisDraft[1], createdAt: now() }); axisDraft = []; markChanged(); setTool('airflow'); toast('Temporary duct axis added');
}

function visibleAirflow(marker: AirflowMarker): boolean {
  const visibility = project.airflowVisibility;
  return marker.pageNumber === project.page && marker.verificationStatus !== 'rejected' && (!visibility.verifiedOnly || marker.verificationStatus === 'verified')
    && (marker.classification === 'supply' ? visibility.showSupply : marker.classification === 'extract' ? visibility.showExtract : visibility.showUncertain);
}

type AirflowSelectionScope = 'page' | 'route' | 'visible' | 'project';

function airflowScopeLabel(scope = els.airflowSelectionScope.value as AirflowSelectionScope): string {
  return scope === 'route' ? 'Selected duct' : scope === 'visible' ? 'Visible area' : scope === 'project' ? 'Entire project' : 'Current page';
}

function visiblePdfBounds(): { left: number; top: number; right: number; bottom: number } | null {
  if (!pdfPage || !renderScale) return null;
  const viewer = els.viewerScroll.getBoundingClientRect(); const canvas = els.overlayCanvas.getBoundingClientRect();
  return {
    left: Math.max(0, viewer.left - canvas.left) / renderScale,
    top: Math.max(0, viewer.top - canvas.top) / renderScale,
    right: Math.min(canvas.width, viewer.right - canvas.left) / renderScale,
    bottom: Math.min(canvas.height, viewer.bottom - canvas.top) / renderScale,
  };
}

function markerInSelectionScope(marker: AirflowMarker): boolean {
  const scope = els.airflowSelectionScope.value as AirflowSelectionScope;
  if (marker.verificationStatus === 'rejected') return false;
  if (scope === 'project') return true;
  if (marker.pageNumber !== project.page) return false;
  if (scope === 'route') return Boolean(selectedRouteId && marker.nearestRouteId === selectedRouteId);
  if (scope === 'visible') {
    const bounds = visiblePdfBounds();
    return Boolean(bounds && marker.tip.x >= bounds.left && marker.tip.x <= bounds.right && marker.tip.y >= bounds.top && marker.tip.y <= bounds.bottom);
  }
  return true;
}

function clearAirflowSelection(notify = true): void {
  selectedAirflowIds.clear(); focusedAirflowId = null; airflowSelectionCursor = 0; renderUi();
  if (notify) status('Airflow selection cleared.');
}

function selectAirflowClassification(classification: 'supply' | 'extract' | 'uncertain'): void {
  const matches = project.airflowMarkers.filter((marker) => marker.classification === classification && markerInSelectionScope(marker));
  selectedAirflowIds = new Set(matches.map((marker) => marker.id)); focusedAirflowId = matches[0]?.id ?? null; airflowSelectionCursor = 0;
  const name = classification === 'supply' ? 'Tulo' : classification === 'extract' ? 'Poisto' : 'uncertain'; const scope = airflowScopeLabel();
  if (!matches.length) {
    const reason = els.airflowSelectionScope.value === 'route' && !selectedRouteId ? ' Select a duct route or change scope.' : '';
    status(`No ${name} markers found in ${scope.toLowerCase()}.${reason}`); toast(`No ${name} markers in ${scope.toLowerCase()}`);
  } else {
    const hidden = matches.filter((marker) => !visibleAirflow(marker)).length;
    status(`${matches.length} ${name} marker${matches.length === 1 ? '' : 's'} selected (${scope}).${hidden ? ` ${hidden} hidden by page or visibility filters.` : ''}`);
    toast(`${matches.length} ${name} marker${matches.length === 1 ? '' : 's'} selected`);
  }
  renderUi();
}

function showSelectedAirflow(): void {
  const selected = project.airflowMarkers.filter((marker) => selectedAirflowIds.has(marker.id) && marker.pageNumber === project.page && marker.verificationStatus !== 'rejected');
  if (!selected.length) { status('Selected airflow markers are on another page or no longer active.'); return; }
  if (selected.some((marker) => marker.classification === 'supply')) project.airflowVisibility.showSupply = true;
  if (selected.some((marker) => marker.classification === 'extract')) project.airflowVisibility.showExtract = true;
  if (selected.some((marker) => marker.classification === 'uncertain')) project.airflowVisibility.showUncertain = true;
  project.airflowVisibility.verifiedOnly = false; markChanged(); status('Selected marker visibility filters were enabled.');
}

async function fitAirflowMarkers(markers: AirflowMarker[]): Promise<void> {
  const pageMarkers = markers.filter((marker) => marker.pageNumber === project.page && marker.verificationStatus !== 'rejected');
  if (!pdfPage || !pageMarkers.length) { status('No selected airflow markers are available on the current PDF page.'); return; }
  const points = pageMarkers.flatMap((marker) => [marker.tail, marker.tip]);
  const left = Math.min(...points.map((point) => point.x)); const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y)); const bottom = Math.max(...points.map((point) => point.y));
  const width = Math.max(40, right - left); const height = Math.max(40, bottom - top);
  const desiredScale = Math.min((els.viewerScroll.clientWidth - 100) / width, (els.viewerScroll.clientHeight - 100) / height);
  zoomFactor = Math.max(.25, Math.min(6, desiredScale / Math.max(.001, fitScale))); await renderPage();
  els.viewerScroll.scrollLeft = Math.max(0, els.canvasStage.offsetLeft + ((left + right) / 2) * renderScale - els.viewerScroll.clientWidth / 2);
  els.viewerScroll.scrollTop = Math.max(0, els.canvasStage.offsetTop + ((top + bottom) / 2) * renderScale - els.viewerScroll.clientHeight / 2);
  drawOverlay();
}

function cycleSelectedAirflow(direction: 1 | -1): void {
  const selected = project.airflowMarkers.filter((marker) => selectedAirflowIds.has(marker.id)).sort((a, b) => a.pageNumber - b.pageNumber || a.tip.y - b.tip.y || a.tip.x - b.tip.x);
  if (!selected.length) return;
  airflowSelectionCursor = (airflowSelectionCursor + direction + selected.length) % selected.length; const marker = selected[airflowSelectionCursor]; focusedAirflowId = marker.id;
  const focus = async (): Promise<void> => { await fitAirflowMarkers([marker]); status(`Focused selected marker ${airflowSelectionCursor + 1} of ${selected.length}: ${airflowLabel(marker.classification)}.`); renderUi(); };
  if (marker.pageNumber !== project.page && pdfDoc) void openPage(marker.pageNumber, true).then(focus).catch((error: unknown) => { console.error(error); toast('Could not open the selected marker page'); }); else void focus();
}

function hitAirflow(point: Point): AirflowMarker | null {
  const threshold = 12 / renderScale;
  return [...project.airflowMarkers].reverse().find((marker) => visibleAirflow(marker) && (Math.hypot(point.x - marker.tip.x, point.y - marker.tip.y) <= threshold || distanceToSegment(point, marker.tail, marker.tip) <= threshold)) ?? null;
}

function recalculateMarker(marker: AirflowMarker): void {
  const reference = chooseDuctReference(marker.tip, marker.pageNumber, marker.nearestRouteId ?? selectedRouteId, project.routes, project.temporaryDuctAxes); if (!reference) return;
  Object.assign(marker, classifyAirflow(marker.tail, marker.tip, reference), { nearestRouteId: reference.routeId, temporaryAxisId: reference.axisId, system: reference.system, updatedAt: now() });
}

function mutateSelectedAirflow(action: 'verify' | 'reject' | 'delete' | 'flip' | AirflowClassification): void {
  if (!selectedAirflowIds.size) return;
  if (action === 'delete') project.airflowMarkers = project.airflowMarkers.filter((marker) => !selectedAirflowIds.has(marker.id));
  else project.airflowMarkers.forEach((marker) => {
    if (!selectedAirflowIds.has(marker.id)) return;
    if (action === 'verify') marker.verificationStatus = 'verified';
    else if (action === 'reject') marker.verificationStatus = 'rejected';
    else if (action === 'flip') { [marker.tail, marker.tip] = [marker.tip, marker.tail]; recalculateMarker(marker); }
    else marker.classification = action;
    marker.updatedAt = now();
  });
  if (action === 'delete' || action === 'reject') selectedAirflowIds.clear(); markChanged();
}

function updateSelectedAirflowMetadata(): void {
  const relation = els.airflowRoute.value;
  project.airflowMarkers.forEach((marker) => {
    if (!selectedAirflowIds.has(marker.id)) return;
    marker.deviceModel = els.airflowModel.value.trim() || undefined; marker.notes = els.airflowNotes.value.trim();
    if (relation) {
      const route = project.routes.find((item) => item.id === relation);
      const axis = project.temporaryDuctAxes.find((item) => item.id === relation);
      const reference: DuctReference | null = route ? { routeId: route.id, system: route.system, points: route.points } : axis ? { axisId: axis.id, points: [axis.start, axis.end] } : null;
      if (reference) Object.assign(marker, classifyAirflow(marker.tail, marker.tip, reference), { nearestRouteId: reference.routeId, temporaryAxisId: reference.axisId, system: reference.system });
    }
    marker.updatedAt = now();
  });
  markChanged(); toast('Airflow marker details updated');
}

function scanBounds(): { left: number; top: number; right: number; bottom: number } | undefined {
  if (els.airflowScope.value === 'visible') {
    const viewer = els.viewerScroll.getBoundingClientRect(); const canvas = els.overlayCanvas.getBoundingClientRect();
    return { left: Math.max(0, viewer.left - canvas.left) / renderScale, top: Math.max(0, viewer.top - canvas.top) / renderScale, right: Math.min(canvas.width, viewer.right - canvas.left) / renderScale, bottom: Math.min(canvas.height, viewer.bottom - canvas.top) / renderScale };
  }
  if (els.airflowScope.value === 'route') {
    const route = project.routes.find((item) => item.id === selectedRouteId); if (!route) return undefined;
    return { left: Math.min(...route.points.map((point) => point.x)) - 70, top: Math.min(...route.points.map((point) => point.y)) - 70, right: Math.max(...route.points.map((point) => point.x)) + 70, bottom: Math.max(...route.points.map((point) => point.y)) + 70 };
  }
  return undefined;
}

async function scanSimilarArrows(): Promise<void> {
  const exampleMarker = project.airflowMarkers.find((marker) => selectedAirflowIds.has(marker.id) && marker.verificationStatus === 'verified');
  if (!exampleMarker) { toast('Verify one airflow marker before using it as the scan example'); return; }
  if (els.airflowScope.value === 'route' && !project.routes.some((route) => route.id === selectedRouteId)) { toast('Select a duct route before using selected-duct scope'); return; }
  const allCandidates = await ensurePageGeometry(); const example = nearestArrowCandidate(allCandidates, exampleMarker.tip, 20) ?? { tail: exampleMarker.tail, tip: exampleMarker.tip, confidence: 0.6, shaftLength: polylinePdfDistance([exampleMarker.tail, exampleMarker.tip]), headLength: polylinePdfDistance([exampleMarker.tail, exampleMarker.tip]) * 0.4, headAngleDegrees: 60 };
  const bounds = scanBounds(); const candidates = findArrowCandidates(pageSegments.get(project.page) ?? [], bounds).filter((candidate) => similarArrow(candidate, example));
  scanCancelled = false; els.cancelAirflowScanBtn.classList.remove('hidden'); loading(true); let added = 0;
  try {
    for (let index = 0; index < candidates.length; index += 80) {
      if (scanCancelled) break;
      const batch = candidates.slice(index, index + 80);
      batch.forEach((candidate) => {
        if (project.airflowMarkers.some((marker) => marker.pageNumber === project.page && Math.hypot(marker.tip.x - candidate.tip.x, marker.tip.y - candidate.tip.y) < 6)) return;
        if (addAirflowMarker(candidate.tail, candidate.tip, 'similarity-scan', Math.min(0.82, candidate.confidence), false)) added += 1;
      });
      status(`Scanning similar arrows… ${Math.min(index + batch.length, candidates.length)} / ${candidates.length}`); await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  } finally { loading(false); els.cancelAirflowScanBtn.classList.add('hidden'); scanCancelled = false; if (added) markChanged(); else renderUi(); }
  toast(`Added ${added} similar-arrow suggestion${added === 1 ? '' : 's'}`);
}

async function pickLabel(point: Point): Promise<void> {
  if (!pdfPage) return; if (!labelLocations.length) await scanPage();
  const nearest = labelLocations.map((location) => ({ location, distance: Math.hypot(point.x - (location.x + location.width / 2), point.y - (location.y + location.height / 2)) })).filter((item) => item.distance <= 45).sort((a, b) => a.distance - b.distance)[0]?.location;
  if (!nearest) { toast('No recognizable HVAC label near that point'); return; }
  selectedLabelModel = nearest.model; selectedLabelId = nearest.id; renderUi(); toast(`Selected ${nearest.model} label group`); setTool('pan');
}

function addPickedLabel(all: boolean): void {
  const locations = labelLocations.filter((location) => location.model === selectedLabelModel); const selected = locations.find((location) => location.id === selectedLabelId); if (!selected) return;
  const quantity = Math.floor(Number(byId<HTMLInputElement>('pickedLabelQuantity').value)); if (!Number.isFinite(quantity) || quantity < 1) { toast('Enter a valid quantity'); return; }
  const model = byId<HTMLInputElement>('pickedLabelModel').value.trim() || selected.model; const detectionId = `picked-${project.page}-${model}-${all ? 'all' : selected.id}`;
  if (project.parts.some((part) => part.detectionId === detectionId)) { toast('This picked label was already added'); return; }
  const before = cloneTakeoff(); project.parts.push({ id: uid('part'), category: 'Air terminal/device', model, size: '', system: 'Other', quantity, addedLengthM: 0, notes: `Selected PDF label on page ${project.page}`, source: 'detected', status: 'suggested', page: project.page, createdAt: now(), detectionId }); recordChange(before); toast(`${quantity} × ${model} added as suggested devices`);
}

function associatePickedLabel(): void {
  if (!selectedLabelModel || !selectedAirflowIds.size) return;
  const editedModel = document.querySelector<HTMLInputElement>('#pickedLabelModel')?.value.trim() || selectedLabelModel;
  project.airflowMarkers.forEach((marker) => { if (selectedAirflowIds.has(marker.id)) { marker.deviceModel = editedModel; marker.updatedAt = now(); } }); markChanged(); toast('Possible label association saved for review');
}

function nearbyMarkersForLabel(location: DetectionLocation): AirflowMarker[] {
  const centre = { x: location.x + location.width / 2, y: location.y + location.height / 2 };
  const nearby = project.airflowMarkers.filter((marker) => marker.pageNumber === location.page && marker.verificationStatus !== 'rejected' && Math.hypot(marker.tip.x - centre.x, marker.tip.y - centre.y) <= 120)
    .sort((a, b) => Math.hypot(a.tip.x - centre.x, a.tip.y - centre.y) - Math.hypot(b.tip.x - centre.x, b.tip.y - centre.y));
  const anchor = nearby[0]; if (!anchor) return [];
  const referenceId = anchor.nearestRouteId ?? anchor.temporaryAxisId;
  return nearby.filter((marker) => (marker.nearestRouteId ?? marker.temporaryAxisId) === referenceId);
}

function renderAirflowReview(): void {
  const active = project.airflowMarkers.filter((marker) => marker.verificationStatus !== 'rejected'); const filter = els.airflowFilter.value;
  let shown = active.filter((marker) => filter === 'all' || marker.classification === filter || marker.verificationStatus === filter);
  const sort = els.airflowSort.value; shown = [...shown].sort((a, b) => Number(selectedAirflowIds.has(b.id)) - Number(selectedAirflowIds.has(a.id)) || (sort === 'confidence' ? b.confidence - a.confidence : sort === 'classification' ? a.classification.localeCompare(b.classification) : sort === 'duct' ? (a.nearestRouteId ?? a.temporaryAxisId ?? '').localeCompare(b.nearestRouteId ?? b.temporaryAxisId ?? '') : a.pageNumber - b.pageNumber || a.tip.y - b.tip.y || a.tip.x - b.tip.x));
  const selected = project.airflowMarkers.filter((marker) => selectedAirflowIds.has(marker.id)); const hasSelection = selected.length > 0; const hiddenSelected = selected.filter((marker) => !visibleAirflow(marker)).length;
  els.airflowReviewCount.textContent = `${shown.length} shown · ${selected.length} selected`; els.airflowCount.textContent = `${active.length} point${active.length === 1 ? '' : 's'}`;
  const totalSupply = active.filter((marker) => marker.classification === 'supply').length; const totalExtract = active.filter((marker) => marker.classification === 'extract').length; const totalUncertain = active.filter((marker) => marker.classification === 'uncertain').length; const verified = active.filter((marker) => marker.verificationStatus === 'verified').length;
  els.airflowTotals.innerHTML = `<button type="button" data-airflow-classification="supply" aria-label="Select all Tulo markers in the current scope"><b>${totalSupply}</b><span>Tulo</span></button><button type="button" data-airflow-classification="extract" aria-label="Select all Poisto markers in the current scope"><b>${totalExtract}</b><span>Poisto</span></button><button type="button" data-airflow-filter="uncertain"><b>${totalUncertain}</b><span>Uncertain</span></button><button type="button" data-airflow-filter="verified"><b>${verified}/${active.length}</b><span>Verified</span></button>`;
  els.airflowSelectionScopeStatus.textContent = `Scope: ${airflowScopeLabel()}${els.airflowSelectionScope.value === 'route' ? selectedRouteId ? ` · ${project.routes.find((route) => route.id === selectedRouteId)?.size ?? 'selected route'}` : ' · no duct selected' : ''}`;
  els.airflowSelectionStatus.textContent = hasSelection ? `${selected.length} marker${selected.length === 1 ? '' : 's'} selected${hiddenSelected ? ` · ${hiddenSelected} hidden by current page or visibility filters` : ''}.` : 'No airflow markers selected.';
  els.showSelectedAirflowBtn.classList.toggle('hidden', !hiddenSelected); els.clearAirflowSelectionBtn.disabled = !hasSelection;
  [els.verifyAirflowBtn, els.flipAirflowBtn, els.rejectAirflowBtn, els.deleteAirflowBtn, els.setSupplyBtn, els.setExtractBtn, els.setUncertainBtn, els.updateAirflowBtn].forEach((button) => { button.disabled = !hasSelection; }); els.associateLabelBtn.disabled = !hasSelection || !selectedLabelModel; els.scanSimilarBtn.disabled = selected.length !== 1 || selected[0]?.verificationStatus !== 'verified';
  [els.fitSelectedAirflowBtn, els.previousSelectedAirflowBtn, els.nextSelectedAirflowBtn, els.clearReviewSelectionBtn].forEach((button) => { button.disabled = !hasSelection; });
  const routeOptions = project.routes.filter((route) => route.page === project.page).map((route) => `<option value="${route.id}">Route ${escapeHtml(route.size || route.id)} · ${escapeHtml(route.system)}</option>`); const axisOptions = project.temporaryDuctAxes.filter((axis) => axis.pageNumber === project.page).map((axis, index) => `<option value="${axis.id}">Temporary axis ${index + 1}</option>`);
  els.airflowRoute.innerHTML = `<option value="">Keep automatic association</option>${routeOptions.join('')}${axisOptions.join('')}`; els.airflowRoute.disabled = !hasSelection;
  if (selected.length === 1) { els.airflowModel.value = selected[0].deviceModel ?? ''; els.airflowNotes.value = selected[0].notes; els.airflowRoute.value = selected[0].nearestRouteId ?? selected[0].temporaryAxisId ?? ''; }
  els.airflowReviewList.innerHTML = shown.length ? shown.map((marker, index) => `<label class="airflow-review-card ${selectedAirflowIds.has(marker.id) ? 'selected' : ''} ${marker.id === focusedAirflowId ? 'focused' : ''} ${marker.classification}"><input type="checkbox" data-airflow-select="${marker.id}" ${selectedAirflowIds.has(marker.id) ? 'checked' : ''}><span><b>#${index + 1} ${escapeHtml(airflowLabel(marker.classification))}${selectedAirflowIds.has(marker.id) ? ' · Selected' : ''}</b><small>${Math.round(marker.confidence * 100)}% confidence · ${marker.verificationStatus === 'verified' ? 'Vahvistettu / Verified' : 'Ehdotus / Suggestion'} · Page ${marker.pageNumber}</small><small>Duct: ${escapeHtml(marker.nearestRouteId ?? marker.temporaryAxisId ?? 'none')} · ${escapeHtml(marker.source)}${marker.deviceModel ? ` · ${escapeHtml(marker.deviceModel)}` : ''}</small><details><summary>Diagnostics</summary><small>angle ${marker.arrowAngleDegrees.toFixed(1)}° · distance ${marker.distanceToDuct.toFixed(2)} pt · dot ${marker.dotProductScore.toFixed(3)}</small></details></span></label>`).join('') : '<div class="empty-mini">No airflow suggestions match this filter.</div>';
  const grouped = new Map<string, { supply: number; extract: number; uncertain: number }>(); active.forEach((marker) => { const key = marker.nearestRouteId ?? marker.temporaryAxisId ?? 'Unassigned'; const value = grouped.get(key) ?? { supply: 0, extract: 0, uncertain: 0 }; value[marker.classification] += 1; grouped.set(key, value); });
  const summaryGroups = new Map<string, { system: string; model: string; page: number; count: number }>(); active.forEach((marker) => { const system = marker.system ?? 'Unassigned'; const model = marker.deviceModel ?? 'No model'; const key = `${system}|${model}|${marker.pageNumber}`; const value = summaryGroups.get(key) ?? { system, model, page: marker.pageNumber, count: 0 }; value.count += 1; summaryGroups.set(key, value); });
  els.airflowGroups.innerHTML = grouped.size ? `<h3>Grouped by duct</h3>${[...grouped].map(([key, value]) => `<button class="airflow-group" data-airflow-group="${escapeHtml(key)}"><b>${escapeHtml(key)}</b><span>${value.supply} Tulo · ${value.extract} Poisto · ${value.uncertain} uncertain</span></button>`).join('')}<h3>System / model / page</h3>${[...summaryGroups.values()].map((value) => `<div class="airflow-group"><b>${escapeHtml(value.system)} · ${escapeHtml(value.model)}</b><span>${value.count} point${value.count === 1 ? '' : 's'} · page ${value.page}</span></div>`).join('')}` : '';
  const labelMatches = labelLocations.filter((location) => location.model === selectedLabelModel); const selectedLocation = labelMatches.find((location) => location.id === selectedLabelId); const totalLabelQuantity = labelMatches.reduce((sum, location) => sum + location.quantity, 0); const nearby = selectedLocation ? nearbyMarkersForLabel(selectedLocation) : [];
  const nearbySupply = nearby.filter((marker) => marker.classification === 'supply').length; const nearbyExtract = nearby.filter((marker) => marker.classification === 'extract').length;
  els.selectedLabelPanel.innerHTML = selectedLocation ? `<h3>Selected label group</h3><div class="inline"><label class="field"><span class="label">Model</span><input id="pickedLabelModel" class="input" value="${escapeHtml(selectedLocation.model)}"></label><label class="field qty"><span class="label">Quantity</span><input id="pickedLabelQuantity" class="input" type="number" min="1" step="1" value="${totalLabelQuantity}"></label></div><div class="item-meta">${labelMatches.length} occurrence${labelMatches.length === 1 ? '' : 's'} · Page ${project.page}<br>Possible association: ${totalLabelQuantity} × ${escapeHtml(selectedLocation.model)} · ${nearbySupply} nearby Tulo / Supply · ${nearbyExtract} nearby Poisto / Extract${nearby.length && nearby.length !== totalLabelQuantity ? ' · quantity needs review' : ''}.</div><div class="button-row">${nearby.length ? '<button class="btn small" data-select-nearby>Select nearby arrows</button>' : ''}<button class="btn small" data-add-picked="one">Add selected</button><button class="btn small" data-add-picked="all">Add label group</button><button class="btn small ghost" data-ignore-picked>Ignore highlight</button></div>` : '';
}

async function scanPage(): Promise<void> {
  if (!pdfPage) return; loading(true); status(`Scanning page ${project.page} text for supported HVAC labels…`);
  try {
    const text = await pdfPage.getTextContent();
    const items = text.items.filter((item): item is PdfTextItem & typeof item => 'str' in item && 'transform' in item).map((item) => ({ str: item.str, transform: [...item.transform], width: item.width }));
    detections = detectLabels(items, project.page).filter((item) => !project.rejectedDetectionIds.includes(item.id));
    const viewport = pdfPage.getViewport({ scale: 1 });
    labelLocations = detectLabelLocations(items, project.page).map((location) => { const [x, y] = viewport.convertToViewportPoint(location.x, location.y); return { ...location, x, y: y - location.height, width: Math.max(location.width, location.height), height: location.height }; });
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
  const fittingQuantity = project.parts.filter((part) => !DEVICE_CATEGORIES.has(part.category)).reduce((sum, part) => sum + part.quantity, 0) + project.customParts.reduce((sum, part) => sum + part.quantity, 0);
  const deviceQuantity = project.parts.filter((part) => DEVICE_CATEGORIES.has(part.category)).reduce((sum, part) => sum + part.quantity, 0);
  const pendingDetections = detections.filter((item) => !project.parts.some((part) => part.detectionId === item.id)).length;
  const unverified = project.parts.filter((part) => part.status === 'suggested').reduce((sum, part) => sum + part.quantity, 0) + project.customParts.filter((part) => part.verificationStatus === 'suggested').reduce((sum, part) => sum + part.quantity, 0) + project.airflowMarkers.filter((marker) => marker.verificationStatus === 'suggested').length + pendingDetections;
  els.totalDuct.textContent = `${totalLength.toFixed(2)} m`; els.totalRoutes.textContent = String(project.routes.length); els.totalFittings.textContent = String(fittingQuantity); els.totalDevices.textContent = String(deviceQuantity); els.unverifiedCount.textContent = String(unverified);
  els.fileName.textContent = pdfDoc ? `${project.drawing?.fileName ?? 'PDF'} · ${pdfDoc.numPages} page${pdfDoc.numPages === 1 ? '' : 's'}` : project.drawing ? `${project.drawing.fileName} · reload PDF to view overlays` : 'No PDF loaded.';
  const demoReady = Boolean(pdfDoc && (project.routes.length || project.parts.length || project.customParts.length || project.airflowMarkers.some((marker) => marker.verificationStatus !== 'rejected')));
  els.demoBadge.textContent = demoReady ? 'Demo ready' : 'Not ready'; els.demoBadge.classList.toggle('ready', demoReady);
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
  project.customParts.forEach((part) => { const key = `custom|${part.name}|${part.system}|${part.verificationStatus}`; const value = groups.get(key) ?? { label: `Custom · ${part.name}`, system: part.system, status: part.verificationStatus, quantity: 0 }; value.quantity += part.quantity; groups.set(key, value); });
  project.airflowMarkers.filter((marker) => marker.verificationStatus !== 'rejected').forEach((marker) => { const key = `airflow|${marker.classification}|${marker.system ?? ''}|${marker.deviceModel ?? ''}|${marker.verificationStatus}`; const value = groups.get(key) ?? { label: `Airflow · ${airflowLabel(marker.classification)}${marker.deviceModel ? ` · ${marker.deviceModel}` : ''}`, system: marker.system ?? 'Unassigned', status: marker.verificationStatus, quantity: 0 }; value.quantity += 1; groups.set(key, value); });
  els.partSummary.innerHTML = groups.size ? [...groups.values()].map((item) => `<div class="summary-row"><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.system)} · ${escapeHtml(item.status)}</span><strong>${item.quantity}×</strong></div>`).join('') : '<div class="empty-mini">No parts or devices yet.</div>';
  const routeCards = project.routes.map((route) => `<button class="item-card selectable ${route.id === selectedRouteId ? 'selected' : ''}" data-route="${route.id}"><span><b>${escapeHtml(route.size)} · ${routeLengthM(route, project).toFixed(2)} m</b><small>${escapeHtml(route.shape)} · ${escapeHtml(route.system)} · Page ${route.page}${route.notes ? ` · ${escapeHtml(route.notes)}` : ''}</small></span></button>`);
  const partCards = project.parts.map((part) => `<button class="item-card selectable ${part.id === selectedPartId ? 'selected' : ''}" data-part="${part.id}"><span><b>${part.quantity}× ${escapeHtml(part.category)}${part.model ? ` · ${escapeHtml(part.model)}` : ''}</b><small>${escapeHtml(part.size || 'No size')} · ${escapeHtml(part.system)} · ${part.source}/${part.status} · Page ${part.page}</small></span></button>`);
  const customCards = project.customParts.map((part) => { const a = profileForEnd(part, 'a') === 'round' ? `Ø${part.endADiameterMm}` : `${part.endAWidthMm}×${part.endAHeightMm}`; const b = profileForEnd(part, 'b') === 'round' ? `Ø${part.endBDiameterMm}` : `${part.endBWidthMm}×${part.endBHeightMm}`; return `<button class="item-card selectable" data-custom="${part.id}"><span><b>${part.quantity}× Custom · ${escapeHtml(part.name)}</b><small>${a} → ${b} · L${part.lengthMm} · X${part.horizontalOffsetMm} · Y${part.verticalOffsetMm}</small></span></button>`; });
  els.detailList.innerHTML = routeCards.length || partCards.length || customCards.length ? [...routeCards, ...partCards, ...customCards].join('') : '<div class="empty-mini">Trace a route or add a part to build the takeoff.</div>';
  els.showSupply.checked = project.airflowVisibility.showSupply; els.showExtract.checked = project.airflowVisibility.showExtract; els.showUncertain.checked = project.airflowVisibility.showUncertain; els.verifiedOnly.checked = project.airflowVisibility.verifiedOnly; els.showAirflowLabels.checked = project.airflowVisibility.showLabels; els.showAirflowVectors.checked = project.airflowVisibility.showVectors;
  renderAirflowReview();
  ductUi?.render();
  renderMaterialWorkspace();
  drawOverlay();
}

function restoreSaved(notify = true): void {
  const saved = loadProject(); if (!saved) { if (notify) toast('No saved project found'); return; }
  if (pdfDoc && project.drawing && saved.drawing && project.drawing.fingerprint !== saved.drawing.fingerprint && !window.confirm(`The open PDF is “${project.drawing.fileName}”, but the saved takeoff belongs to “${saved.drawing.fileName}”. Restore its overlays anyway?`)) return;
  project = saved; ensureDuctDefaults(project); selectedRouteId = null; selectedPartId = null; selectedAirflowIds.clear(); selectedLabelModel = null; selectedLabelId = null; undoStack = []; redoStack = [];
  ductUi?.clearTransient(); builderController.load();
  els.projectName.value = project.projectName; els.scalePreset.value = [20, 50, 100, 200].includes(project.scaleRatio) ? String(project.scaleRatio) : 'custom'; els.customScale.value = String(project.customScaleRatio || project.scaleRatio); els.customScaleField.classList.toggle('hidden', els.scalePreset.value !== 'custom');
  els.savedStatus.textContent = `Restored ${new Date(project.updatedAt).toLocaleString()}`; renderUi(); if (notify) toast('Saved project restored — reload its PDF to view the drawing');
}
function newProject(): void {
  if ((project.routes.length || project.parts.length || project.customParts.length || project.airflowMarkers.length) && !window.confirm('Start a new project? Unsaved takeoff changes will be replaced.')) return;
  project = freshProject(); ductUi?.clearTransient(); selectedRouteId = null; selectedPartId = null; selectedAirflowIds.clear(); selectedLabelModel = null; selectedLabelId = null; undoStack = []; redoStack = []; detections = []; labelLocations = []; currentTrace = []; calibrationPoints = []; builderController.load(); els.projectName.value = project.projectName; els.scalePreset.value = '50'; els.customScale.value = '50'; renderDetections(); markChanged(); toast('New project started');
}
function clearProject(): void {
  if (!window.confirm('Clear this project and its locally saved takeoff data? This cannot be undone.')) return;
  project = freshProject(); ductUi?.clearTransient(); clearSavedProject(); selectedRouteId = null; selectedPartId = null; selectedAirflowIds.clear(); selectedLabelModel = null; selectedLabelId = null; undoStack = []; redoStack = []; detections = []; labelLocations = []; currentTrace = []; calibrationPoints = []; builderController.load(); els.projectName.value = project.projectName; els.savedStatus.textContent = 'Local project cleared'; renderDetections(); renderUi(); toast('Project data cleared');
}
function exportProject(kind: 'summary' | 'detail' | 'json'): void {
  project.projectName = els.projectName.value.trim() || project.projectName; const base = `${safeFileBase(project.projectName)}-${exportDate()}`;
  if (kind === 'summary') download(`${base}-summary.csv`, makeSummaryCsv(project), 'text/csv;charset=utf-8');
  else if (kind === 'detail') download(`${base}-details.csv`, makeDetailedCsv(project), 'text/csv;charset=utf-8');
  else download(`${base}.json`, JSON.stringify(project, null, 2), 'application/json');
  toast(`${kind === 'json' ? 'JSON' : 'CSV'} export created`);
}

async function fitToPdfPoints(points: Point[]): Promise<void> {
  if (!pdfPage || !points.length) return;
  const left = Math.min(...points.map((point) => point.x)); const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y)); const bottom = Math.max(...points.map((point) => point.y));
  const width = Math.max(40, right - left); const height = Math.max(40, bottom - top);
  const desiredScale = Math.min((els.viewerScroll.clientWidth - 100) / width, (els.viewerScroll.clientHeight - 100) / height);
  zoomFactor = Math.max(.25, Math.min(6, desiredScale / Math.max(.001, fitScale))); await renderPage();
  els.viewerScroll.scrollLeft = Math.max(0, els.canvasStage.offsetLeft + ((left + right) / 2) * renderScale - els.viewerScroll.clientWidth / 2);
  els.viewerScroll.scrollTop = Math.max(0, els.canvasStage.offsetTop + ((top + bottom) / 2) * renderScale - els.viewerScroll.clientHeight / 2);
  drawOverlay();
}
async function cachedDuctLines(): Promise<Array<{ start: Point; end: Point }>> {
  await ensurePageGeometry();
  return (pageSegments.get(project.page) ?? []).map((segment) => ({ start: segment.start, end: segment.end }));
}

// --- Cursor-centred zoom ---------------------------------------------------
async function zoomAtClient(clientX: number, clientY: number, nextZoom: number): Promise<void> {
  if (!pdfPage) return;
  const clamped = Math.max(0.25, Math.min(6, nextZoom));
  if (Math.abs(clamped - zoomFactor) < 0.0005) return;
  const canvasRect = els.overlayCanvas.getBoundingClientRect();
  // PDF point currently under the pointer (canvas-space at scale 1).
  const pdfX = (clientX - canvasRect.left) / renderScale;
  const pdfY = (clientY - canvasRect.top) / renderScale;
  zoomFactor = clamped;
  await renderPage();
  // Measure where that PDF point now sits and nudge scroll so it returns under the
  // pointer. This is exact regardless of the stage's auto-centring margins.
  const after = els.overlayCanvas.getBoundingClientRect();
  els.viewerScroll.scrollLeft += (after.left + pdfX * renderScale) - clientX;
  els.viewerScroll.scrollTop += (after.top + pdfY * renderScale) - clientY;
  drawOverlay();
}
function zoomAtViewportCentre(nextZoom: number): void {
  const rect = els.viewerScroll.getBoundingClientRect();
  void zoomAtClient(rect.left + rect.width / 2, rect.top + rect.height / 2, nextZoom);
}

// --- Automatic scan --------------------------------------------------------
async function runScan(): Promise<void> {
  if (!pdfPage) { toast('Upload a PDF first'); return; }
  if (scanBusy) return;
  scanBusy = true; renderUi(); loading(true);
  const started = performance.now();
  try {
    status('Scan A/E — reading title block and text labels…');
    const viewport = pdfPage.getViewport({ scale: 1 });
    const textContent = await pdfPage.getTextContent();
    const textItems = textContent.items
      .filter((item): item is typeof item & { str: string; transform: number[] } => 'str' in item && 'transform' in item)
      .map((item) => ({ text: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, width: Math.abs((item as { width?: number }).width ?? 0), height: Math.max(1, Math.abs(item.transform[3] ?? item.transform[0] ?? 10)) }))
      .filter((item) => item.text.trim());
    status('Scan C — indexing vector geometry…');
    await ensurePageGeometry();
    const segments = (pageSegments.get(project.page) ?? []).map((segment) => ({ start: segment.start, end: segment.end }));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    status('Scan D/F — pairing duct edges, building duct bodies and classifying systems…');
    // One shared coordinate space: labels are converted to overlay/viewport space up
    // front so detected duct polygons align with the cached vector geometry.
    const toViewport = (point: Point): Point => { const [vx, vy] = viewport.convertToViewportPoint(point.x, point.y); return { x: vx, y: vy }; };
    const result = scanDrawing({ page: project.page, fileName: project.drawing?.fileName ?? 'drawing.pdf', pageWidth: viewport.width, pageHeight: viewport.height, textItems, segments, mmPerPdfPoint: project.calibration.mmPerPdfPoint, toViewport });

    // Replace any previous scan-sourced networks on this page.
    project.ductNetworks.filter((network) => network.pageNumber === project.page && network.source === 'assisted-vector' && network.notes.startsWith('Auto-scanned')).map((network) => network.id).forEach((id) => removeNetwork(project, id));
    project.ductNetworks.push(...result.networks);
    project.ductSegments.push(...result.segments);
    project.ductNodes.push(...result.nodes);
    project.contractBoundaries.push(...result.boundaries);
    result.summary.ductMetres = project.ductNetworks.filter((network) => network.pageNumber === project.page).reduce((sum, network) => sum + networkTotals(project, network).lengthM, 0);
    project.scan = { ranAt: now(), page: project.page, metadata: result.metadata, summary: result.summary, diagnostics: result.diagnostics };

    const ratio = scaleRatioFromTitleBlock(result.metadata);
    if (ratio && project.calibration.mode === 'preset') { project.scaleRatio = ratio; project.calibration = { mode: 'preset', mmPerPdfPoint: presetMmPerPdfPoint(ratio) }; els.scalePreset.value = [20, 50, 100, 200].includes(ratio) ? String(ratio) : 'custom'; els.customScale.value = String(ratio); }
    els.projectName.value = result.metadata.projectName.value || els.projectName.value;
    markChanged();
    const elapsed = Math.round(performance.now() - started);
    toast(`Scan complete: ${result.summary.tuloNetworks} Tulo, ${result.summary.poistoNetworks} Poisto, ${result.diagnostics.partCandidates} candidates`);
    status(`Scan complete in ${elapsed} ms — ${result.diagnostics.labelCount} labels, ${result.diagnostics.partCandidates} part candidates, ${result.summary.unresolved} unresolved.`);
  } catch (error) {
    console.error('Scan failed', error); status('Scan failed: geometry or text parsing was unavailable for this PDF.'); toast('Scan failed — see console');
  } finally { scanBusy = false; loading(false); renderUi(); }
}

function exportScanReport(): void {
  if (!project.ductNetworks.length && !project.scan.ranAt) { toast('Scan the drawing or load a demo first'); return; }
  const base = `${safeFileBase(project.projectName)}-${exportDate()}`;
  const blob = takeoffReportBlob(project);
  const file = new File([blob], `${base}-report.pdf`, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] }) && typeof navigator.share === 'function') {
    navigator.share({ files: [file], title: 'HVAC takeoff report' }).catch(() => downloadBlob(blob, file.name));
  } else downloadBlob(blob, file.name);
  toast('PDF takeoff report created');
}
function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function exportScanDiagnostics(): void {
  if (!project.scan.diagnostics) { toast('Run a scan first'); return; }
  download(`${safeFileBase(project.projectName)}-scan-diagnostics.json`, JSON.stringify(project.scan.diagnostics, null, 2), 'application/json');
  toast('Scan diagnostics exported');
}
function updateTitleBlockField(key: keyof ScanMetadata, value: string): void {
  if (!project.scan.metadata) return;
  project.scan.metadata[key] = { value, source: 'manual', confidence: 1 };
  if (key === 'projectName' && value.trim()) els.projectName.value = value;
  markChanged();
}

builderController = initCustomPartBuilder(els.customBuilderWorkspace, {
  onSave: saveCustomPart, onChange: updateCustomPartDraft, notify: toast,
  getTemplates: () => project.personalTemplates,
  saveTemplate: (template) => {
    const index = project.personalTemplates.findIndex((item) => item.id === template.id);
    if (index >= 0) project.personalTemplates[index] = template; else project.personalTemplates.push(template);
    markChanged();
  },
  deleteTemplate: (id) => { project.personalTemplates = project.personalTemplates.filter((item) => item.id !== id); markChanged(); },
});
builderController.setActive(false);

ductUi = initDuctNetworkUi({
  getProject: () => project,
  markChanged,
  toast,
  status,
  getPage: () => project.page,
  requestOverlay: drawOverlay,
  getCachedLines: cachedDuctLines,
  getMmPerPdfPoint: () => project.calibration.mmPerPdfPoint,
  fitToPoints: (points) => { void fitToPdfPoints(points); },
  setTool,
  getTool: () => tool,
  isMobile: () => window.innerWidth <= 600,
  hasPdf: () => Boolean(pdfPage),
  runScan,
  scanBusy: () => scanBusy,
  exportReport: exportScanReport,
  exportDiagnostics: exportScanDiagnostics,
  updateTitleBlockField,
});

document.querySelectorAll<HTMLButtonElement>('[data-workspace]').forEach((button) => button.addEventListener('click', () => switchWorkspace(button.dataset.workspace as 'takeoff' | 'builder' | 'materials')));
els.materialNewCustom.addEventListener('click', () => { builderController.load(); switchWorkspace('builder'); });
els.materialExportSummary.addEventListener('click', () => exportProject('summary')); els.materialExportDetails.addEventListener('click', () => exportProject('detail')); els.materialExportJson.addEventListener('click', () => exportProject('json'));
els.materialCustomList.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-edit-custom],[data-pdf-custom],[data-duplicate-custom],[data-delete-custom],[data-new-custom]'); if (!target) return;
  if (target.dataset.newCustom !== undefined) { builderController.load(); switchWorkspace('builder'); return; }
  if (target.dataset.editCustom) editCustomPart(target.dataset.editCustom);
  if (target.dataset.pdfCustom) { const part = project.customParts.find((item) => item.id === target.dataset.pdfCustom); if (part) { downloadCustomPartPdf(part); toast('Two-page custom fitting PDF created'); } }
  if (target.dataset.duplicateCustom) duplicateCustomPart(target.dataset.duplicateCustom);
  if (target.dataset.deleteCustom) deleteCustomPart(target.dataset.deleteCustom);
});

els.uploadBtn.addEventListener('click', () => els.pdfInput.click()); els.emptyUploadBtn.addEventListener('click', () => els.pdfInput.click());
els.pdfInput.addEventListener('change', () => { const file = els.pdfInput.files?.[0]; if (file) void loadPdf(file); els.pdfInput.value = ''; });
els.projectName.addEventListener('input', markChanged); els.saveBtn.addEventListener('click', () => persist()); els.restoreBtn.addEventListener('click', () => restoreSaved()); els.newBtn.addEventListener('click', newProject); els.clearBtn.addEventListener('click', clearProject);
els.scalePreset.addEventListener('change', () => { els.customScaleField.classList.toggle('hidden', els.scalePreset.value !== 'custom'); resetCalibration(); }); els.customScale.addEventListener('change', resetCalibration); els.calibrateBtn.addEventListener('click', () => { if (!pdfPage) { toast('Upload a PDF first'); return; } calibrationPoints = []; setTool('calibrate'); }); els.resetCalibrationBtn.addEventListener('click', resetCalibration);
els.traceBtn.addEventListener('click', startTrace); els.finishTraceBtn.addEventListener('click', finishTrace); els.undoPointBtn.addEventListener('click', () => { currentTrace.pop(); previewPoint = null; renderUi(); }); els.updateRouteBtn.addEventListener('click', updateSelectedRoute); els.deleteRouteBtn.addEventListener('click', deleteSelection);
els.addPartBtn.addEventListener('click', addPart); els.updatePartBtn.addEventListener('click', updateSelectedPart); els.deletePartBtn.addEventListener('click', deleteSelection);
els.markAirflowBtn.addEventListener('click', () => { if (!pdfPage) { toast('Upload a PDF first'); return; } forceManualAirflow = false; airflowDraft = []; setTool('airflow'); });
els.manualAirflowBtn.addEventListener('click', () => { if (!pdfPage) { toast('Upload a PDF first'); return; } forceManualAirflow = true; airflowDraft = []; setTool('airflow'); status('Manual airflow: click the arrow tail, then the arrow tip.'); });
els.temporaryAxisBtn.addEventListener('click', () => { if (!pdfPage) { toast('Upload a PDF first'); return; } axisDraft = []; setTool('axis'); });
els.scanSimilarBtn.addEventListener('click', () => void scanSimilarArrows()); els.cancelAirflowScanBtn.addEventListener('click', () => { scanCancelled = true; status('Cancelling airflow scan…'); });
els.verifyAirflowBtn.addEventListener('click', () => mutateSelectedAirflow('verify')); els.flipAirflowBtn.addEventListener('click', () => mutateSelectedAirflow('flip')); els.rejectAirflowBtn.addEventListener('click', () => { if (window.confirm('Reject the selected airflow suggestions? They will be hidden from active totals.')) mutateSelectedAirflow('reject'); }); els.deleteAirflowBtn.addEventListener('click', () => { if (window.confirm('Delete the selected airflow markers?')) mutateSelectedAirflow('delete'); });
els.setSupplyBtn.addEventListener('click', () => mutateSelectedAirflow('supply')); els.setExtractBtn.addEventListener('click', () => mutateSelectedAirflow('extract')); els.setUncertainBtn.addEventListener('click', () => mutateSelectedAirflow('uncertain')); els.updateAirflowBtn.addEventListener('click', updateSelectedAirflowMetadata); els.associateLabelBtn.addEventListener('click', associatePickedLabel);
els.selectSupplyBtn.addEventListener('click', () => selectAirflowClassification('supply'));
els.selectExtractBtn.addEventListener('click', () => selectAirflowClassification('extract'));
els.selectUncertainAirflowBtn.addEventListener('click', () => selectAirflowClassification('uncertain'));
els.airflowSelectionScope.addEventListener('change', () => { airflowSelectionScopeTouched = true; renderUi(); status(`Airflow bulk-selection scope changed to ${airflowScopeLabel()}.`); });
els.clearAirflowSelectionBtn.addEventListener('click', () => clearAirflowSelection()); els.clearReviewSelectionBtn.addEventListener('click', () => clearAirflowSelection());
els.showSelectedAirflowBtn.addEventListener('click', showSelectedAirflow); els.fitSelectedAirflowBtn.addEventListener('click', () => void fitAirflowMarkers(project.airflowMarkers.filter((marker) => selectedAirflowIds.has(marker.id))));
els.previousSelectedAirflowBtn.addEventListener('click', () => cycleSelectedAirflow(-1)); els.nextSelectedAirflowBtn.addEventListener('click', () => cycleSelectedAirflow(1));
els.clearAirflowBtn.addEventListener('click', () => { if (!project.airflowMarkers.length || !window.confirm('Clear all airflow markers and temporary axes? This cannot be undone.')) return; project.airflowMarkers = []; project.temporaryDuctAxes = []; selectedAirflowIds.clear(); markChanged(); toast('Airflow scan cleared'); });
els.airflowFilter.addEventListener('change', renderUi); els.airflowSort.addEventListener('change', renderUi);
els.airflowTotals.addEventListener('click', (event) => { const target = (event.target as HTMLElement).closest<HTMLElement>('[data-airflow-classification],[data-airflow-filter]'); if (!target) return; const classification = target.dataset.airflowClassification; if (classification === 'supply' || classification === 'extract') selectAirflowClassification(classification); else if (target.dataset.airflowFilter) { els.airflowFilter.value = target.dataset.airflowFilter; renderUi(); } });
([['showSupply', 'showSupply'], ['showExtract', 'showExtract'], ['showUncertain', 'showUncertain'], ['verifiedOnly', 'verifiedOnly'], ['showAirflowLabels', 'showLabels'], ['showAirflowVectors', 'showVectors']] as const).forEach(([elementKey, setting]) => { els[elementKey].addEventListener('change', () => { project.airflowVisibility[setting] = els[elementKey].checked; markChanged(); }); });
els.zoomInBtn.addEventListener('click', () => zoomAtViewportCentre(zoomFactor * 1.25)); els.zoomOutBtn.addEventListener('click', () => zoomAtViewportCentre(zoomFactor / 1.25)); els.fitBtn.addEventListener('click', () => void fitAndRender()); els.undoBtn.addEventListener('click', undo); els.redoBtn.addEventListener('click', redo);
els.pageSelect.addEventListener('change', () => { const page = Number(els.pageSelect.value); void openPage(page, true).then(() => { markChanged(); status(`Viewing page ${page}.`); }).catch((error: unknown) => { console.error(error); toast('Could not open that page'); }); });
els.scanBtn.addEventListener('click', () => void scanPage()); els.exportSummaryBtn.addEventListener('click', () => exportProject('summary')); els.exportDetailBtn.addEventListener('click', () => exportProject('detail')); els.exportJsonBtn.addEventListener('click', () => exportProject('json'));
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool as Tool)));

function pinchMetrics(): { distance: number; cx: number; cy: number } | null {
  const points = [...activePointers.values()];
  if (points.length < 2) return null;
  const [a, b] = points;
  return { distance: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}
els.overlayCanvas.addEventListener('pointerdown', (event) => {
  if (!pdfPage) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size === 2) {
    const metrics = pinchMetrics();
    if (metrics) { pinchState = { startDistance: metrics.distance, startZoom: zoomFactor }; panState = null; }
    return;
  }
  if (tool === 'pan') {
    const point = eventPoint(event); const marker = hitAirflow(point); if (marker) { selectedAirflowIds = new Set([marker.id]); renderUi(); return; }
    if (ductUi?.hitTest(point, renderScale)) return;
    const route = hitRoute(point); if (route) { selectRoute(route); return; }
    selectedRouteId = null; selectedAirflowIds.clear(); renderUi(); els.overlayCanvas.setPointerCapture(event.pointerId); panState = { x: event.clientX, y: event.clientY, left: els.viewerScroll.scrollLeft, top: els.viewerScroll.scrollTop }; els.overlayCanvas.style.cursor = 'grabbing'; return;
  }
  const point = eventPoint(event);
  if (tool === 'trace') { currentTrace.push(point); previewPoint = null; renderUi(); }
  else if (tool === 'calibrate') { calibrationPoints.push(point); drawOverlay(); if (calibrationPoints.length === 2) applyCalibration(); }
  else if (tool === 'airflow') void handleAirflowClick(point);
  else if (tool === 'axis') handleAxisClick(point);
  else if (tool === 'label') void pickLabel(point);
  else if (tool === 'network-seed' || tool === 'network-trace') ductUi?.handleCanvasClick(point);
});
els.overlayCanvas.addEventListener('pointermove', (event) => {
  if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinchState) {
    const metrics = pinchMetrics();
    if (metrics && metrics.distance > 0) void zoomAtClient(metrics.cx, metrics.cy, pinchState.startZoom * (metrics.distance / pinchState.startDistance));
    return;
  }
  if (tool === 'pan' && panState) { els.viewerScroll.scrollLeft = panState.left - (event.clientX - panState.x); els.viewerScroll.scrollTop = panState.top - (event.clientY - panState.y); }
  else if (tool === 'trace' && currentTrace.length) { previewPoint = eventPoint(event); drawOverlay(); }
  else if ((tool === 'airflow' && airflowDraft.length) || (tool === 'axis' && axisDraft.length)) { previewPoint = eventPoint(event); drawOverlay(); }
  else if (tool === 'network-trace' && (ductUi?.getTraceDraft().length ?? 0)) { previewPoint = eventPoint(event); drawOverlay(); }
});
els.overlayCanvas.addEventListener('pointerleave', () => { if (tool === 'trace' || tool === 'airflow' || tool === 'axis' || tool === 'network-trace') { previewPoint = null; drawOverlay(); } });
els.overlayCanvas.addEventListener('pointerup', (event) => { activePointers.delete(event.pointerId); if (activePointers.size < 2) pinchState = null; if (panState) { panState = null; if (els.overlayCanvas.hasPointerCapture(event.pointerId)) els.overlayCanvas.releasePointerCapture(event.pointerId); els.overlayCanvas.style.cursor = 'grab'; } });
els.overlayCanvas.addEventListener('pointercancel', (event) => { activePointers.delete(event.pointerId); if (activePointers.size < 2) pinchState = null; panState = null; els.overlayCanvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair'; });
els.overlayCanvas.addEventListener('dblclick', (event) => {
  if (tool === 'trace') { event.preventDefault(); if (currentTrace.length > 2) currentTrace.pop(); finishTrace(); }
  else if (tool === 'network-trace') { event.preventDefault(); ductUi?.handleTraceCommit(); }
});
els.viewerScroll.addEventListener('wheel', (event) => { if (!pdfPage) return; event.preventDefault(); void zoomAtClient(event.clientX, event.clientY, zoomFactor * (event.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
els.detectionList.addEventListener('click', (event) => { const target = event.target as HTMLElement; const accept = target.dataset.accept; const reject = target.dataset.reject; if (accept) acceptDetection(accept); if (reject) rejectDetection(reject); });
els.airflowReviewList.addEventListener('change', (event) => { const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-airflow-select]'); if (!input) return; const id = input.dataset.airflowSelect ?? ''; if (input.checked) { selectedAirflowIds.add(id); focusedAirflowId = id; } else { selectedAirflowIds.delete(id); if (focusedAirflowId === id) focusedAirflowId = null; } renderUi(); });
els.airflowGroups.addEventListener('click', (event) => { const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-airflow-group]'); if (!target) return; const id = target.dataset.airflowGroup; selectedAirflowIds = new Set(project.airflowMarkers.filter((marker) => marker.nearestRouteId === id || marker.temporaryAxisId === id).map((marker) => marker.id)); const route = project.routes.find((item) => item.id === id); if (route) selectRoute(route); else renderUi(); });
els.selectedLabelPanel.addEventListener('click', (event) => { const target = event.target as HTMLElement; if (target.dataset.addPicked === 'one') addPickedLabel(false); if (target.dataset.addPicked === 'all') addPickedLabel(true); if (target.dataset.selectNearby !== undefined) { const location = labelLocations.find((item) => item.id === selectedLabelId); if (location) { selectedAirflowIds = new Set(nearbyMarkersForLabel(location).map((marker) => marker.id)); renderUi(); } } if (target.dataset.ignorePicked !== undefined) { selectedLabelModel = null; selectedLabelId = null; renderUi(); } });
els.detailList.addEventListener('click', (event) => { const target = (event.target as HTMLElement).closest<HTMLElement>('[data-route],[data-part],[data-custom]'); if (!target) return; if (target.dataset.route) selectRoute(project.routes.find((route) => route.id === target.dataset.route) ?? null); if (target.dataset.part) { const part = project.parts.find((item) => item.id === target.dataset.part); if (part) selectPart(part); } if (target.dataset.custom) editCustomPart(target.dataset.custom); });
document.addEventListener('keydown', (event) => {
  const inputActive = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); persist(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
  if (inputActive) return;
  if (event.key === 'Enter' && tool === 'trace') { event.preventDefault(); finishTrace(); }
  else if (event.key === 'Enter' && tool === 'network-trace') { event.preventDefault(); ductUi?.handleTraceCommit(); }
  else if (event.key === 'Escape' && (tool === 'network-trace' || tool === 'network-seed')) { ductUi?.clearTransient(); setTool('pan'); toast('Duct system action cancelled'); }
  else if (event.key === 'Escape' && tool === 'trace') { cancelTrace(); setTool('pan'); }
  else if (event.key === 'Escape' && tool === 'calibrate') { calibrationPoints = []; setTool('pan'); toast('Calibration cancelled'); }
  else if (event.key === 'Escape' && (tool === 'airflow' || tool === 'axis' || tool === 'label')) { airflowDraft = []; axisDraft = []; setTool('pan'); toast('Airflow action cancelled'); }
  else if (event.key === 'Backspace' && tool === 'trace') { event.preventDefault(); currentTrace.pop(); renderUi(); }
  else if (event.key === 'Delete' && selectedAirflowIds.size) { event.preventDefault(); if (window.confirm('Delete the selected airflow markers?')) mutateSelectedAirflow('delete'); }
  else if (event.key === 'Delete' && (selectedRouteId || selectedPartId)) { event.preventDefault(); deleteSelection(); }
});
window.addEventListener('resize', () => { if (pdfPage && Math.abs(zoomFactor - 1) < 0.01) void fitAndRender(); });

els.projectName.value = project.projectName;
els.scalePreset.value = [20, 50, 100, 200].includes(project.scaleRatio) ? String(project.scaleRatio) : 'custom';
els.customScale.value = String(project.customScaleRatio || project.scaleRatio);
els.customScaleField.classList.toggle('hidden', els.scalePreset.value !== 'custom');
if (loadProject()) els.savedStatus.textContent = `Restored ${new Date(project.updatedAt).toLocaleString()} — reload PDF to view drawing`;
renderDetections(); renderUi();
