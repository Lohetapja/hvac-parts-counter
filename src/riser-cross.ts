import type { Point } from './types';
import type { GeomSegment } from './duct-geometry';

// Vertical duct-continuation (riser) classification from the crossing-stroke symbol.
//
// HVAC convention on these drawings: a vertical duct continuation (labelled YLÖS =
// up, ALAS = down) carries a small symbol whose diagonal strokes encode the system:
//   • one diagonal crossing line          → Poisto / Extract
//   • two diagonals forming an X (crossing) → Tulo / Supply
//
// This is strong system evidence, combined with (not overriding) terminal-arrow
// evidence and any user seed classification. Geometry is never discarded on a
// conflict — the classification is flagged for review instead.

export interface RiserCrossConfig {
  enabled: boolean;
  /** Search radius around the YLÖS/ALAS anchor, in PDF viewport units. */
  searchRadius: number;
  /** Minimum stroke length to count as a diagonal (rejects glyph micro-strokes). */
  minDiagonalLen: number;
  /** Angular tolerance around 45°/135° for a stroke to count as diagonal. */
  diagonalToleranceDeg: number;
}

// Enabled by default (the G3 drawings use this convention). Configurable in dev.
export const DEFAULT_RISER_CROSS_CONFIG: RiserCrossConfig = {
  enabled: true, searchRadius: 38, minDiagonalLen: 6, diagonalToleranceDeg: 20,
};

export type RiserSystemEvidence = 'tulo' | 'poisto';
export interface RiserCrossResult {
  crossingCount: number;
  systemEvidence: RiserSystemEvidence | null;
  hasForward: boolean;   // a "/"-oriented diagonal arm is present
  hasBackward: boolean;  // a "\"-oriented diagonal arm is present
  intersects: boolean;   // the two arms actually cross near the anchor (true X)
  diagonals: Array<{ angleDeg: number; midX: number; midY: number; length: number }>;
}

function angle180(s: GeomSegment): number { let a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180 / Math.PI; a = ((a % 180) + 180) % 180; return a; }
function segLen(s: GeomSegment): number { return Math.hypot(s.x2 - s.x1, s.y2 - s.y1); }
function angDelta(a: number, b: number): number { const d = Math.abs(a - b); return Math.min(d, 180 - d); }
function pointToLine(px: number, py: number, s: GeomSegment): number {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l2 = dx * dx + dy * dy; if (!l2) return Math.hypot(px - s.x1, py - s.y1);
  return Math.abs((px - s.x1) * dy - (py - s.y1) * dx) / Math.sqrt(l2);
}
function segmentsIntersect(a: GeomSegment, b: GeomSegment): boolean {
  const o = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  const o1 = o(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1), o2 = o(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const o3 = o(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1), o4 = o(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return o1 !== o2 && o3 !== o4;
}

// Merge near-collinear diagonal segments into distinct "arms" (a single arm may be
// drawn as several PDF segments). Returns one representative segment per arm.
function mergeArms(diagonals: GeomSegment[]): GeomSegment[] {
  const arms: GeomSegment[] = []; const used = new Array(diagonals.length).fill(false);
  for (let i = 0; i < diagonals.length; i += 1) {
    if (used[i]) continue; used[i] = true;
    let cur = { ...diagonals[i] }; const a0 = angle180(diagonals[i]);
    for (let j = i + 1; j < diagonals.length; j += 1) {
      if (used[j]) continue; if (angDelta(angle180(diagonals[j]), a0) > 12) continue;
      const mx = (diagonals[j].x1 + diagonals[j].x2) / 2, my = (diagonals[j].y1 + diagonals[j].y2) / 2;
      if (pointToLine(mx, my, cur) > 7) continue;
      used[j] = true;
      // Extend the arm to the extreme endpoints along its direction.
      const pts = [[cur.x1, cur.y1], [cur.x2, cur.y2], [diagonals[j].x1, diagonals[j].y1], [diagonals[j].x2, diagonals[j].y2]];
      let best = 0; let bi = 0, bj = 1;
      for (let p = 0; p < pts.length; p += 1) for (let q = p + 1; q < pts.length; q += 1) { const d = Math.hypot(pts[p][0] - pts[q][0], pts[p][1] - pts[q][1]); if (d > best) { best = d; bi = p; bj = q; } }
      cur = { x1: pts[bi][0], y1: pts[bi][1], x2: pts[bj][0], y2: pts[bj][1] };
    }
    arms.push(cur);
  }
  return arms;
}

export function classifyRiserCross(anchor: Point, segments: GeomSegment[], config: RiserCrossConfig = DEFAULT_RISER_CROSS_CONFIG): RiserCrossResult {
  const empty: RiserCrossResult = { crossingCount: 0, systemEvidence: null, hasForward: false, hasBackward: false, intersects: false, diagonals: [] };
  if (!config.enabled) return empty;
  const diagonals = segments.filter((s) => {
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    if (Math.hypot(mx - anchor.x, my - anchor.y) > config.searchRadius) return false;
    if (segLen(s) < config.minDiagonalLen) return false;
    const fromHorizontal = Math.min(angle180(s), 180 - angle180(s));
    if (Math.abs(fromHorizontal - 45) > config.diagonalToleranceDeg) return false;
    // The crossing must be centred on the symbol: its line has to pass near the anchor,
    // not merely clip the search circle. This rejects unrelated diagonals nearby.
    return pointToLine(anchor.x, anchor.y, s) <= config.searchRadius * 0.7;
  });
  if (!diagonals.length) return empty;
  const arms = mergeArms(diagonals);
  // Orientation buckets: "/" near 45°, "\" near 135° (0..180 space).
  const forward = arms.filter((s) => angle180(s) < 90);
  const backward = arms.filter((s) => angle180(s) >= 90);
  const hasForward = forward.length > 0, hasBackward = backward.length > 0;
  let intersects = false;
  for (const f of forward) for (const b of backward) if (segmentsIntersect(f, b)) intersects = true;
  const crossingCount = arms.length;
  let systemEvidence: RiserSystemEvidence | null = null;
  if (hasForward && hasBackward && intersects) systemEvidence = 'tulo';       // X → Tulo
  else if (crossingCount >= 1 && !(hasForward && hasBackward)) systemEvidence = 'poisto'; // single line → Poisto
  else if (hasForward && hasBackward) systemEvidence = 'tulo';                 // both arms but not proven to cross → still X-like
  return {
    crossingCount, systemEvidence, hasForward, hasBackward, intersects,
    diagonals: arms.map((s) => ({ angleDeg: Number(angle180(s).toFixed(1)), midX: Math.round((s.x1 + s.x2) / 2), midY: Math.round((s.y1 + s.y2) / 2), length: Math.round(segLen(s)) })),
  };
}
