import { OPS } from 'pdfjs-dist';
import type { AirflowClassification, AirflowMarker, Point, RouteItem, TemporaryDuctAxis } from './types';

export interface LineSegment { start: Point; end: Point }
export interface ArrowCandidate { tail: Point; tip: Point; confidence: number; shaftLength: number; headLength: number; headAngleDegrees: number }
export interface DuctReference { routeId?: string; axisId?: string; system?: string; points: Point[] }

const UNCERTAIN_DOT = 0.28;

function nearestOnSegment(point: Point, start: Point, end: Point): { point: Point; distance: number } {
  const dx = end.x - start.x; const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  const nearest = { x: start.x + t * dx, y: start.y + t * dy };
  return { point: nearest, distance: Math.hypot(point.x - nearest.x, point.y - nearest.y) };
}

export function nearestOnPolyline(point: Point, points: Point[]): { point: Point; distance: number } | null {
  let best: { point: Point; distance: number } | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const candidate = nearestOnSegment(point, points[index - 1], points[index]);
    if (!best || candidate.distance < best.distance) best = candidate;
  }
  return best;
}

export function chooseDuctReference(
  arrowPoint: Point,
  page: number,
  selectedRouteId: string | null,
  routes: RouteItem[],
  axes: TemporaryDuctAxis[],
): DuctReference | null {
  const selected = routes.find((route) => route.id === selectedRouteId && route.page === page && route.points.length > 1);
  if (selected) return { routeId: selected.id, system: selected.system, points: selected.points };
  const routeCandidates = routes.filter((route) => route.page === page && route.points.length > 1)
    .map((route) => ({ route, nearest: nearestOnPolyline(arrowPoint, route.points) }))
    .filter((item): item is { route: RouteItem; nearest: { point: Point; distance: number } } => Boolean(item.nearest))
    .sort((a, b) => a.nearest.distance - b.nearest.distance);
  if (routeCandidates[0]) return { routeId: routeCandidates[0].route.id, system: routeCandidates[0].route.system, points: routeCandidates[0].route.points };
  const axisCandidates = axes.filter((axis) => axis.pageNumber === page)
    .map((axis) => ({ axis, nearest: nearestOnPolyline(arrowPoint, [axis.start, axis.end]) }))
    .filter((item): item is { axis: TemporaryDuctAxis; nearest: { point: Point; distance: number } } => Boolean(item.nearest))
    .sort((a, b) => a.nearest.distance - b.nearest.distance);
  return axisCandidates[0] ? { axisId: axisCandidates[0].axis.id, points: [axisCandidates[0].axis.start, axisCandidates[0].axis.end] } : null;
}

export function classifyAirflow(tail: Point, tip: Point, reference: DuctReference): Pick<AirflowMarker, 'classification' | 'confidence' | 'nearestPoint' | 'distanceToDuct' | 'dotProductScore' | 'arrowAngleDegrees'> {
  const nearest = nearestOnPolyline(tip, reference.points) ?? { point: tip, distance: 0 };
  const arrowDx = tip.x - tail.x; const arrowDy = tip.y - tail.y; const arrowLength = Math.hypot(arrowDx, arrowDy);
  const outwardDx = tip.x - nearest.point.x; const outwardDy = tip.y - nearest.point.y; const outwardLength = Math.hypot(outwardDx, outwardDy);
  const dot = arrowLength && outwardLength ? (arrowDx * outwardDx + arrowDy * outwardDy) / (arrowLength * outwardLength) : 0;
  const classification: AirflowClassification = dot > UNCERTAIN_DOT ? 'supply' : dot < -UNCERTAIN_DOT ? 'extract' : 'uncertain';
  const directionalConfidence = Math.max(0, (Math.abs(dot) - UNCERTAIN_DOT) / (1 - UNCERTAIN_DOT));
  return {
    classification,
    confidence: classification === 'uncertain' ? Math.max(0.1, 1 - Math.abs(dot) / UNCERTAIN_DOT) * 0.45 : 0.55 + directionalConfidence * 0.45,
    nearestPoint: nearest.point,
    distanceToDuct: nearest.distance,
    dotProductScore: dot,
    arrowAngleDegrees: (Math.atan2(arrowDy, arrowDx) * 180 / Math.PI + 360) % 360,
  };
}

function apply(matrix: number[], point: Point): Point {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] };
}
function multiply(left: number[], right: number[]): number[] {
  return [
    left[0] * right[0] + left[2] * right[1], left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3], left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4], left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}
function numericArray(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) return value;
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  return null;
}

export function extractLineSegments(operatorList: { fnArray: number[]; argsArray: unknown[] }, viewportTransform: number[]): LineSegment[] {
  const segments: LineSegment[] = []; const stack: number[][] = []; let ctm = [1, 0, 0, 1, 0, 0];
  const appendPath = (operations: number[], coordinates: number[], matrix: number[]): void => {
    let cursor = 0; let current: Point | null = null; let start: Point | null = null;
    operations.forEach((operation) => {
      if (operation === 0 || operation === 1) {
        const point = apply(matrix, { x: coordinates[cursor] ?? 0, y: coordinates[cursor + 1] ?? 0 }); cursor += 2;
        if (operation === 0) { current = point; start = point; }
        else if (current) { segments.push({ start: current, end: point }); current = point; }
      } else if (operation === 2) cursor += 6;
      else if (operation === 3) cursor += 4;
      else if (operation === 4 && current && start) { segments.push({ start: current, end: start }); current = start; }
      else cursor += operation === 5 || operation === 6 ? 4 : 0;
    });
  };
  const appendCompactPath = (stream: number[], matrix: number[]): void => {
    const operations: number[] = []; const coordinates: number[] = [];
    for (let cursor = 0; cursor < stream.length;) {
      const operation = stream[cursor++]; operations.push(operation);
      const coordinateCount = operation === 0 || operation === 1 ? 2 : operation === 2 ? 6 : operation === 3 || operation === 5 || operation === 6 ? 4 : 0;
      coordinates.push(...stream.slice(cursor, cursor + coordinateCount)); cursor += coordinateCount;
    }
    appendPath(operations, coordinates, matrix);
  };
  operatorList.fnArray.forEach((fn, index) => {
    const args = operatorList.argsArray[index];
    if (fn === OPS.save) { stack.push([...ctm]); return; }
    if (fn === OPS.restore) { ctm = stack.pop() ?? ctm; return; }
    if (fn === OPS.transform) { const matrix = numericArray(args); if (matrix && matrix.length >= 6) ctm = multiply(ctm, matrix.slice(0, 6)); return; }
    if (fn !== OPS.constructPath || !Array.isArray(args)) return;
    const matrix = multiply(viewportTransform, ctm); const operations = numericArray(args[0]); const coordinates = numericArray(args[1]);
    if (operations && coordinates) { appendPath(operations, coordinates, matrix); return; }
    if (Array.isArray(args[1])) args[1].forEach((subpath) => { const stream = numericArray(subpath); if (stream) appendCompactPath(stream, matrix); });
  });
  return segments.filter((segment) => { const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y); return length >= 2 && length <= 80; });
}

function endpointDistance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function angleBetween(a: Point, b: Point): number {
  const dot = a.x * b.x + a.y * b.y; const lengths = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  return lengths ? Math.acos(Math.max(-1, Math.min(1, dot / lengths))) * 180 / Math.PI : 180;
}

export function findArrowCandidates(segments: LineSegment[], bounds?: { left: number; top: number; right: number; bottom: number }): ArrowCandidate[] {
  const filtered = bounds ? segments.filter((segment) => [segment.start, segment.end].some((point) => point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom)) : segments;
  const endpoints = filtered.flatMap((segment, segmentIndex) => [{ point: segment.start, segmentIndex }, { point: segment.end, segmentIndex }]);
  const bucketSize = 2; const buckets = new Map<string, typeof endpoints>();
  endpoints.forEach((entry) => {
    const key = `${Math.floor(entry.point.x / bucketSize)},${Math.floor(entry.point.y / bucketSize)}`;
    const bucket = buckets.get(key) ?? []; bucket.push(entry); buckets.set(key, bucket);
  });
  const candidates: ArrowCandidate[] = [];
  endpoints.forEach(({ point: vertex }) => {
    const cellX = Math.floor(vertex.x / bucketSize); const cellY = Math.floor(vertex.y / bucketSize); const nearby: typeof endpoints = [];
    for (let x = cellX - 1; x <= cellX + 1; x += 1) for (let y = cellY - 1; y <= cellY + 1; y += 1) nearby.push(...(buckets.get(`${x},${y}`) ?? []));
    const connected = nearby.filter((entry) => endpointDistance(entry.point, vertex) <= 1.8).map((entry) => entry.segmentIndex);
    const indexes = [...new Set(connected)]; if (indexes.length < 3 || indexes.length > 5) return;
    const attached = indexes.map((index) => {
      const segment = filtered[index]; const other = endpointDistance(segment.start, vertex) <= 1.8 ? segment.end : segment.start;
      return { other, length: endpointDistance(other, vertex) };
    }).sort((a, b) => b.length - a.length);
    const shaft = attached[0]; const heads = attached.slice(1).filter((item) => item.length >= shaft.length * 0.18 && item.length <= shaft.length * 0.85).slice(0, 2);
    if (heads.length !== 2 || shaft.length < 5) return;
    const reverseShaft = { x: shaft.other.x - vertex.x, y: shaft.other.y - vertex.y };
    const headAngles = heads.map((head) => angleBetween(reverseShaft, { x: head.other.x - vertex.x, y: head.other.y - vertex.y }));
    const symmetry = Math.abs(headAngles[0] - headAngles[1]); const opening = angleBetween({ x: heads[0].other.x - vertex.x, y: heads[0].other.y - vertex.y }, { x: heads[1].other.x - vertex.x, y: heads[1].other.y - vertex.y });
    // AutoCAD arrowheads are often very acute, so retain a conservative 5° floor
    // while still requiring two heads, a plausible opening, and near symmetry.
    if (headAngles.some((angle) => angle < 5 || angle > 75) || opening < 25 || opening > 140 || symmetry > 25) return;
    const confidence = Math.max(0.45, Math.min(0.95, 0.9 - symmetry / 80 - Math.abs(opening - 60) / 180));
    candidates.push({ tail: shaft.other, tip: vertex, confidence, shaftLength: shaft.length, headLength: (heads[0].length + heads[1].length) / 2, headAngleDegrees: opening });
  });
  const unique: ArrowCandidate[] = [];
  candidates.sort((a, b) => b.confidence - a.confidence).forEach((candidate) => {
    if (!unique.some((item) => endpointDistance(item.tip, candidate.tip) < 4)) unique.push(candidate);
  });
  return unique;
}

export function nearestArrowCandidate(candidates: ArrowCandidate[], point: Point, radius = 28): ArrowCandidate | null {
  return candidates.map((candidate) => ({ candidate, distance: endpointDistance(candidate.tip, point) }))
    .filter((item) => item.distance <= radius).sort((a, b) => a.distance - b.distance || b.candidate.confidence - a.candidate.confidence)[0]?.candidate ?? null;
}

export function similarArrow(candidate: ArrowCandidate, example: ArrowCandidate): boolean {
  const ratio = candidate.shaftLength / Math.max(1, example.shaftLength);
  const headRatio = candidate.headLength / Math.max(1, example.headLength);
  return ratio >= 0.7 && ratio <= 1.35 && headRatio >= 0.6 && headRatio <= 1.5 && Math.abs(candidate.headAngleDegrees - example.headAngleDegrees) <= 22;
}
