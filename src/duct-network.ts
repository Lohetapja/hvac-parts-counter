import type { Point, ProjectData, RouteItem } from './types';
import type {
  ContractBoundary, DuctNetwork, DuctNode, DuctNodeType, DuctProfile, DuctSegment, DuctSystemType, NetworkPartRow,
} from './duct-network-types';
import { isExtractType, isSupplyType, profileLabel, profilesEqual } from './duct-network-types';
import { profileFromSizeText } from './duct-labels';
import { bendCatalogueId } from './duct-catalogue';
import { PDF_POINT_MM } from './measurements';

export function uid(prefix: string): string { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function now(): string { return new Date().toISOString(); }

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function pdfPolylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}

export function segmentLengthMm(points: Point[], mmPerPdfPoint: number): number {
  return pdfPolylineLength(points) * mmPerPdfPoint;
}

function directionAway(points: Point[], fromStart: boolean): Point {
  if (points.length < 2) return { x: 1, y: 0 };
  const a = fromStart ? points[0] : points[points.length - 1];
  const b = fromStart ? points[1] : points[points.length - 2];
  const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function angleBetweenDeg(a: Point, b: Point): number {
  const dot = a.x * b.x + a.y * b.y;
  return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
}

export function classifyBendAngle(deg: number): number {
  return [15, 30, 45, 60, 90].reduce((best, value) => Math.abs(value - deg) < Math.abs(best - deg) ? value : best, 90);
}

// ---------------------------------------------------------------------------
// Project accessors
// ---------------------------------------------------------------------------

export function networkSegments(project: ProjectData, network: DuctNetwork): DuctSegment[] {
  return network.segmentIds.map((id) => project.ductSegments.find((s) => s.id === id)).filter((s): s is DuctSegment => Boolean(s));
}
export function networkNodes(project: ProjectData, network: DuctNetwork): DuctNode[] {
  return network.nodeIds.map((id) => project.ductNodes.find((n) => n.id === id)).filter((n): n is DuctNode => Boolean(n));
}

export function networkForSegment(project: ProjectData, segmentId: string): DuctNetwork | undefined {
  return project.ductNetworks.find((network) => network.segmentIds.includes(segmentId));
}

export function boundariesForNetwork(project: ProjectData, network: DuctNetwork): ContractBoundary[] {
  return project.contractBoundaries.filter((boundary) => boundary.relatedNetworkId === network.id);
}

// Segment adjacency by shared endpoints (used for UR project-side scoping).
function segmentsAdjacent(a: DuctSegment, b: DuctSegment, tolerance = 10): boolean {
  const aEnds = [a.centrelinePoints[0], a.centrelinePoints[a.centrelinePoints.length - 1]];
  const bEnds = [b.centrelinePoints[0], b.centrelinePoints[b.centrelinePoints.length - 1]];
  return aEnds.some((p) => p && bEnds.some((q) => q && Math.hypot(p.x - q.x, p.y - q.y) <= tolerance));
}

function componentFrom(segments: DuctSegment[], startId: string, blockedId: string | undefined): Set<string> {
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined || visited.has(id) || id === blockedId) continue;
    const segment = byId.get(id); if (!segment) continue;
    visited.add(id);
    segments.forEach((other) => { if (other.id !== id && other.id !== blockedId && !visited.has(other.id) && segmentsAdjacent(segment, other)) queue.push(other.id); });
  }
  return visited;
}

// Segments excluded from totals by verified UR contract-boundary project-side decisions.
export function excludedSegmentIds(project: ProjectData, network: DuctNetwork): Set<string> {
  const excluded = new Set<string>();
  const segments = networkSegments(project, network);
  boundariesForNetwork(project, network).forEach((boundary) => {
    if (boundary.scopeSide === 'both' || boundary.scopeSide === 'unknown') return;
    const gate = boundary.relatedSegmentId; if (!gate || !segments.some((segment) => segment.id === gate)) return;
    const root = segments.find((segment) => segment.id !== gate)?.id;
    const beyond = componentFrom(segments, gate, root);
    if (boundary.scopeSide === 'after') beyond.forEach((id) => excluded.add(id));
    else segments.forEach((segment) => { if (!beyond.has(segment.id)) excluded.add(segment.id); });
  });
  return excluded;
}

export function scopedSegments(project: ProjectData, network: DuctNetwork): DuctSegment[] {
  const excluded = excludedSegmentIds(project, network);
  return networkSegments(project, network).filter((segment) => !excluded.has(segment.id));
}

export interface NetworkTotals { segments: number; lengthMm: number; lengthM: number; nodes: number; }
export function networkTotals(project: ProjectData, network: DuctNetwork): NetworkTotals {
  const segments = scopedSegments(project, network);
  const lengthMm = segments.reduce((sum, segment) => sum + segment.lengthMm, 0);
  return { segments: segments.length, lengthMm, lengthM: lengthMm / 1000, nodes: network.nodeIds.length };
}

export interface NetworkCounts {
  segments: number; lengthM: number; verticalConfirmedM: number;
  bends: number; transitions: number; branches: number; terminals: number; continuations: number;
  ur: number; unresolved: number;
}
export function networkCounts(project: ProjectData, network: DuctNetwork): NetworkCounts {
  const totals = networkTotals(project, network);
  const nodes = networkNodes(project, network);
  const count = (type: DuctNodeType): number => nodes.filter((node) => node.type === type).length;
  const verticalConfirmedM = nodes.filter((node) => node.type === 'continuation' && node.confirmedVerticalLength && node.verticalLengthMm).reduce((sum, node) => sum + (node.verticalLengthMm ?? 0), 0) / 1000;
  return {
    segments: totals.segments, lengthM: totals.lengthM, verticalConfirmedM,
    bends: count('bend'), transitions: count('transition'), branches: count('branch'), terminals: count('terminal'), continuations: count('continuation'),
    ur: boundariesForNetwork(project, network).length,
    unresolved: nodes.filter((node) => node.type === 'unknown' || (node.type === 'end' && node.verificationStatus === 'suggested')).length,
  };
}

// ---------------------------------------------------------------------------
// System-type highlighting summaries
// ---------------------------------------------------------------------------

export function networksOfKind(project: ProjectData, kind: 'tulo' | 'poisto', page?: number): DuctNetwork[] {
  return project.ductNetworks.filter((network) =>
    (page === undefined || network.pageNumber === page)
    && (kind === 'tulo' ? isSupplyType(network.systemType) : isExtractType(network.systemType)));
}

export interface HighlightSummary { networks: number; segments: number; lengthM: number; text: string; }
export function highlightSummary(project: ProjectData, kind: 'tulo' | 'poisto', page?: number): HighlightSummary {
  const label = kind === 'tulo' ? 'Tulo' : 'Poisto';
  const networks = networksOfKind(project, kind, page);
  let segments = 0; let lengthMm = 0;
  networks.forEach((network) => { const totals = networkTotals(project, network); segments += totals.segments; lengthMm += totals.lengthMm; });
  const lengthM = lengthMm / 1000;
  const text = networks.length
    ? `${label}: ${networks.length} network${networks.length === 1 ? '' : 's'}, ${segments} section${segments === 1 ? '' : 's'}, ${lengthM.toFixed(1)} m`
    : `No verified ${label} duct system was found on this page.`;
  return { networks: networks.length, segments, lengthM, text };
}

// ---------------------------------------------------------------------------
// Node derivation (assisted): bends, transitions, branches, continuations
// ---------------------------------------------------------------------------

interface Incidence { segment: DuctSegment; fromStart: boolean; direction: Point; }

function junctionClusters(segments: DuctSegment[], tolerance: number): Array<{ point: Point; incidences: Incidence[] }> {
  const endpoints: Array<{ point: Point; incidence: Incidence }> = [];
  segments.forEach((segment) => {
    if (segment.centrelinePoints.length < 2) return;
    endpoints.push({ point: segment.centrelinePoints[0], incidence: { segment, fromStart: true, direction: directionAway(segment.centrelinePoints, true) } });
    endpoints.push({ point: segment.centrelinePoints[segment.centrelinePoints.length - 1], incidence: { segment, fromStart: false, direction: directionAway(segment.centrelinePoints, false) } });
  });
  const clusters: Array<{ point: Point; incidences: Incidence[] }> = [];
  endpoints.forEach((entry) => {
    const existing = clusters.find((cluster) => Math.hypot(cluster.point.x - entry.point.x, cluster.point.y - entry.point.y) <= tolerance);
    if (existing) existing.incidences.push(entry.incidence);
    else clusters.push({ point: entry.point, incidences: [entry.incidence] });
  });
  return clusters;
}

// Produces suggested nodes for a set of segments. Existing user-verified nodes should
// be preserved by the caller; this only proposes geometry-derived topology.
export function deriveSuggestedNodes(project: ProjectData, network: DuctNetwork, tolerance = 8): DuctNode[] {
  const segments = networkSegments(project, network);
  const clusters = junctionClusters(segments, tolerance);
  const nodes: DuctNode[] = [];
  clusters.forEach((cluster) => {
    const incidences = cluster.incidences;
    const base = { id: uid('dnode'), pageNumber: network.pageNumber, networkId: network.id, point: cluster.point, relatedLabelIds: [] as string[], verificationStatus: 'suggested' as const };
    if (incidences.length === 1) {
      nodes.push({ ...base, type: 'end', incomingProfile: incidences[0].segment.profile });
      return;
    }
    if (incidences.length === 2) {
      const [a, b] = incidences;
      const differ = a.segment.profile && b.segment.profile && !profilesEqual(a.segment.profile, b.segment.profile);
      const turn = 180 - angleBetweenDeg(a.direction, b.direction);
      if (differ) {
        nodes.push({ ...base, type: 'transition', incomingProfile: a.segment.profile, outgoingProfile: b.segment.profile, transitionOffset: 'unknown' });
      } else if (turn >= 8) {
        nodes.push({ ...base, type: 'bend', incomingProfile: a.segment.profile, outgoingProfile: b.segment.profile, angleDeg: classifyBendAngle(turn) });
      } else {
        nodes.push({ ...base, type: 'continuation', incomingProfile: a.segment.profile, outgoingProfile: b.segment.profile });
      }
      return;
    }
    // 3+ incident segments: branch. Through-pair is the most collinear opposite pair.
    let through: [Incidence, Incidence] | null = null; let bestTurn = -1;
    for (let i = 0; i < incidences.length; i += 1) for (let j = i + 1; j < incidences.length; j += 1) {
      const opposite = angleBetweenDeg(incidences[i].direction, incidences[j].direction);
      if (opposite > bestTurn) { bestTurn = opposite; through = [incidences[i], incidences[j]]; }
    }
    const branchIncidence = incidences.find((incidence) => !through || (incidence !== through[0] && incidence !== through[1]));
    nodes.push({ ...base, type: 'branch', incomingProfile: through?.[0].segment.profile, outgoingProfile: branchIncidence?.segment.profile });
  });
  return nodes;
}

// ---------------------------------------------------------------------------
// Network-based parts counting from verified topology
// ---------------------------------------------------------------------------

function isRejected(project: ProjectData, networkId: string, fittingKey: string): boolean {
  return project.ductPartMappings.some((mapping) => mapping.networkId === networkId && mapping.fittingKey === fittingKey && mapping.status === 'rejected');
}

function branchProfileOf(node: DuctNode): DuctProfile | undefined { return node.outgoingProfile ?? node.incomingProfile; }

// Builds the parts list for a single network. Automatically derived parts are marked
// "suggested"; parts from a verified network are "verified" unless a mapping rejects them.
export function countNetworkParts(project: ProjectData, network: DuctNetwork): NetworkPartRow[] {
  const excluded = excludedSegmentIds(project, network);
  const segments = networkSegments(project, network).filter((segment) => !excluded.has(segment.id));
  // Drop fitting nodes that sit only on excluded (out-of-scope) segments.
  const excludedSegs = networkSegments(project, network).filter((segment) => excluded.has(segment.id));
  const nodeOnlyExcluded = (node: DuctNode): boolean => {
    if (!excludedSegs.length) return false;
    const near = (segment: DuctSegment): boolean => segment.centrelinePoints.some((point) => Math.hypot(point.x - node.point.x, point.y - node.point.y) <= 10);
    return excludedSegs.some(near) && !segments.some(near);
  };
  const nodes = networkNodes(project, network).filter((node) => !nodeOnlyExcluded(node));
  const verified = network.verificationStatus === 'verified';
  const baseStatus: NetworkPartRow['status'] = verified ? 'verified' : 'suggested';
  const rows = new Map<string, NetworkPartRow>();

  const add = (partial: Omit<NetworkPartRow, 'networkId' | 'status' | 'source'> & { status?: NetworkPartRow['status']; source?: NetworkPartRow['source'] }): void => {
    const key = `${network.id}|${partial.key}`;
    if (isRejected(project, network.id, partial.key)) return;
    const existing = rows.get(key);
    if (existing) { existing.quantity += partial.quantity; if (partial.lengthM !== undefined) existing.lengthM = (existing.lengthM ?? 0) + partial.lengthM; return; }
    rows.set(key, { networkId: network.id, status: partial.status ?? baseStatus, source: partial.source ?? 'topology', key: partial.key, catalogueId: partial.catalogueId, category: partial.category, label: partial.label, shape: partial.shape, size: partial.size, angleDeg: partial.angleDeg, quantity: partial.quantity, lengthM: partial.lengthM });
  };

  // Straight duct grouped by profile.
  segments.forEach((segment) => {
    const profile = segment.profile;
    const round = profile?.shape === 'round';
    const size = profileLabel(profile);
    add({ key: `duct|${size}`, catalogueId: round ? 'round-duct' : 'rect-duct', category: 'Duct', label: `${size} straight duct`, shape: round ? 'round' : 'rectangular', size, quantity: 1, lengthM: segment.lengthMm / 1000 });
  });

  nodes.forEach((node) => {
    if (node.verificationStatus === 'suggested' && !verified) { /* still counted, status suggested */ }
    const profile = node.incomingProfile ?? node.outgoingProfile;
    const round = profile?.shape === 'round';
    const size = profileLabel(profile);
    if (node.type === 'bend') {
      const angle = node.angleDeg ?? 90;
      add({ key: `bend|${size}|${angle}`, catalogueId: bendCatalogueId(round ? 'round' : 'rectangular', angle), category: 'Bend', label: `${angle}° ${round ? 'round' : 'rectangular'} bend ${size}`, shape: round ? 'round' : 'rectangular', size, angleDeg: angle, quantity: 1 });
    } else if (node.type === 'transition') {
      const from = profileLabel(node.incomingProfile); const to = profileLabel(node.outgoingProfile);
      const roundTo = node.outgoingProfile?.shape === 'round'; const roundFrom = node.incomingProfile?.shape === 'round';
      const catalogueId = roundFrom && roundTo ? 'round-reducer' : 'rect-transition';
      add({ key: `transition|${from}->${to}`, catalogueId, category: 'Transition', label: `${from} → ${to} transition (Muunto)`, shape: roundFrom && roundTo ? 'round' : 'rectangular', size: `${from} → ${to}`, quantity: 1 });
    } else if (node.type === 'branch') {
      const branch = branchProfileOf(node); const branchRound = branch?.shape === 'round'; const branchSize = profileLabel(branch);
      add({ key: `branch|${branchSize}`, catalogueId: branchRound ? 'round-saddle' : 'rect-branch', category: 'Branch', label: `${branchSize} branch connection`, shape: branchRound ? 'round' : 'rectangular', size: branchSize, quantity: 1 });
    } else if (node.type === 'terminal') {
      add({ key: `terminal|${size}`, catalogueId: isSupplyType(network.systemType) ? 'supply-terminal' : 'extract-terminal', category: 'Terminal', label: `${size} terminal device`, shape: round ? 'round' : 'rectangular', size, quantity: 1 });
    } else if (node.type === 'continuation' && node.direction) {
      const confirmedLength = node.confirmedVerticalLength && node.verticalLengthMm ? node.verticalLengthMm / 1000 : undefined;
      add({ key: `continuation|${node.direction}|${size}`, catalogueId: 'vertical-continuation', category: 'Continuation', label: `${node.direction === 'up' ? 'YLÖS' : 'ALAS'} vertical continuation ${size}`, shape: round ? 'round' : 'rectangular', size, quantity: 1, lengthM: confirmedLength });
    } else if (node.type === 'damper') {
      add({ key: `damper|${size}`, catalogueId: round ? 'round-damper' : 'rect-damper', category: 'Damper', label: `${size} damper`, shape: round ? 'round' : 'rectangular', size, quantity: 1 });
    } else if (node.type === 'end') {
      add({ key: `endcap|${size}`, catalogueId: round ? 'round-end-cap' : 'rect-end-cap', category: 'Termination', label: `${size} end cap`, shape: round ? 'round' : 'rectangular', size, quantity: 1, status: 'suggested' });
    }
  });

  boundariesForNetwork(project, network).forEach((boundary) => {
    add({ key: `ur|${boundary.id}`, catalogueId: '', category: 'Boundary', label: `UR / urakkaraja boundary (${boundary.scopeSide})`, shape: 'both', size: 'UR', quantity: 1, status: boundary.verificationStatus === 'verified' ? 'verified' : 'suggested', source: 'topology' });
  });

  return [...rows.values()];
}

// ---------------------------------------------------------------------------
// Auto-detection: migrate verified routes into network segments
// ---------------------------------------------------------------------------

function routeSystemType(system: string): DuctSystemType {
  const lower = system.toLowerCase();
  if (lower.includes('supply') || lower.includes('tulo')) return 'supply';
  if (lower.includes('extract') || lower.includes('poisto')) return 'extract';
  if (lower.includes('exhaust') || lower.includes('jäte')) return 'exhaust';
  if (lower.includes('outdoor') || lower.includes('ulko')) return 'outdoor';
  if (lower.includes('transfer') || lower.includes('siirto')) return 'transfer';
  return 'unknown';
}

export interface RescanResult { networks: number; segments: number; convertedRoutes: number; }

// Converts existing verified traced routes on a page into network segments, grouping
// connected routes into one network and classifying by the route's system field.
export function autoDetectNetworks(project: ProjectData, page: number, mmPerPdfPoint: number): RescanResult {
  const routes = project.routes.filter((route) => route.page === page && route.points.length >= 2);
  if (!routes.length) return { networks: 0, segments: 0, convertedRoutes: 0 };

  // Group routes into connected clusters by shared endpoints + matching system type.
  const clusters: RouteItem[][] = [];
  const routesAdjacent = (a: RouteItem, b: RouteItem): boolean => {
    const aEnds = [a.points[0], a.points[a.points.length - 1]];
    const bEnds = [b.points[0], b.points[b.points.length - 1]];
    return routeSystemType(a.system) === routeSystemType(b.system) && aEnds.some((p) => bEnds.some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= 12));
  };
  routes.forEach((route) => {
    const cluster = clusters.find((group) => group.some((member) => routesAdjacent(member, route)));
    if (cluster) cluster.push(route); else clusters.push([route]);
  });

  let networkCount = 0; let segmentCount = 0;
  clusters.forEach((cluster) => {
    const systemType = routeSystemType(cluster[0].system);
    const network = createNetwork(page, systemType, `Rescan network ${project.ductNetworks.length + 1}`, 'assisted-vector');
    cluster.forEach((route) => {
      const segment = createSegment(page, route.points.map((point) => ({ ...point })), mmPerPdfPoint, profileFromSizeText(route.size), 'vector-detected');
      segment.networkId = network.id; project.ductSegments.push(segment); network.segmentIds.push(segment.id); segmentCount += 1;
    });
    project.ductNetworks.push(network);
    const derived = deriveSuggestedNodes(project, network);
    project.ductNodes.push(...derived); network.nodeIds.push(...derived.map((node) => node.id));
    networkCount += 1;
  });

  // Consume the converted routes so the old trace-route workflow no longer owns them.
  const consumed = new Set(routes.map((route) => route.id));
  project.routes = project.routes.filter((route) => !consumed.has(route.id));
  return { networks: networkCount, segments: segmentCount, convertedRoutes: consumed.size };
}

// ---------------------------------------------------------------------------
// Network mutation helpers
// ---------------------------------------------------------------------------

export function createNetwork(pageNumber: number, systemType: DuctSystemType, name: string, source: DuctNetwork['source'] = 'manual'): DuctNetwork {
  const timestamp = now();
  return { id: uid('dnet'), pageNumber, name, systemType, segmentIds: [], nodeIds: [], verificationStatus: 'suggested', source, notes: '', createdAt: timestamp, updatedAt: timestamp };
}

export function createSegment(pageNumber: number, points: Point[], mmPerPdfPoint: number, profile: DuctProfile | undefined, source: DuctSegment['source']): DuctSegment {
  return { id: uid('dseg'), pageNumber, centrelinePoints: points, lengthMm: segmentLengthMm(points, mmPerPdfPoint), profile, source, verificationStatus: 'suggested', relatedLabelIds: [] };
}

// Re-derives lengths from centreline geometry for geometry-backed segments. Fixture
// segments keep their authored length by opting out via keepLength.
export function recomputeSegmentLengths(project: ProjectData, mmPerPdfPoint: number, ids?: Set<string>): void {
  project.ductSegments.forEach((segment) => {
    if (ids && !ids.has(segment.id)) return;
    if (segment.centrelinePoints.length >= 2) segment.lengthMm = segmentLengthMm(segment.centrelinePoints, mmPerPdfPoint);
  });
}

export function touch(network: DuctNetwork): void { network.updatedAt = now(); }

export function removeNetwork(project: ProjectData, networkId: string): void {
  const network = project.ductNetworks.find((item) => item.id === networkId);
  if (!network) return;
  const segmentIds = new Set(network.segmentIds); const nodeIds = new Set(network.nodeIds);
  project.ductSegments = project.ductSegments.filter((segment) => !segmentIds.has(segment.id));
  project.ductNodes = project.ductNodes.filter((node) => !nodeIds.has(node.id));
  project.ductLabels.forEach((label) => { if (label.segmentId && segmentIds.has(label.segmentId)) { label.segmentId = undefined; } });
  project.ductPartMappings = project.ductPartMappings.filter((mapping) => mapping.networkId !== networkId);
  project.contractBoundaries = project.contractBoundaries.filter((boundary) => boundary.relatedNetworkId !== networkId);
  project.ductNetworks = project.ductNetworks.filter((item) => item.id !== networkId);
}

export function createContractBoundary(pageNumber: number, point: Point, networkId?: string, segmentId?: string): ContractBoundary {
  return { id: uid('dur'), pageNumber, point, relatedNetworkId: networkId, relatedSegmentId: segmentId, scopeSide: 'unknown', verificationStatus: 'suggested', notes: '' };
}

// ---------------------------------------------------------------------------
// Assisted vector tracer (conservative, batched-friendly, pure)
// ---------------------------------------------------------------------------

export interface TraceLine { start: Point; end: Point; }
export interface TraceResult { polylines: Point[][]; branchPoints: Point[]; truncated: boolean; inspected: number; }

function nearestLineIndex(lines: TraceLine[], seed: Point): number {
  let best = -1; let bestDistance = Infinity;
  lines.forEach((line, index) => {
    const distance = distanceToSegment(seed, line.start, line.end);
    if (distance < bestDistance) { bestDistance = distance; best = index; }
  });
  return best;
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x; const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

// Follows connected line geometry outward from a seed. Conservative: it bounds the
// search region and segment count, follows shared endpoints (with a small gap
// tolerance), and reports branch vertices as ambiguous continuations instead of
// flooding through them. It never throws; callers handle empty results gracefully.
export function traceFromSeed(lines: TraceLine[], seed: Point, options: { radius?: number; gapTolerance?: number; maxSegments?: number } = {}): TraceResult {
  const radius = options.radius ?? 340;
  const gap = options.gapTolerance ?? 4;
  const maxSegments = options.maxSegments ?? 260;
  const local = lines.filter((line) => distanceToSegment(seed, line.start, line.end) <= radius);
  if (!local.length) return { polylines: [], branchPoints: [], truncated: false, inspected: 0 };
  const startIndex = nearestLineIndex(local, seed);
  if (startIndex < 0) return { polylines: [], branchPoints: [], truncated: false, inspected: local.length };

  const visited = new Set<number>();
  const queue: number[] = [startIndex];
  const collected: TraceLine[] = [];
  const branchPoints: Point[] = [];
  let truncated = false;

  const endpointsNear = (point: Point): number[] => local.reduce<number[]>((acc, line, index) => {
    if (visited.has(index)) return acc;
    if (Math.hypot(line.start.x - point.x, line.start.y - point.y) <= gap || Math.hypot(line.end.x - point.x, line.end.y - point.y) <= gap) acc.push(index);
    return acc;
  }, []);

  while (queue.length && collected.length < maxSegments) {
    const index = queue.shift();
    if (index === undefined || visited.has(index)) continue;
    visited.add(index);
    const line = local[index];
    collected.push(line);
    ([line.start, line.end]).forEach((end) => {
      const neighbours = endpointsNear(end);
      if (neighbours.length > 1) branchPoints.push(end);
      // Only auto-follow when the continuation is unambiguous (single neighbour).
      if (neighbours.length === 1) queue.push(neighbours[0]);
    });
  }
  if (queue.length) truncated = true;

  // Merge collected lines into ordered polylines by chaining shared endpoints.
  const polylines = chainLines(collected, gap);
  return { polylines, branchPoints, truncated, inspected: local.length };
}

function chainLines(lines: TraceLine[], gap: number): Point[][] {
  const remaining = lines.map((line) => ({ ...line }));
  const chains: Point[][] = [];
  const near = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= gap;
  while (remaining.length) {
    const first = remaining.shift();
    if (!first) break;
    const chain: Point[] = [first.start, first.end];
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < remaining.length; i += 1) {
        const line = remaining[i]; const head = chain[0]; const tail = chain[chain.length - 1];
        if (near(tail, line.start)) { chain.push(line.end); remaining.splice(i, 1); extended = true; break; }
        if (near(tail, line.end)) { chain.push(line.start); remaining.splice(i, 1); extended = true; break; }
        if (near(head, line.end)) { chain.unshift(line.start); remaining.splice(i, 1); extended = true; break; }
        if (near(head, line.start)) { chain.unshift(line.end); remaining.splice(i, 1); extended = true; break; }
      }
    }
    chains.push(simplifyCollinear(chain));
  }
  return chains.filter((chain) => chain.length >= 2 && pdfPolylineLength(chain) >= 6);
}

function simplifyCollinear(points: Point[], toleranceDeg = 6): Point[] {
  if (points.length <= 2) return points;
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = result[result.length - 1]; const current = points[i]; const next = points[i + 1];
    const d1 = { x: current.x - prev.x, y: current.y - prev.y }; const d2 = { x: next.x - current.x, y: next.y - current.y };
    const l1 = Math.hypot(d1.x, d1.y) || 1; const l2 = Math.hypot(d2.x, d2.y) || 1;
    const turn = angleBetweenDeg({ x: d1.x / l1, y: d1.y / l1 }, { x: d2.x / l2, y: d2.y / l2 });
    if (turn > toleranceDeg) result.push(current);
  }
  result.push(points[points.length - 1]);
  return result;
}

export { PDF_POINT_MM };
