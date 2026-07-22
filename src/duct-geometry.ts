import type { Point } from './types';

// Label-anchored duct-body detection from real PDF vector geometry.
//
// Pipeline: duct-size label -> nearby parallel edge pair (separation validated against
// the drawing scale) -> collinear edge extension -> closed footprint polygon +
// centreline + measured length. All coordinates stay in PDF viewport space so the
// existing overlay transform (point * renderScale) renders them aligned at any zoom.

export interface GeomSegment { x1: number; y1: number; x2: number; y2: number }
export interface DuctLabelAnchor { x: number; y: number; diameterMm: number; raw: string }

export interface DuctSectionCandidate {
  diameterMm: number;
  widthUnits: number;
  polygon: Point[];      // closed footprint (4 corners) in PDF space
  centreline: Point[];   // 2 points in PDF space
  lengthUnits: number;
  lengthMm: number;
  confidence: number;
  labelRaw: string;
  labelPoint: Point;
}

export interface DuctDetectionResult {
  mmPerUnit: number;
  scaleVotes: number;
  sections: DuctSectionCandidate[];
  rejects: Record<string, number>;
}

const CELL = 40;

function segLength(s: GeomSegment): number { return Math.hypot(s.x2 - s.x1, s.y2 - s.y1); }
function angleOf(s: GeomSegment): number {
  let a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180 / Math.PI;
  a = ((a % 180) + 180) % 180;
  return a;
}
function angleDelta(a: number, b: number): number { const d = Math.abs(a - b); return Math.min(d, 180 - d); }

function distanceToSegment(px: number, py: number, s: GeomSegment): number {
  const dx = s.x2 - s.x1; const dy = s.y2 - s.y1; const l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(px - s.x1, py - s.y1);
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}
// Perpendicular distance from B's midpoint to A — the pair separation.
function pairSeparation(a: GeomSegment, b: GeomSegment): number {
  return distanceToSegment((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, a);
}
// Fraction of A covered by B's projection — rejects merely-collinear distant lines.
function overlapRatio(a: GeomSegment, b: GeomSegment): number {
  const ax = a.x2 - a.x1; const ay = a.y2 - a.y1; const len = Math.hypot(ax, ay) || 1;
  const ux = ax / len; const uy = ay / len;
  const project = (x: number, y: number): number => (x - a.x1) * ux + (y - a.y1) * uy;
  const b0 = project(b.x1, b.y1); const b1 = project(b.x2, b.y2);
  const lo = Math.max(0, Math.min(b0, b1)); const hi = Math.min(len, Math.max(b0, b1));
  return Math.max(0, hi - lo) / len;
}

class SpatialIndex {
  private grid = new Map<string, number[]>();
  constructor(public segments: GeomSegment[]) {
    segments.forEach((s, index) => {
      const minX = Math.min(s.x1, s.x2); const maxX = Math.max(s.x1, s.x2);
      const minY = Math.min(s.y1, s.y2); const maxY = Math.max(s.y1, s.y2);
      for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx += 1) {
        for (let gy = Math.floor(minY / CELL); gy <= Math.floor(maxY / CELL); gy += 1) {
          const key = `${gx},${gy}`;
          const bucket = this.grid.get(key); if (bucket) bucket.push(index); else this.grid.set(key, [index]);
        }
      }
    });
  }
  near(x: number, y: number, radius: number): number[] {
    const found = new Set<number>();
    for (let gx = Math.floor((x - radius) / CELL); gx <= Math.floor((x + radius) / CELL); gx += 1) {
      for (let gy = Math.floor((y - radius) / CELL); gy <= Math.floor((y + radius) / CELL); gy += 1) {
        this.grid.get(`${gx},${gy}`)?.forEach((index) => found.add(index));
      }
    }
    return [...found];
  }
}

interface EdgePair { a: number; b: number; separation: number; distance: number }

// Finds the parallel edge pair around a label whose separation matches the expected
// duct width. Walls/hatching/annotation lines fail the separation or overlap test.
function findEdgePair(index: SpatialIndex, label: DuctLabelAnchor, expectedSeparation: number, searchRadius: number): EdgePair | null {
  const tolerance = Math.max(1.2, expectedSeparation * 0.20);
  const nearby = index.near(label.x, label.y, searchRadius)
    .filter((i) => segLength(index.segments[i]) >= 6 && distanceToSegment(label.x, label.y, index.segments[i]) <= searchRadius);
  let best: (EdgePair & { score: number }) | null = null;
  for (let i = 0; i < nearby.length; i += 1) {
    for (let j = i + 1; j < nearby.length; j += 1) {
      const a = index.segments[nearby[i]]; const b = index.segments[nearby[j]];
      if (angleDelta(angleOf(a), angleOf(b)) > 4) continue;
      const separation = pairSeparation(a, b);
      if (Math.abs(separation - expectedSeparation) > tolerance) continue;
      if (overlapRatio(a, b) < 0.5) continue;
      const distance = Math.min(distanceToSegment(label.x, label.y, a), distanceToSegment(label.x, label.y, b));
      const score = distance + Math.abs(separation - expectedSeparation) * 3;
      if (!best || score < best.score) best = { a: nearby[i], b: nearby[j], separation, distance, score };
    }
  }
  return best ? { a: best.a, b: best.b, separation: best.separation, distance: best.distance } : null;
}

interface Extent { ox: number; oy: number; ux: number; uy: number; tmin: number; tmax: number }

// Extends a seed edge through connected/collinear neighbours, bridging small PDF
// segmentation gaps, so a duct run split into many path segments becomes one edge.
function extendCollinear(index: SpatialIndex, seed: number, angleTolerance = 3, perpTolerance = 1.2, gapTolerance = 10): Extent {
  const s = index.segments[seed];
  const len = segLength(s) || 1;
  const ux = (s.x2 - s.x1) / len; const uy = (s.y2 - s.y1) / len;
  const baseAngle = angleOf(s);
  const project = (x: number, y: number): number => (x - s.x1) * ux + (y - s.y1) * uy;
  const perpendicular = (x: number, y: number): number => Math.abs(-(x - s.x1) * uy + (y - s.y1) * ux);
  let tmin = 0; let tmax = len;
  const used = new Set<number>([seed]);
  let grew = true; let guard = 0;
  while (grew && guard < 24) {
    grew = false; guard += 1;
    const midX = s.x1 + ux * (tmin + tmax) / 2; const midY = s.y1 + uy * (tmin + tmax) / 2;
    const candidates = index.near(midX, midY, (tmax - tmin) / 2 + 60);
    for (const i of candidates) {
      if (used.has(i)) continue;
      const t = index.segments[i];
      if (angleDelta(angleOf(t), baseAngle) > angleTolerance) continue;
      if (perpendicular(t.x1, t.y1) > perpTolerance || perpendicular(t.x2, t.y2) > perpTolerance) continue;
      const p0 = project(t.x1, t.y1); const p1 = project(t.x2, t.y2);
      const lo = Math.min(p0, p1); const hi = Math.max(p0, p1);
      if (lo > tmax + gapTolerance || hi < tmin - gapTolerance) continue;
      const nextMin = Math.min(tmin, lo); const nextMax = Math.max(tmax, hi);
      if (nextMin < tmin - 1e-6 || nextMax > tmax + 1e-6) { tmin = nextMin; tmax = nextMax; grew = true; }
      used.add(i);
    }
  }
  return { ox: s.x1, oy: s.y1, ux, uy, tmin, tmax };
}

// Derives millimetres-per-PDF-unit by voting: the scale that explains the most labels
// with a parallel pair separated by (diameter / scale).
export function estimateScale(index: SpatialIndex, labels: DuctLabelAnchor[], searchRadius = 70): { mmPerUnit: number; votes: number } {
  const pairSeps = labels.map((label) => {
    const nearby = index.near(label.x, label.y, searchRadius)
      .filter((i) => segLength(index.segments[i]) >= 8 && distanceToSegment(label.x, label.y, index.segments[i]) <= searchRadius);
    const seps: number[] = [];
    for (let i = 0; i < nearby.length; i += 1) {
      for (let j = i + 1; j < nearby.length; j += 1) {
        const a = index.segments[nearby[i]]; const b = index.segments[nearby[j]];
        if (angleDelta(angleOf(a), angleOf(b)) > 5) continue;
        const separation = pairSeparation(a, b);
        if (separation < 1.5 || separation > 40) continue;
        if (overlapRatio(a, b) < 0.5) continue;
        seps.push(separation);
      }
    }
    return { diameterMm: label.diameterMm, seps };
  });
  let best = { mmPerUnit: 14.5, votes: -1 };
  for (let k = 2; k <= 40; k += 0.05) {
    let votes = 0;
    for (const entry of pairSeps) {
      const expected = entry.diameterMm / k;
      const tolerance = Math.max(1.2, expected * 0.18);
      if (entry.seps.some((s) => Math.abs(s - expected) <= tolerance)) votes += 1;
    }
    if (votes > best.votes) best = { mmPerUnit: Number(k.toFixed(2)), votes };
  }
  return best;
}

export interface DetectOptions { searchRadius?: number; mmPerUnit?: number; maxSections?: number }

export function detectDuctSections(rawSegments: GeomSegment[], labels: DuctLabelAnchor[], options: DetectOptions = {}): DuctDetectionResult {
  const rejects: Record<string, number> = {};
  const bump = (key: string): void => { rejects[key] = (rejects[key] ?? 0) + 1; };
  const segments = rawSegments.filter((s) => { const l = segLength(s); return l >= 3 && l <= 8000; });
  if (!segments.length || !labels.length) return { mmPerUnit: options.mmPerUnit ?? 0, scaleVotes: 0, sections: [], rejects };

  const index = new SpatialIndex(segments);
  const searchRadius = options.searchRadius ?? 70;
  const scale = options.mmPerUnit ? { mmPerUnit: options.mmPerUnit, votes: 0 } : estimateScale(index, labels, searchRadius);
  const mmPerUnit = scale.mmPerUnit;

  const sections: DuctSectionCandidate[] = [];
  const maxSections = options.maxSections ?? 400;
  for (const label of labels) {
    if (sections.length >= maxSections) break;
    const expected = label.diameterMm / mmPerUnit;
    const pair = findEdgePair(index, label, expected, searchRadius);
    if (!pair) { bump('no parallel duct-edge pair near label'); continue; }

    const edgeA = extendCollinear(index, pair.a);
    const edgeB = extendCollinear(index, pair.b);
    const projectOnA = (x: number, y: number): number => (x - edgeA.ox) * edgeA.ux + (y - edgeA.oy) * edgeA.uy;
    const b0 = projectOnA(edgeB.ox + edgeB.ux * edgeB.tmin, edgeB.oy + edgeB.uy * edgeB.tmin);
    const b1 = projectOnA(edgeB.ox + edgeB.ux * edgeB.tmax, edgeB.oy + edgeB.uy * edgeB.tmax);
    const lo = Math.max(edgeA.tmin, Math.min(b0, b1));
    const hi = Math.min(edgeA.tmax, Math.max(b0, b1));
    const lengthUnits = hi - lo;
    if (lengthUnits < expected * 1.2) { bump('traced run shorter than one duct width'); continue; }
    if (lengthUnits > 4000) { bump('traced run implausibly long'); continue; }

    const pointOnA = (t: number): Point => ({ x: edgeA.ox + edgeA.ux * t, y: edgeA.oy + edgeA.uy * t });
    const nx = -edgeA.uy; const ny = edgeA.ux;
    const bMidX = (segments[pair.b].x1 + segments[pair.b].x2) / 2;
    const bMidY = (segments[pair.b].y1 + segments[pair.b].y2) / 2;
    const sign = Math.sign((bMidX - edgeA.ox) * nx + (bMidY - edgeA.oy) * ny) || 1;
    const offset = sign * pair.separation;

    const a0 = pointOnA(lo); const a1 = pointOnA(hi);
    const bp0: Point = { x: a0.x + nx * offset, y: a0.y + ny * offset };
    const bp1: Point = { x: a1.x + nx * offset, y: a1.y + ny * offset };
    // Closed, non-self-intersecting quad: A-side forward, B-side reversed.
    const polygon: Point[] = [a0, a1, bp1, bp0];
    const centreline: Point[] = [
      { x: (a0.x + bp0.x) / 2, y: (a0.y + bp0.y) / 2 },
      { x: (a1.x + bp1.x) / 2, y: (a1.y + bp1.y) / 2 },
    ];
    const widthError = Math.abs(pair.separation - expected) / Math.max(1, expected);
    const confidence = Math.max(0.4, Math.min(0.92, 0.9 - widthError * 1.5 - Math.min(0.2, pair.distance / 400)));
    sections.push({
      diameterMm: label.diameterMm, widthUnits: pair.separation, polygon, centreline,
      lengthUnits, lengthMm: lengthUnits * mmPerUnit, confidence, labelRaw: label.raw,
      labelPoint: { x: label.x, y: label.y },
    });
  }
  return { mmPerUnit, scaleVotes: scale.votes, sections, rejects };
}

export function polygonContains(polygon: Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]; const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
