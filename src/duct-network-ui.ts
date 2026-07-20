import type { Point, ProjectData, Tool } from './types';
import type { DuctNetwork, DuctNode, DuctSegment, DuctSystemType } from './duct-network-types';
import { profileLabel, systemTypeToLabel } from './duct-network-types';
import {
  autoDetectNetworks, boundariesForNetwork, countNetworkParts, createContractBoundary, createNetwork, createSegment,
  deriveSuggestedNodes, excludedSegmentIds, highlightSummary, networkCounts, networkForSegment, networkNodes, networkSegments,
  networksOfKind, networkTotals, recomputeSegmentLengths, removeNetwork, touch, traceFromSeed, uid,
  type TraceLine,
} from './duct-network';
import type { ContractBoundary, ContractScopeSide } from './duct-network-types';
import { createDemoDuctNetwork } from './duct-fixture';
import { profileFromSizeText } from './duct-labels';
import { catalogueName, mergedCatalogue } from './duct-catalogue';

export interface DuctNetworkContext {
  getProject(): ProjectData;
  markChanged(): void;
  toast(message: string): void;
  status(message: string): void;
  getPage(): number;
  requestOverlay(): void;
  getCachedLines(): Promise<TraceLine[]>;
  getMmPerPdfPoint(): number;
  fitToPoints(points: Point[]): void;
  setTool(tool: Tool): void;
  getTool(): Tool;
  isMobile(): boolean;
  hasPdf(): boolean;
}

const SYSTEM_OPTIONS: Array<{ value: DuctSystemType | 'infer'; label: string }> = [
  { value: 'supply', label: 'Tulo / Supply' },
  { value: 'extract', label: 'Poisto / Extract' },
  { value: 'outdoor', label: 'Ulko / Outdoor' },
  { value: 'exhaust', label: 'Jäte / Exhaust' },
  { value: 'transfer', label: 'Siirto / Transfer' },
  { value: 'other', label: 'Muu / Other' },
  { value: 'infer', label: 'Infer from nearby verified airflow arrows' },
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

function systemColor(type: DuctSystemType): string {
  if (type === 'supply') return '#52d6ff';
  if (type === 'extract' || type === 'exhaust') return '#ff9b6b';
  if (type === 'outdoor') return '#9ef0c9';
  if (type === 'transfer') return '#b88cff';
  return '#b6c6d5';
}

export interface DuctNetworkController {
  render(): void;
  draw(context: CanvasRenderingContext2D, renderScale: number): void;
  handleCanvasClick(point: Point): boolean;
  handleTraceCommit(): void;
  handleToolChange(tool: Tool): void;
  hitTest(point: Point, renderScale: number): boolean;
  getTraceDraft(): Point[];
  clearTransient(): void;
}

export function initDuctNetworkUi(context: DuctNetworkContext): DuctNetworkController {
  const leftHost = document.querySelector<HTMLElement>('.sidebar.left');
  const rightHost = document.querySelector<HTMLElement>('.sidebar.right');
  if (!leftHost || !rightHost) throw new Error('Duct network UI hosts missing');

  let selectedNetworkId: string | null = null;
  let selectedSegmentId: string | null = null;
  let selectedNodeId: string | null = null;
  let selectedBoundaryId: string | null = null;
  let traceDraft: Point[] = [];
  let progressCancelled = false;
  let tracing = false;
  const view = { showUR: true, showSuggested: true, showLabels: true, verifiedOnly: false };

  // --- Panels -------------------------------------------------------------
  const controlPanel = document.createElement('section');
  controlPanel.className = 'panel duct-panel';
  controlPanel.innerHTML = `
    <div class="panel-header"><h2>Duct Systems</h2><span id="ductNetCount" class="badge muted">0 networks</span></div>
    <div class="panel-body">
      <p class="help">Highlight complete connected <b>Tulo-kanavisto</b> / <b>Poistokanavisto</b>, then click a network to see its measured lengths and parts.</p>
      <div class="button-row duct-primary"><button class="btn primary duct-hl-tulo" data-duct-action="highlight-tulo">Highlight Tulo</button><button class="btn primary duct-hl-poisto" data-duct-action="highlight-poisto">Highlight Poisto</button></div>
      <div class="button-row"><button class="btn small" data-duct-action="rescan">Rescan drawing</button><button class="btn small" data-duct-action="review-uncertain">Review uncertain connections</button></div>
      <div class="button-row"><button class="btn small" data-duct-action="fit-highlighted">Fit highlighted</button><button class="btn small ghost" data-duct-action="clear-highlight">Clear highlight</button></div>
      <div class="toggle-grid"><label><input type="checkbox" data-duct-toggle="showOnly"> Show highlighted only</label><label><input type="checkbox" data-duct-toggle="dimOthers"> Dim other systems</label><label><input type="checkbox" data-duct-view="showUR" checked> Show UR boundaries</label><label><input type="checkbox" data-duct-view="showSuggested" checked> Show suggested geometry</label><label><input type="checkbox" data-duct-view="showLabels" checked> Show labels</label><label><input type="checkbox" data-duct-view="verifiedOnly"> Verified only</label></div>
      <div id="ductHighlightFeedback" class="selection-feedback" aria-live="polite">Highlight Tulo or Poisto to begin.</div>
      <div class="duct-legend" aria-label="Duct system legend"><span class="tulo">━ Tulo / Supply</span><span class="poisto">┅ Poisto / Extract</span><span class="verified">solid = Verified</span><span class="suggested">dashed = Suggested</span></div>
      <details class="duct-advanced"><summary>Correction tools (advanced)</summary>
        <label class="field"><span class="label">System type for new network</span><select id="ductSeedSystem" class="select">${SYSTEM_OPTIONS.map((option) => `<option value="${option.value}"${option.value === 'supply' ? ' selected' : ''}>${option.label}</option>`).join('')}</select></label>
        <label class="field"><span class="label">Duct size for new / corrected segment</span><input id="ductSize" class="input" value="500x200" placeholder="500x200 or Ø160"></label>
        <div class="button-row"><button class="btn small" data-duct-action="select-system">Seed a network (click drawing)</button><button class="btn small" data-duct-action="load-demo">Load demo system</button></div>
        <div id="ductSeedInstructions" class="callout hidden"></div>
      </details>
    </div>`;

  const reviewPanel = document.createElement('section');
  reviewPanel.className = 'panel duct-review-panel';
  reviewPanel.innerHTML = `
    <div class="panel-header"><h2>Duct network review</h2><span id="ductReviewBadge" class="badge">0</span></div>
    <div class="panel-body">
      <div id="ductNetworkList" class="item-list"></div>
      <div id="ductSelectedEditor" class="duct-editor"></div>
      <h3>Network parts</h3>
      <div id="ductPartsList" class="item-list"></div>
      <h3>Catalogue</h3>
      <div id="ductCatalogueList" class="duct-catalogue"></div>
    </div>`;

  // Insert control panel after the airflow panel; review before the detected-labels panel.
  const airflowPanel = leftHost.querySelector('.airflow-panel');
  if (airflowPanel && airflowPanel.nextSibling) leftHost.insertBefore(controlPanel, airflowPanel.nextSibling); else leftHost.append(controlPanel);
  rightHost.append(reviewPanel);

  const byId = <T extends HTMLElement>(id: string): T => { const element = document.getElementById(id); if (!element) throw new Error(`Missing #${id}`); return element as T; };
  const seedSystem = byId<HTMLSelectElement>('ductSeedSystem');
  const sizeInput = byId<HTMLInputElement>('ductSize');
  const seedInstructions = byId<HTMLDivElement>('ductSeedInstructions');
  const highlightFeedback = byId<HTMLDivElement>('ductHighlightFeedback');

  // --- Helpers ------------------------------------------------------------
  function project(): ProjectData { return context.getProject(); }
  function selectedNetwork(): DuctNetwork | undefined { return project().ductNetworks.find((network) => network.id === selectedNetworkId); }
  function selectedSegment(): DuctSegment | undefined { return project().ductSegments.find((segment) => segment.id === selectedSegmentId); }
  function selectedNode(): DuctNode | undefined { return project().ductNodes.find((node) => node.id === selectedNodeId); }

  function inferSystem(seed: Point): DuctSystemType {
    const page = context.getPage();
    const near = project().airflowMarkers.filter((marker) => marker.pageNumber === page && marker.verificationStatus === 'verified' && Math.hypot(marker.tip.x - seed.x, marker.tip.y - seed.y) <= 160);
    const supply = near.filter((marker) => marker.classification === 'supply').length;
    const extract = near.filter((marker) => marker.classification === 'extract').length;
    if (supply || extract) return supply >= extract ? 'supply' : 'extract';
    return 'unknown';
  }

  function currentProfile() { return profileFromSizeText(sizeInput.value); }

  function reindexNodes(network: DuctNetwork): void {
    // Replace previously-suggested nodes with freshly derived ones; keep verified nodes.
    const kept = networkNodes(project(), network).filter((node) => node.verificationStatus === 'verified');
    const keptIds = new Set(kept.map((node) => node.id));
    project().ductNodes = project().ductNodes.filter((node) => node.networkId !== network.id || keptIds.has(node.id));
    const derived = deriveSuggestedNodes(project(), network);
    project().ductNodes.push(...derived);
    network.nodeIds = [...keptIds, ...derived.map((node) => node.id)];
    touch(network);
  }

  async function runAssistedTrace(seed: Point, network: DuctNetwork): Promise<void> {
    if (context.isMobile()) { context.status('Assisted whole-drawing tracing is disabled on mobile. Trace centrelines manually.'); return; }
    tracing = true; progressCancelled = false;
    context.status('Reading cached vector geometry for assisted tracing…');
    let lines: TraceLine[] = [];
    try { lines = await context.getCachedLines(); } catch { lines = []; }
    if (progressCancelled) { tracing = false; return; }
    const result = traceFromSeed(lines, seed, { radius: 360, gapTolerance: 4, maxSegments: 200 });
    const mm = context.getMmPerPdfPoint();
    const profile = currentProfile();
    let added = 0;
    // Process candidate polylines in batches so pan/zoom stay responsive.
    for (let index = 0; index < result.polylines.length; index += 1) {
      if (progressCancelled) break;
      const polyline = result.polylines[index];
      const segment = createSegment(network.pageNumber, polyline, mm, profile, 'vector-detected');
      segment.networkId = network.id; project().ductSegments.push(segment); network.segmentIds.push(segment.id); added += 1;
      if (index % 20 === 0) { context.status(`Assisted trace: ${index + 1}/${result.polylines.length} candidate centrelines…`); await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); }
    }
    tracing = false;
    if (added) { reindexNodes(network); context.markChanged(); }
    if (!added) context.status(`No confident duct centrelines were found near the seed. Trace this system manually. ${result.branchPoints.length} ambiguous junction(s) noted.`);
    else context.status(`Suggested ${added} centreline segment(s). ${result.branchPoints.length} ambiguous junction(s) need review. Confirm, disconnect, or extend.`);
  }

  // --- Actions ------------------------------------------------------------
  function beginSeed(): void {
    if (!context.hasPdf()) { context.toast('Upload a PDF first'); return; }
    context.setTool('network-seed');
    seedInstructions.classList.remove('hidden');
    seedInstructions.textContent = 'Click one visible duct segment, size label, or terminal branch as the seed of the network.';
    context.status('Select duct system: click a seed point on the drawing.');
  }

  function beginTrace(): void {
    if (!context.hasPdf()) { context.toast('Upload a PDF first'); return; }
    if (!selectedNetwork()) { context.toast('Select or create a duct network first'); return; }
    traceDraft = []; context.setTool('network-trace');
    seedInstructions.classList.remove('hidden');
    seedInstructions.textContent = 'Trace the missing centreline: click points along the duct. Enter or double-click finishes; Escape cancels.';
    context.status('Trace centreline: click centreline points, then Enter to finish.');
  }

  async function placeSeed(seed: Point): Promise<void> {
    const chosen = seedSystem.value as DuctSystemType | 'infer';
    const systemType = chosen === 'infer' ? inferSystem(seed) : chosen;
    const label = systemTypeToLabel(systemType);
    const network = createNetwork(context.getPage(), systemType, `${label.split(' / ')[0]} network ${project().ductNetworks.length + 1}`, 'assisted-vector');
    project().ductNetworks.push(network);
    selectedNetworkId = network.id; selectedSegmentId = null; selectedNodeId = null;
    context.setTool('pan');
    seedInstructions.classList.add('hidden');
    context.markChanged();
    context.toast(`Started ${label} network${chosen === 'infer' ? ' (inferred)' : ''}`);
    await runAssistedTrace(seed, network);
    context.markChanged();
  }

  function commitTrace(): void {
    const network = selectedNetwork();
    if (!network || traceDraft.length < 2) { traceDraft = []; context.setTool('pan'); context.requestOverlay(); return; }
    const segment = createSegment(network.pageNumber, [...traceDraft], context.getMmPerPdfPoint(), currentProfile(), 'manual');
    segment.networkId = network.id; project().ductSegments.push(segment); network.segmentIds.push(segment.id);
    if (network.source === 'assisted-vector') network.source = 'mixed';
    traceDraft = []; selectedSegmentId = segment.id; context.setTool('pan'); touch(network); context.markChanged();
    context.toast('Centreline segment added to network');
  }

  function setHighlight(scope: 'tulo' | 'poisto' | 'selected' | 'none', active: boolean): void {
    const highlight = project().ductHighlight;
    highlight.active = active; highlight.scope = active ? scope : 'none';
    highlight.selectedNetworkId = scope === 'selected' ? selectedNetworkId : highlight.selectedNetworkId;
    if (scope === 'tulo' || scope === 'poisto') {
      const summary = highlightSummary(project(), scope, context.getPage());
      highlightFeedback.textContent = summary.text;
      highlightFeedback.classList.toggle('empty', summary.networks === 0);
      context.status(summary.text);
      if (!summary.networks) context.toast(summary.text);
    } else if (scope === 'selected') {
      const network = selectedNetwork();
      highlightFeedback.textContent = network ? `Highlighting ${network.name}.` : 'Select a network to highlight it.';
      highlightFeedback.classList.toggle('empty', !network);
    } else {
      highlightFeedback.textContent = 'No duct highlighting active.'; highlightFeedback.classList.remove('empty');
    }
    context.markChanged();
  }

  function fitHighlighted(): void {
    const networks = highlightedNetworks();
    const points = networks.flatMap((network) => networkSegments(project(), network).flatMap((segment) => segment.centrelinePoints));
    if (!points.length) { context.toast('Nothing highlighted to fit'); return; }
    context.fitToPoints(points);
  }

  function fitNetwork(): void {
    const network = selectedNetwork(); if (!network) return;
    const points = networkSegments(project(), network).flatMap((segment) => segment.centrelinePoints);
    if (points.length) context.fitToPoints(points);
  }

  function cycleNetwork(direction: 1 | -1): void {
    const page = context.getPage();
    const onPage = project().ductNetworks.filter((network) => network.pageNumber === page);
    if (!onPage.length) return;
    const index = onPage.findIndex((network) => network.id === selectedNetworkId);
    const next = onPage[(index + direction + onPage.length) % onPage.length] ?? onPage[0];
    selectedNetworkId = next.id; selectedSegmentId = null; selectedNodeId = null; selectedBoundaryId = null;
    project().ductHighlight.selectedNetworkId = next.id;
    fitNetwork(); context.markChanged();
  }

  function verifyNetwork(): void {
    const network = selectedNetwork(); if (!network) return;
    network.verificationStatus = 'verified';
    networkSegments(project(), network).forEach((segment) => { segment.verificationStatus = 'verified'; });
    networkNodes(project(), network).forEach((node) => { node.verificationStatus = 'verified'; });
    touch(network); context.markChanged(); context.toast(`${network.name} verified`);
  }

  function removeSelectedSegment(): void {
    const segment = selectedSegment(); if (!segment) return;
    const network = networkForSegment(project(), segment.id);
    project().ductSegments = project().ductSegments.filter((item) => item.id !== segment.id);
    if (network) { network.segmentIds = network.segmentIds.filter((id) => id !== segment.id); touch(network); }
    selectedSegmentId = null; context.markChanged(); context.toast('Segment removed from network');
  }

  function markNode(type: DuctNode['type'], direction?: 'up' | 'down'): void {
    const network = selectedNetwork(); if (!network) { context.toast('Select a network first'); return; }
    const node = selectedNode();
    if (node) {
      node.type = type; if (direction) node.direction = direction; if (type !== 'continuation') node.direction = undefined;
      node.verificationStatus = 'verified'; touch(network); context.markChanged(); context.toast(`Marked ${type}${direction ? ` ${direction === 'up' ? 'YLÖS' : 'ALAS'}` : ''}`); return;
    }
    const segment = selectedSegment();
    const point = segment ? segment.centrelinePoints[segment.centrelinePoints.length - 1] : null;
    if (!point) { context.toast('Select a fitting node or a segment endpoint first'); return; }
    const created: DuctNode = { id: uid('dnode'), pageNumber: network.pageNumber, networkId: network.id, point, type, direction, incomingProfile: segment?.profile, outgoingProfile: segment?.profile, relatedLabelIds: [], verificationStatus: 'verified' };
    project().ductNodes.push(created); network.nodeIds.push(created.id); selectedNodeId = created.id; touch(network); context.markChanged(); context.toast(`Added ${type} fitting`);
  }

  function removeSelectedNode(): void {
    const node = selectedNode(); if (!node) { context.toast('Select a fitting node first'); return; }
    const network = project().ductNetworks.find((item) => item.id === node.networkId);
    project().ductNodes = project().ductNodes.filter((item) => item.id !== node.id);
    if (network) { network.nodeIds = network.nodeIds.filter((id) => id !== node.id); touch(network); }
    selectedNodeId = null; context.markChanged(); context.toast('Fitting removed (connection broken)');
  }

  function setSegmentSize(): void {
    const segment = selectedSegment(); if (!segment) { context.toast('Select a segment first'); return; }
    const profile = currentProfile(); if (!profile) { context.toast('Enter a size like 500x200 or Ø160'); return; }
    segment.profile = profile; context.markChanged(); context.toast(`Segment size set to ${profileLabel(profile)}`);
  }

  function changeSystemType(type: DuctSystemType): void {
    const network = selectedNetwork(); if (!network) return;
    network.systemType = type; touch(network); context.markChanged();
  }

  function setNodeVerticalLength(): void {
    const node = selectedNode(); if (!node || node.type !== 'continuation') return;
    const raw = window.prompt('Enter confirmed vertical length in mm (leave blank to keep unknown):', node.verticalLengthMm ? String(node.verticalLengthMm) : '');
    if (raw === null) return;
    const value = Number(raw.trim());
    if (raw.trim() === '' ) { node.verticalLengthMm = undefined; node.confirmedVerticalLength = false; context.toast('Vertical length cleared (kept unknown)'); }
    else if (Number.isFinite(value) && value > 0) { node.verticalLengthMm = value; node.confirmedVerticalLength = true; context.toast(`Vertical length ${value} mm confirmed — now counted`); }
    else { context.toast('Enter a positive number of millimetres'); return; }
    context.markChanged();
  }

  function loadDemo(): void {
    const fixture = createDemoDuctNetwork(context.getPage());
    project().ductNetworks.push(fixture.network);
    project().ductSegments.push(...fixture.segments);
    project().ductNodes.push(...fixture.nodes);
    project().ductLabels.push(...fixture.labels);
    project().contractBoundaries.push(...fixture.boundaries);
    selectedNetworkId = fixture.network.id; selectedSegmentId = null; selectedNodeId = null;
    context.markChanged(); context.toast('Demo Tulo duct system loaded');
    context.fitToPoints(fixture.segments.flatMap((segment) => segment.centrelinePoints));
  }

  function rescan(): void {
    if (!context.hasPdf() && !project().routes.length && !project().ductNetworks.length) { context.toast('Upload a PDF or load the demo first'); return; }
    const result = autoDetectNetworks(project(), context.getPage(), context.getMmPerPdfPoint());
    if (result.networks) {
      context.markChanged();
      context.toast(`Rescan: ${result.networks} network(s) from ${result.convertedRoutes} traced route(s)`);
      context.status(`Rescan detected ${result.networks} network(s), ${result.segments} section(s) from existing traced routes on this page.`);
    } else if (project().ductNetworks.some((network) => network.pageNumber === context.getPage())) {
      context.status('Rescan complete. Existing networks are up to date; use the correction tools to add or fix sections.');
      context.toast('Rescan complete — existing networks kept');
    } else {
      context.status('Rescan found no traced routes or detectable networks on this page. Seed a network or load the demo.');
      context.toast('No detectable networks on this page');
    }
  }

  function reviewUncertain(): void {
    const page = context.getPage();
    const uncertain = project().ductNodes.filter((node) => node.pageNumber === page && (node.type === 'unknown' || (node.type === 'end' && node.verificationStatus === 'suggested')));
    const boundaries = project().contractBoundaries.filter((boundary) => boundary.pageNumber === page && boundary.scopeSide === 'unknown');
    if (!uncertain.length && !boundaries.length) { context.status('No uncertain connections or undecided UR boundaries on this page.'); context.toast('No uncertain connections to review'); return; }
    const target = uncertain[0]?.point ?? boundaries[0]?.point;
    if (uncertain[0]) { selectedNodeId = uncertain[0].id; selectedNetworkId = uncertain[0].networkId ?? selectedNetworkId; }
    else if (boundaries[0]) { selectedBoundaryId = boundaries[0].id; selectedNetworkId = boundaries[0].relatedNetworkId ?? selectedNetworkId; }
    if (target) context.fitToPoints([target]);
    context.status(`${uncertain.length} uncertain connection(s) and ${boundaries.length} undecided UR boundary(ies) to review.`);
    context.markChanged();
  }

  function markUR(): void {
    const network = selectedNetwork(); const segment = selectedSegment();
    if (!network) { context.toast('Select a network first'); return; }
    const point = segment ? segment.centrelinePoints[segment.centrelinePoints.length - 1] : selectedNode()?.point;
    if (!point) { context.toast('Select a segment or fitting where the UR boundary sits'); return; }
    const boundary = createContractBoundary(network.pageNumber, point, network.id, segment?.id);
    boundary.verificationStatus = 'verified';
    project().contractBoundaries.push(boundary); selectedBoundaryId = boundary.id;
    context.markChanged(); context.toast('UR / urakkaraja boundary added — set the project side');
  }

  function setProjectSide(boundaryId: string, side: ContractScopeSide): void {
    const boundary = project().contractBoundaries.find((item) => item.id === boundaryId); if (!boundary) return;
    boundary.scopeSide = side; boundary.verificationStatus = 'verified';
    context.markChanged();
    const message = side === 'both' ? 'Counting both sides of UR.' : side === 'unknown' ? 'UR left undecided.' : `Counting ${side} the UR boundary; the other side is excluded.`;
    context.toast(message);
  }

  function highlightedNetworks(): DuctNetwork[] {
    const highlight = project().ductHighlight; const page = context.getPage();
    const onPage = project().ductNetworks.filter((network) => network.pageNumber === page);
    if (!highlight.active) return onPage;
    if (highlight.scope === 'tulo') return networksOfKind(project(), 'tulo').filter((network) => network.pageNumber === page);
    if (highlight.scope === 'poisto') return networksOfKind(project(), 'poisto').filter((network) => network.pageNumber === page);
    if (highlight.scope === 'selected') return onPage.filter((network) => network.id === (highlight.selectedNetworkId ?? selectedNetworkId));
    return onPage;
  }

  function rejectPart(networkId: string, key: string): void {
    const bare = key.replace(`${networkId}|`, '');
    const existing = project().ductPartMappings.find((mapping) => mapping.networkId === networkId && mapping.fittingKey === bare);
    if (existing) { project().ductPartMappings = project().ductPartMappings.filter((mapping) => mapping !== existing); context.toast('Part restored to totals'); }
    else { project().ductPartMappings.push({ id: uid('dmap'), networkId, fittingKey: bare, catalogueId: '', status: 'rejected', notes: '' }); context.toast('Part rejected — excluded from totals'); }
    context.markChanged();
  }

  // --- Rendering ----------------------------------------------------------
  function render(): void {
    const data = project();
    byId('ductNetCount').textContent = `${data.ductNetworks.length} network${data.ductNetworks.length === 1 ? '' : 's'}`;
    controlPanel.querySelectorAll<HTMLInputElement>('[data-duct-toggle]').forEach((input) => { input.checked = Boolean(data.ductHighlight[input.dataset.ductToggle as 'showOnly' | 'dimOthers']); });
    controlPanel.querySelectorAll<HTMLInputElement>('[data-duct-view]').forEach((input) => { input.checked = Boolean(view[input.dataset.ductView as keyof typeof view]); });

    const list = byId<HTMLDivElement>('ductNetworkList');
    const networks = data.ductNetworks;
    byId('ductReviewBadge').textContent = String(networks.length);
    list.innerHTML = networks.length ? networks.map((network) => {
      const totals = networkTotals(data, network);
      const selected = network.id === selectedNetworkId;
      return `<button class="item-card selectable ${selected ? 'selected' : ''}" data-duct-network="${network.id}" style="border-left:4px solid ${systemColor(network.systemType)}"><span><b>${escapeHtml(network.name)}</b><small>${escapeHtml(systemTypeToLabel(network.systemType))} · ${network.verificationStatus} · ${totals.segments} seg · ${totals.lengthM.toFixed(2)} m · Page ${network.pageNumber}</small></span></button>`;
    }).join('') : '<div class="empty-mini">No duct systems yet. Load the demo or select a seed on the drawing.</div>';

    renderEditor();
    renderParts();
    renderCatalogue();
  }

  function renderEditor(): void {
    const editor = byId<HTMLDivElement>('ductSelectedEditor');
    const network = selectedNetwork();
    if (!network) { editor.innerHTML = '<div class="empty-mini">Highlight Tulo or Poisto, then click a highlighted network to inspect its lengths and parts.</div>'; return; }
    const segment = selectedSegment(); const node = selectedNode();
    const segments = networkSegments(project(), network);
    const nodes = networkNodes(project(), network);
    const counts = networkCounts(project(), network);
    const boundaries = boundariesForNetwork(project(), network);
    const kind = network.systemType === 'supply' ? 'tulo' : (network.systemType === 'extract' || network.systemType === 'exhaust') ? 'poisto' : 'other';
    const labelSummary = project().ductLabels.filter((label) => network.segmentIds.includes(label.segmentId ?? '') || network.nodeIds.includes(label.nodeId ?? '')).map((label) => label.normalized);
    editor.innerHTML = `
      <div class="duct-editor-head"><b>${escapeHtml(network.name)}</b><span>${escapeHtml(systemTypeToLabel(network.systemType))} · ${network.verificationStatus} · ${network.source}</span></div>
      <div class="duct-counts">
        <div><b>${counts.lengthM.toFixed(2)} m</b><span>Horizontal</span></div>
        <div><b>${counts.verticalConfirmedM.toFixed(2)} m</b><span>Vertical (conf.)</span></div>
        <div><b>${counts.segments}</b><span>Sections</span></div>
        <div><b>${counts.bends}</b><span>Bends</span></div>
        <div><b>${counts.transitions}</b><span>Muunto</span></div>
        <div><b>${counts.branches}</b><span>Branches</span></div>
        <div><b>${counts.terminals}</b><span>Terminals</span></div>
        <div><b>${counts.ur}</b><span>UR</span></div>
        <div class="${counts.unresolved ? 'warn' : ''}"><b>${counts.unresolved}</b><span>Unresolved</span></div>
      </div>
      ${labelSummary.length ? `<div class="duct-labels-line">Labels: ${labelSummary.map((text) => `<span>${escapeHtml(text)}</span>`).join(' ')}</div>` : ''}
      <div class="button-row"><button class="btn small ${kind === 'tulo' ? 'primary' : ''}" data-duct-action="highlight-selected">Highlight this</button><button class="btn small" data-duct-action="fit-network">Fit network</button><button class="btn small" data-duct-action="verify-network">Verify</button></div>
      <div class="button-row"><button class="btn small ghost" data-duct-action="prev-network">◀ Prev</button><button class="btn small ghost" data-duct-action="next-network">Next ▶</button><button class="btn small ghost danger" data-duct-action="delete-network">Delete</button></div>
      <label class="field"><span class="label">Change system (Tulo / Poisto)</span><select data-duct-system class="select">${SYSTEM_OPTIONS.filter((option) => option.value !== 'infer').map((option) => `<option value="${option.value}"${option.value === network.systemType ? ' selected' : ''}>${option.label}</option>`).join('')}</select></label>
      ${boundaries.length ? `<div class="duct-ur-block"><div class="duct-subhead">UR contract boundaries</div>${boundaries.map((boundary) => `<div class="duct-ur-row"><span>${escapeHtml(boundary.notes || 'UR boundary')} · <b>${boundary.scopeSide}</b></span><select data-duct-scope="${boundary.id}" class="select compact"><option value="unknown"${boundary.scopeSide === 'unknown' ? ' selected' : ''}>Undecided</option><option value="after"${boundary.scopeSide === 'after' ? ' selected' : ''}>Count after UR</option><option value="before"${boundary.scopeSide === 'before' ? ' selected' : ''}>Count before UR</option><option value="both"${boundary.scopeSide === 'both' ? ' selected' : ''}>Count both</option></select></div>`).join('')}</div>` : ''}
      <details class="duct-advanced"><summary>Correct this network</summary>
        <div class="duct-subitems">
          <div class="duct-subhead">Sections (${segments.length})</div>
          ${segments.map((item) => `<button class="duct-chip ${item.id === selectedSegmentId ? 'active' : ''}" data-duct-segment="${item.id}">${escapeHtml(profileLabel(item.profile))} · ${(item.lengthMm / 1000).toFixed(2)} m · ${item.verificationStatus}</button>`).join('') || '<span class="empty-mini">No sections.</span>'}
          <div class="duct-subhead">Fittings (${nodes.length})</div>
          ${nodes.map((item) => `<button class="duct-chip ${item.id === selectedNodeId ? 'active' : ''}" data-duct-node="${item.id}">${escapeHtml(nodeLabel(item))}</button>`).join('') || '<span class="empty-mini">No fittings.</span>'}
        </div>
        <div class="duct-tool-row"><button class="btn small" data-duct-action="add-segment">Add missing section</button><button class="btn small" data-duct-action="auto-fittings">Auto-detect fittings</button></div>
        ${segment ? `<div class="duct-tool-row"><button class="btn small" data-duct-action="set-size">Set size (${escapeHtml(sizeInput.value)})</button><button class="btn small ghost danger" data-duct-action="remove-segment">Remove section</button></div>` : ''}
        <div class="duct-tool-row"><button class="btn small" data-duct-action="mark-bend">Mark bend</button><button class="btn small" data-duct-action="mark-branch">Mark branch</button><button class="btn small" data-duct-action="mark-transition">Mark Muunto</button></div>
        <div class="duct-tool-row"><button class="btn small" data-duct-action="mark-terminal">Mark terminal</button><button class="btn small" data-duct-action="mark-ylos">Mark YLÖS</button><button class="btn small" data-duct-action="mark-alas">Mark ALAS</button></div>
        <div class="duct-tool-row"><button class="btn small" data-duct-action="mark-ur">Mark UR</button><button class="btn small ghost" data-duct-action="remove-node">Break connection</button></div>
        ${node && node.type === 'continuation' ? `<div class="duct-tool-row"><button class="btn small" data-duct-action="vertical-length">${node.confirmedVerticalLength ? `Vertical ${node.verticalLengthMm} mm ✓` : 'Enter vertical length…'}</button></div><p class="help">${node.confirmedVerticalLength ? 'Confirmed vertical length is counted.' : 'No vertical length shown — not counted until confirmed.'}</p>` : ''}
        <label class="field"><span class="label">Notes</span><input class="input" data-duct-notes value="${escapeHtml(network.notes)}" placeholder="Network notes"></label>
      </details>`;
  }

  function nodeLabel(node: DuctNode): string {
    if (node.type === 'bend') return `Bend ${node.angleDeg ?? 90}°`;
    if (node.type === 'transition') return `Muunto ${profileLabel(node.incomingProfile)}→${profileLabel(node.outgoingProfile)}`;
    if (node.type === 'branch') return `Branch ${profileLabel(node.outgoingProfile)}`;
    if (node.type === 'terminal') return `Terminal ${profileLabel(node.incomingProfile)}`;
    if (node.type === 'continuation') return `${node.direction === 'up' ? 'YLÖS' : node.direction === 'down' ? 'ALAS' : 'Riser'} ${profileLabel(node.incomingProfile)}`;
    return `${node.type}`;
  }

  function renderParts(): void {
    const listElement = byId<HTMLDivElement>('ductPartsList');
    const network = selectedNetwork();
    if (!network) { listElement.innerHTML = '<div class="empty-mini">Select a network to see its parts.</div>'; return; }
    const rows = countNetworkParts(project(), network);
    const rejected = project().ductPartMappings.filter((mapping) => mapping.networkId === network.id && mapping.status === 'rejected');
    listElement.innerHTML = (rows.length ? rows.map((row) => `<div class="summary-row"><b>${escapeHtml(row.label)}</b><span>${escapeHtml(row.category)} · ${escapeHtml(row.status)}${row.lengthM !== undefined ? ` · ${row.lengthM.toFixed(2)} m` : ''}</span><strong>${row.quantity}×</strong><button class="btn small ghost danger duct-reject" data-duct-reject="${escapeHtml(row.key)}" data-duct-reject-net="${network.id}">Reject</button></div>`).join('') : '<div class="empty-mini">No parts derived yet.</div>')
      + (rejected.length ? `<div class="duct-rejected">${rejected.length} rejected item(s): ${rejected.map((mapping) => `<button class="btn small ghost" data-duct-restore="${escapeHtml(mapping.fittingKey)}" data-duct-restore-net="${network.id}">${escapeHtml(mapping.fittingKey)}</button>`).join(' ')}</div>` : '');
  }

  function renderCatalogue(): void {
    const listElement = byId<HTMLDivElement>('ductCatalogueList');
    const catalogue = mergedCatalogue(project().customCatalogue, project().disabledCatalogueIds);
    listElement.innerHTML = `<div class="button-row"><button class="btn small" data-duct-action="add-catalogue">Add custom catalogue item</button></div>`
      + catalogue.slice(0, 60).map((entry) => `<label class="duct-cat-row ${entry.disabled ? 'disabled' : ''}"><input type="checkbox" data-duct-catalogue="${entry.id}" ${entry.disabled ? '' : 'checked'}><span>${escapeHtml(entry.names.fi)} / ${escapeHtml(entry.names.en)}<small>${escapeHtml(entry.category)} · ${escapeHtml(entry.shape)}${entry.builtin ? '' : ' · custom'}</small></span></label>`).join('');
  }

  // --- Overlay drawing ----------------------------------------------------
  function draw(context2d: CanvasRenderingContext2D, renderScale: number): void {
    const data = project(); const page = context.getPage(); const highlight = data.ductHighlight;
    const highlighted = new Set(highlightedNetworks().map((network) => network.id));
    data.ductNetworks.filter((network) => network.pageNumber === page).forEach((network) => {
      if (view.verifiedOnly && network.verificationStatus !== 'verified') return;
      const isHighlighted = !highlight.active || highlighted.has(network.id);
      if (highlight.active && highlight.showOnly && !isHighlighted) return;
      const dim = highlight.active && highlight.dimOthers && !isHighlighted;
      drawNetwork(context2d, renderScale, network, dim);
    });
    if (view.showUR) data.contractBoundaries.filter((boundary) => boundary.pageNumber === page).forEach((boundary) => drawBoundary(context2d, renderScale, boundary));
    // Manual trace draft
    if (traceDraft.length) {
      context2d.save(); context2d.strokeStyle = '#8ee3c2'; context2d.lineWidth = 3; context2d.setLineDash([8, 6]); context2d.beginPath();
      traceDraft.forEach((point, index) => index ? context2d.lineTo(point.x * renderScale, point.y * renderScale) : context2d.moveTo(point.x * renderScale, point.y * renderScale));
      context2d.stroke(); context2d.restore();
    }
  }

  function drawNetwork(context2d: CanvasRenderingContext2D, renderScale: number, network: DuctNetwork, dim: boolean): void {
    const color = systemColor(network.systemType);
    const verified = network.verificationStatus === 'verified';
    const selected = network.id === selectedNetworkId;
    const alpha = dim ? 0.22 : 1;
    const extract = network.systemType === 'extract' || network.systemType === 'exhaust';
    const excluded = excludedSegmentIds(project(), network);
    networkSegments(project(), network).forEach((segment) => {
      if (!view.showSuggested && segment.verificationStatus === 'suggested' && !verified) return;
      const points = segment.centrelinePoints; if (points.length < 2) return;
      const outOfScope = excluded.has(segment.id);
      const segSelected = segment.id === selectedSegmentId;
      context2d.save(); context2d.globalAlpha = outOfScope ? alpha * 0.4 : alpha;
      // Halo
      context2d.beginPath(); points.forEach((point, index) => index ? context2d.lineTo(point.x * renderScale, point.y * renderScale) : context2d.moveTo(point.x * renderScale, point.y * renderScale));
      context2d.strokeStyle = 'rgba(3,10,16,.75)'; context2d.lineWidth = (segSelected ? 12 : 9); context2d.lineJoin = 'round'; context2d.lineCap = 'round'; context2d.stroke();
      // Main stroke: solid when verified, dashed when suggested; extract uses a distinct dash pattern.
      context2d.beginPath(); points.forEach((point, index) => index ? context2d.lineTo(point.x * renderScale, point.y * renderScale) : context2d.moveTo(point.x * renderScale, point.y * renderScale));
      context2d.strokeStyle = outOfScope ? '#8fa1b3' : segSelected ? '#ffe08a' : selected ? '#ffffff' : color; context2d.lineWidth = segSelected ? 6 : 4;
      context2d.setLineDash(outOfScope ? [3, 4] : verified ? (extract ? [] : []) : extract ? [10, 6] : [6, 5]);
      if (extract && verified && !outOfScope) context2d.setLineDash([14, 4, 3, 4]);
      context2d.stroke(); context2d.restore();
    });
    networkNodes(project(), network).forEach((node) => drawNode(context2d, renderScale, node, color, alpha));
    // Network badge at first in-scope segment midpoint.
    const first = networkSegments(project(), network).find((segment) => !excluded.has(segment.id)) ?? networkSegments(project(), network)[0];
    if (view.showLabels && first && first.centrelinePoints.length) {
      const anchor = first.centrelinePoints[Math.floor(first.centrelinePoints.length / 2)];
      context2d.save(); context2d.globalAlpha = alpha; context2d.font = '700 11px system-ui';
      const text = `${network.systemType === 'supply' ? 'Tulo' : extract ? 'Poisto' : 'Muu'} · ${network.name}`;
      const width = context2d.measureText(text).width + 12;
      context2d.fillStyle = 'rgba(6,14,22,.9)'; context2d.fillRect(anchor.x * renderScale - width / 2, anchor.y * renderScale - 30, width, 18);
      context2d.fillStyle = color; context2d.fillText(text, anchor.x * renderScale - width / 2 + 6, anchor.y * renderScale - 17); context2d.restore();
    }
  }

  function drawNode(context2d: CanvasRenderingContext2D, renderScale: number, node: DuctNode, color: string, alpha: number): void {
    const x = node.point.x * renderScale; const y = node.point.y * renderScale;
    const active = node.id === selectedNodeId;
    context2d.save(); context2d.globalAlpha = alpha; context2d.lineWidth = active ? 3 : 2;
    context2d.strokeStyle = active ? '#ffe08a' : '#eef7ff'; context2d.fillStyle = color;
    if (node.type === 'bend') { context2d.beginPath(); context2d.arc(x, y, 6, 0, Math.PI * 2); context2d.fill(); context2d.stroke(); }
    else if (node.type === 'transition') { context2d.beginPath(); context2d.moveTo(x - 8, y - 6); context2d.lineTo(x + 8, y - 3); context2d.lineTo(x + 8, y + 3); context2d.lineTo(x - 8, y + 6); context2d.closePath(); context2d.fill(); context2d.stroke(); }
    else if (node.type === 'branch') { context2d.beginPath(); context2d.moveTo(x, y - 7); context2d.lineTo(x + 7, y + 6); context2d.lineTo(x - 7, y + 6); context2d.closePath(); context2d.fill(); context2d.stroke(); }
    else if (node.type === 'terminal') { context2d.beginPath(); context2d.rect(x - 6, y - 6, 12, 12); context2d.fill(); context2d.stroke(); }
    else if (node.type === 'continuation') {
      context2d.beginPath(); context2d.arc(x, y, 8, 0, Math.PI * 2); context2d.fillStyle = 'rgba(6,14,22,.9)'; context2d.fill(); context2d.stroke();
      context2d.fillStyle = active ? '#ffe08a' : color; context2d.font = '700 11px system-ui'; context2d.textAlign = 'center'; context2d.textBaseline = 'middle';
      context2d.fillText(node.direction === 'up' ? '▲' : '▼', x, y);
    }
    else { context2d.beginPath(); context2d.arc(x, y, 4, 0, Math.PI * 2); context2d.fill(); }
    context2d.restore();
  }

  function drawBoundary(context2d: CanvasRenderingContext2D, renderScale: number, boundary: ContractBoundary): void {
    const x = boundary.point.x * renderScale; const y = boundary.point.y * renderScale;
    const active = boundary.id === selectedBoundaryId;
    context2d.save();
    context2d.strokeStyle = active ? '#ffe08a' : '#ff5d6c'; context2d.lineWidth = active ? 4 : 3; context2d.setLineDash([]);
    context2d.beginPath(); context2d.moveTo(x, y - 12); context2d.lineTo(x, y + 12); context2d.stroke();
    context2d.setLineDash([3, 3]); context2d.beginPath(); context2d.moveTo(x - 12, y - 12); context2d.lineTo(x + 12, y + 12); context2d.moveTo(x + 12, y - 12); context2d.lineTo(x - 12, y + 12); context2d.stroke();
    context2d.setLineDash([]); context2d.font = '700 11px system-ui';
    context2d.fillStyle = 'rgba(6,14,22,.9)'; context2d.fillRect(x + 10, y - 20, 26, 16); context2d.fillStyle = '#ff8f9a'; context2d.fillText('UR', x + 14, y - 8);
    context2d.restore();
  }

  // --- Hit testing --------------------------------------------------------
  function distanceToPolyline(point: Point, points: Point[]): number {
    let best = Infinity;
    for (let i = 1; i < points.length; i += 1) {
      const start = points[i - 1]; const end = points[i]; const dx = end.x - start.x; const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
      best = Math.min(best, Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy)));
    }
    return best;
  }

  function hitTest(point: Point, renderScale: number): boolean {
    const page = context.getPage(); const threshold = 10 / renderScale;
    // Prefer UR boundaries, then fitting nodes, then segments/networks.
    const boundary = project().contractBoundaries.filter((item) => item.pageNumber === page).find((item) => Math.hypot(item.point.x - point.x, item.point.y - point.y) <= 14 / renderScale);
    if (boundary) { selectedBoundaryId = boundary.id; selectedNetworkId = boundary.relatedNetworkId ?? selectedNetworkId; selectedSegmentId = null; selectedNodeId = null; context.markChanged(); return true; }
    const node = project().ductNodes.filter((item) => item.pageNumber === page).find((item) => Math.hypot(item.point.x - point.x, item.point.y - point.y) <= 12 / renderScale);
    if (node) { selectedNodeId = node.id; selectedNetworkId = node.networkId ?? selectedNetworkId; selectedSegmentId = null; selectedBoundaryId = null; context.markChanged(); return true; }
    const segment = project().ductSegments.filter((item) => item.pageNumber === page).find((item) => item.centrelinePoints.length >= 2 && distanceToPolyline(point, item.centrelinePoints) <= threshold);
    if (segment) { selectedSegmentId = segment.id; selectedNetworkId = networkForSegment(project(), segment.id)?.id ?? selectedNetworkId; selectedNodeId = null; selectedBoundaryId = null; project().ductHighlight.selectedNetworkId = selectedNetworkId; context.markChanged(); return true; }
    return false;
  }

  // --- Event wiring -------------------------------------------------------
  function handleAction(action: string): void {
    switch (action) {
      case 'highlight-tulo': setHighlight('tulo', true); break;
      case 'highlight-poisto': setHighlight('poisto', true); break;
      case 'highlight-selected': setHighlight('selected', true); break;
      case 'clear-highlight': case 'hide-highlight': setHighlight('none', false); break;
      case 'fit-highlighted': fitHighlighted(); break;
      case 'fit-network': fitNetwork(); break;
      case 'prev-network': cycleNetwork(-1); break;
      case 'next-network': cycleNetwork(1); break;
      case 'rescan': rescan(); break;
      case 'review-uncertain': reviewUncertain(); break;
      case 'mark-ur': markUR(); break;
      case 'mark-terminal': markNode('terminal'); break;
      case 'select-system': beginSeed(); break;
      case 'trace-segment': case 'add-segment': beginTrace(); break;
      case 'auto-fittings': { const network = selectedNetwork(); if (network) { reindexNodes(network); context.markChanged(); context.toast('Fittings re-detected (suggested)'); } else context.toast('Select a network first'); break; }
      case 'load-demo': loadDemo(); break;
      case 'verify-network': verifyNetwork(); break;
      case 'delete-network': { const network = selectedNetwork(); if (network && window.confirm(`Delete ${network.name}?`)) { removeNetwork(project(), network.id); selectedNetworkId = null; selectedSegmentId = null; selectedNodeId = null; context.markChanged(); context.toast('Network deleted'); } break; }
      case 'remove-segment': removeSelectedSegment(); break;
      case 'set-size': setSegmentSize(); break;
      case 'mark-bend': markNode('bend'); break;
      case 'mark-branch': markNode('branch'); break;
      case 'mark-transition': markNode('transition'); break;
      case 'mark-ylos': markNode('continuation', 'up'); break;
      case 'mark-alas': markNode('continuation', 'down'); break;
      case 'remove-node': removeSelectedNode(); break;
      case 'vertical-length': setNodeVerticalLength(); break;
      case 'add-catalogue': addCatalogueItem(); break;
      default: break;
    }
  }

  function addCatalogueItem(): void {
    const name = window.prompt('Custom catalogue item name (English):', 'Custom fabricated fitting'); if (!name) return;
    project().customCatalogue.push({ id: uid('custom-def'), category: 'Custom', shape: 'both', names: { fi: name, en: name }, requiredFields: [], optionalFields: [], aliases: [], disabled: false });
    context.markChanged(); context.toast('Custom catalogue item added');
  }

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-duct-action]')?.dataset.ductAction;
    if (action) { handleAction(action); return; }
    const networkButton = target.closest<HTMLElement>('[data-duct-network]');
    if (networkButton) { selectedNetworkId = networkButton.dataset.ductNetwork ?? null; selectedSegmentId = null; selectedNodeId = null; project().ductHighlight.selectedNetworkId = selectedNetworkId; context.markChanged(); return; }
    const segmentButton = target.closest<HTMLElement>('[data-duct-segment]');
    if (segmentButton) { selectedSegmentId = segmentButton.dataset.ductSegment ?? null; selectedNodeId = null; context.markChanged(); return; }
    const nodeButton = target.closest<HTMLElement>('[data-duct-node]');
    if (nodeButton) { selectedNodeId = nodeButton.dataset.ductNode ?? null; selectedSegmentId = null; context.markChanged(); return; }
    const rejectButton = target.closest<HTMLElement>('[data-duct-reject]');
    if (rejectButton) { rejectPart(rejectButton.dataset.ductRejectNet ?? '', rejectButton.dataset.ductReject ?? ''); return; }
    const restoreButton = target.closest<HTMLElement>('[data-duct-restore]');
    if (restoreButton) { rejectPart(restoreButton.dataset.ductRestoreNet ?? '', restoreButton.dataset.ductRestore ?? ''); return; }
  });

  document.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    const systemSelect = target.closest<HTMLSelectElement>('[data-duct-system]');
    if (systemSelect) { changeSystemType(systemSelect.value as DuctSystemType); return; }
    const scopeSelect = target.closest<HTMLSelectElement>('[data-duct-scope]');
    if (scopeSelect) { setProjectSide(scopeSelect.dataset.ductScope ?? '', scopeSelect.value as ContractScopeSide); return; }
    const toggle = target.closest<HTMLInputElement>('[data-duct-toggle]');
    if (toggle) { const key = toggle.dataset.ductToggle as 'showOnly' | 'dimOthers'; project().ductHighlight[key] = toggle.checked; context.markChanged(); return; }
    const viewToggle = target.closest<HTMLInputElement>('[data-duct-view]');
    if (viewToggle) { const key = viewToggle.dataset.ductView as keyof typeof view; view[key] = viewToggle.checked; context.requestOverlay(); return; }
    const notesInput = target.closest<HTMLInputElement>('[data-duct-notes]');
    if (notesInput) { const network = selectedNetwork(); if (network) { network.notes = notesInput.value; touch(network); context.markChanged(); } return; }
    const catalogue = target.closest<HTMLInputElement>('[data-duct-catalogue]');
    if (catalogue) {
      const id = catalogue.dataset.ductCatalogue ?? ''; const disabled = !catalogue.checked;
      const set = new Set(project().disabledCatalogueIds); if (disabled) set.add(id); else set.delete(id); project().disabledCatalogueIds = [...set];
      context.markChanged(); return;
    }
  });

  return {
    render,
    draw,
    handleCanvasClick(point: Point): boolean {
      const tool = context.getTool();
      if (tool === 'network-seed') { void placeSeed(point); return true; }
      if (tool === 'network-trace') { traceDraft.push(point); context.requestOverlay(); return true; }
      return false;
    },
    handleTraceCommit() { commitTrace(); },
    handleToolChange(tool: Tool) { if (tool !== 'network-trace') { if (traceDraft.length && tool !== 'network-seed') traceDraft = []; } if (tool !== 'network-seed' && tool !== 'network-trace') seedInstructions.classList.add('hidden'); if (tracing && tool === 'pan') progressCancelled = true; },
    hitTest,
    getTraceDraft() { return traceDraft; },
    clearTransient() { traceDraft = []; selectedSegmentId = null; selectedNodeId = null; selectedBoundaryId = null; },
  };
}

export function ensureDuctDefaults(project: ProjectData): void {
  project.ductNetworks ??= [];
  project.ductSegments ??= [];
  project.ductNodes ??= [];
  project.ductLabels ??= [];
  project.ductPartMappings ??= [];
  project.contractBoundaries ??= [];
  project.customCatalogue ??= [];
  project.disabledCatalogueIds ??= [];
  project.ductHighlight ??= { active: false, scope: 'none', showOnly: false, dimOthers: false, selectedNetworkId: null };
  // Keep authored/geometry lengths consistent if segments were traced under a prior calibration.
  void recomputeSegmentLengths; void catalogueName;
}
