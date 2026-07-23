// Stage-2 geometry-first duct tracing, harness-only. Reconstructs long edges from the
// (often dash-dot / fragmented) vector segments, pairs parallel close edges into duct
// candidates, and — given a seed point inside a duct — builds a closed full-body
// footprint polygon with a measured centreline length. No rasterization needed, so it
// runs even though this environment cannot render the PDF (hidden pane → rAF paused).
import { writeFileSync, mkdirSync } from 'node:fs';
import { extractRichSegments, type Seg } from './pdf-inspector.mts';

interface Edge { ox: number; oy: number; ux: number; uy: number; tmin: number; tmax: number; angle: number; len: number; }
const CELL = 40;
function angleOf(x1: number, y1: number, x2: number, y2: number): number { let a = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI; a = ((a % 180) + 180) % 180; return a; }
function angleDelta(a: number, b: number): number { const d = Math.abs(a - b); return Math.min(d, 180 - d); }
function segLen(s: Seg): number { return Math.hypot(s.x2 - s.x1, s.y2 - s.y1); }

class Grid {
  private g = new Map<string, number[]>();
  constructor(public segs: Seg[]) { segs.forEach((s, i) => { const x0 = Math.min(s.x1, s.x2), x1 = Math.max(s.x1, s.x2), y0 = Math.min(s.y1, s.y2), y1 = Math.max(s.y1, s.y2); for (let gx = Math.floor(x0/CELL); gx <= Math.floor(x1/CELL); gx++) for (let gy = Math.floor(y0/CELL); gy <= Math.floor(y1/CELL); gy++) { const k = `${gx},${gy}`; (this.g.get(k) ?? this.g.set(k, []).get(k)!).push(i); } }); }
  near(x: number, y: number, r: number): number[] { const f = new Set<number>(); for (let gx = Math.floor((x-r)/CELL); gx <= Math.floor((x+r)/CELL); gx++) for (let gy = Math.floor((y-r)/CELL); gy <= Math.floor((y+r)/CELL); gy++) this.g.get(`${gx},${gy}`)?.forEach((i) => f.add(i)); return [...f]; }
}

// Grow a collinear edge from a seed segment, bridging small gaps (dash-dot, fragmentation).
function growEdge(grid: Grid, seed: number, used: Uint8Array, angleTol = 3, perpTol = 1.6, gapTol = 14): Edge {
  const s = grid.segs[seed]; const len0 = segLen(s) || 1; const ux = (s.x2-s.x1)/len0, uy = (s.y2-s.y1)/len0; const base = angleOf(s.x1, s.y1, s.x2, s.y2);
  const proj = (x: number, y: number) => (x-s.x1)*ux + (y-s.y1)*uy; const perp = (x: number, y: number) => Math.abs(-(x-s.x1)*uy + (y-s.y1)*ux);
  let tmin = 0, tmax = len0; used[seed] = 1; let grew = true, guard = 0;
  while (grew && guard++ < 40) { grew = false; const mx = s.x1 + ux*(tmin+tmax)/2, my = s.y1 + uy*(tmin+tmax)/2;
    for (const i of grid.near(mx, my, (tmax-tmin)/2 + 50)) { if (used[i]) continue; const t = grid.segs[i];
      if (angleDelta(angleOf(t.x1,t.y1,t.x2,t.y2), base) > angleTol) continue;
      if (perp(t.x1,t.y1) > perpTol || perp(t.x2,t.y2) > perpTol) continue;
      const p0 = proj(t.x1,t.y1), p1 = proj(t.x2,t.y2), lo = Math.min(p0,p1), hi = Math.max(p0,p1);
      if (lo > tmax + gapTol || hi < tmin - gapTol) continue;
      if (lo < tmin - 1e-6 || hi > tmax + 1e-6) { tmin = Math.min(tmin, lo); tmax = Math.max(tmax, hi); grew = true; } used[i] = 1;
    }
  }
  return { ox: s.x1, oy: s.y1, ux, uy, tmin, tmax, angle: base, len: tmax - tmin };
}

function reconstructEdges(segs: Seg[]): Edge[] {
  const pool = segs.filter((s) => { const l = segLen(s); return l >= 2 && l <= 900; });
  const grid = new Grid(pool); const used = new Uint8Array(pool.length);
  const order = [...pool.keys()].sort((a, b) => segLen(pool[b]) - segLen(pool[a]));
  const edges: Edge[] = [];
  for (const i of order) { if (used[i]) continue; const e = growEdge(grid, i, used); if (e.len >= 45) edges.push(e); }
  return edges.sort((a, b) => b.len - a.len);
}

function edgePt(e: Edge, t: number) { return { x: e.ox + e.ux*t, y: e.oy + e.uy*t }; }
function perpDistPointToEdge(e: Edge, x: number, y: number): number { return Math.abs(-(x-e.ox)*e.uy + (y-e.oy)*e.ux); }
function projOnEdge(e: Edge, x: number, y: number): number { return (x-e.ox)*e.ux + (y-e.oy)*e.uy; }
function overlap(a: Edge, b: Edge): number { const b0 = projOnEdge(a, b.ox+b.ux*b.tmin, b.oy+b.uy*b.tmin), b1 = projOnEdge(a, b.ox+b.ux*b.tmax, b.oy+b.uy*b.tmax); const lo = Math.max(a.tmin, Math.min(b0,b1)), hi = Math.min(a.tmax, Math.max(b0,b1)); return Math.max(0, hi-lo) / Math.max(1, a.len); }

interface DuctPair { a: Edge; b: Edge; separation: number; overlapLen: number; cx: number; cy: number; }
function findDuctPairs(edges: Edge[], minSep = 3, maxSep = 80): DuctPair[] {
  const pairs: DuctPair[] = [];
  for (let i = 0; i < edges.length; i++) for (let j = i+1; j < edges.length; j++) { const a = edges[i], b = edges[j];
    if (angleDelta(a.angle, b.angle) > 4) continue;
    const sep = perpDistPointToEdge(a, b.ox + b.ux*(b.tmin+b.tmax)/2, b.oy + b.uy*(b.tmin+b.tmax)/2);
    if (sep < minSep || sep > maxSep) continue;
    const ov = overlap(a, b); if (ov < 0.45) continue;
    const mid = edgePt(a, (a.tmin+a.tmax)/2);
    pairs.push({ a, b, separation: sep, overlapLen: ov * a.len, cx: mid.x, cy: mid.y });
  }
  return pairs.sort((x, y) => y.overlapLen - x.overlapLen);
}

function footprintFromPair(p: DuctPair) {
  const a = p.a, b = p.b;
  const b0 = projOnEdge(a, b.ox+b.ux*b.tmin, b.oy+b.uy*b.tmin), b1 = projOnEdge(a, b.ox+b.ux*b.tmax, b.oy+b.uy*b.tmax);
  const lo = Math.max(a.tmin, Math.min(b0,b1)), hi = Math.min(a.tmax, Math.max(b0,b1));
  const nx = -a.uy, ny = a.ux;
  const sign = Math.sign((b.ox - a.ox)*nx + (b.oy - a.oy)*ny) || 1; const off = sign * p.separation;
  const a0 = edgePt(a, lo), a1 = edgePt(a, hi);
  const bp0 = { x: a0.x + nx*off, y: a0.y + ny*off }, bp1 = { x: a1.x + nx*off, y: a1.y + ny*off };
  const polygon = [a0, a1, bp1, bp0];
  const centreline = [{ x: (a0.x+bp0.x)/2, y: (a0.y+bp0.y)/2 }, { x: (a1.x+bp1.x)/2, y: (a1.y+bp1.y)/2 }];
  const lengthUnits = Math.hypot(centreline[1].x-centreline[0].x, centreline[1].y-centreline[0].y);
  return { polygon, centreline, lengthUnits, widthUnits: p.separation };
}

// Pick the duct pair straddling a seed point: seed between the two edges, near the midline.
function pairForSeed(pairs: DuctPair[], sx: number, sy: number): DuctPair | null {
  let best: { p: DuctPair; score: number } | null = null;
  for (const p of pairs) {
    const dA = perpDistPointToEdge(p.a, sx, sy), dB = perpDistPointToEdge(p.b, sx, sy);
    const between = dA <= p.separation + 3 && dB <= p.separation + 3 && Math.abs(dA + dB - p.separation) < p.separation*0.5 + 3;
    if (!between) continue;
    const t = projOnEdge(p.a, sx, sy); if (t < p.a.tmin - 10 || t > p.a.tmax + 10) continue;
    const score = Math.abs(dA - dB) + Math.abs(dA + dB - p.separation);
    if (!best || score < best.score) best = { p, score };
  }
  return best?.p ?? null;
}

function svgFor(region: { cx: number; cy: number; hw: number; hh: number }, edges: Edge[], pair: DuctPair | null, footprint: ReturnType<typeof footprintFromPair> | null, seed: { x: number; y: number } | null): string {
  const x0 = region.cx-region.hw, y0 = region.cy-region.hh, w = region.hw*2, h = region.hh*2;
  const tx = (x: number) => (x-x0).toFixed(1), ty = (y: number) => (y-y0).toFixed(1);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/>`;
  for (const e of edges) { const p0 = edgePt(e, e.tmin), p1 = edgePt(e, e.tmax); s += `<line x1="${tx(p0.x)}" y1="${ty(p0.y)}" x2="${tx(p1.x)}" y2="${ty(p1.y)}" stroke="#bcd" stroke-width="0.7"/>`; }
  if (footprint) { s += `<polygon points="${footprint.polygon.map((p) => `${tx(p.x)},${ty(p.y)}`).join(' ')}" fill="rgba(45,140,210,.35)" stroke="#1c6fb0" stroke-width="1.4"/>`; s += `<line x1="${tx(footprint.centreline[0].x)}" y1="${ty(footprint.centreline[0].y)}" x2="${tx(footprint.centreline[1].x)}" y2="${ty(footprint.centreline[1].y)}" stroke="#e07a1c" stroke-width="1" stroke-dasharray="8 5"/>`; }
  if (pair) for (const e of [pair.a, pair.b]) { const p0 = edgePt(e, e.tmin), p1 = edgePt(e, e.tmax); s += `<line x1="${tx(p0.x)}" y1="${ty(p0.y)}" x2="${tx(p1.x)}" y2="${ty(p1.y)}" stroke="#c33" stroke-width="1.4"/>`; }
  if (seed) s += `<circle cx="${tx(seed.x)}" cy="${ty(seed.y)}" r="4" fill="#e07a1c"/>`;
  return s + '</svg>';
}

const flag = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i+1] : undefined; };
const file = process.argv[2];
if (file) {
  const { segs } = await extractRichSegments(file);
  const edges = reconstructEdges(segs);
  const pairs = findDuctPairs(edges);
  mkdirSync('tools/out', { recursive: true });
  const sx = flag('--seed-x'), sy = flag('--seed-y');
  if (sx !== undefined && sy !== undefined) {
    const seed = { x: Number(sx), y: Number(sy) };
    const pair = pairForSeed(pairs, seed.x, seed.y);
    const footprint = pair ? footprintFromPair(pair) : null;
    const region = { cx: seed.x, cy: seed.y, hw: Number(flag('--region-hw') ?? 260), hh: Number(flag('--region-hh') ?? 190) };
    const near = edges.filter((e) => Math.abs(projOnEdge(e, seed.x, seed.y)) < 9999 && Math.hypot(edgePt(e,(e.tmin+e.tmax)/2).x-seed.x, edgePt(e,(e.tmin+e.tmax)/2).y-seed.y) < Math.max(region.hw, region.hh)*1.4);
    const svgPath = `tools/out/footprint_${Math.round(seed.x)}_${Math.round(seed.y)}.svg`;
    writeFileSync(svgPath, svgFor(region, near, pair, footprint, seed));
    console.log(JSON.stringify({ seed, foundPair: !!pair,
      pair: pair ? { separationUnits: Number(pair.separation.toFixed(1)), angleDeg: Number(pair.a.angle.toFixed(1)), overlapLenUnits: Number(pair.overlapLen.toFixed(0)) } : null,
      footprint: footprint ? { widthUnits: Number(footprint.widthUnits.toFixed(1)), lengthUnits: Number(footprint.lengthUnits.toFixed(1)), polygon: footprint.polygon.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) } : null,
      diagnosticSvg: svgPath }, null, 1));
  } else {
    console.log(JSON.stringify({ totalSegments: segs.length, reconstructedEdges: edges.length, ductPairCandidates: pairs.length,
      topCandidates: pairs.slice(0, 20).map((p) => ({ cx: Math.round(p.cx), cy: Math.round(p.cy), angleDeg: Number(p.a.angle.toFixed(1)), separationUnits: Number(p.separation.toFixed(1)), runLenUnits: Number(p.overlapLen.toFixed(0)) })) }, null, 1));
  }
}
