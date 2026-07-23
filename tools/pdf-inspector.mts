// Developer region inspector (Stage 1). Node-harness only — never shipped in the
// worker UI. Reads a local PDF in place, walks the operator list while tracking the
// CTM, current stroke width and dash pattern, and produces, for a rectangular region:
//   - path segments with stroke width, dash flag and source path id
//   - length + width histograms
//   - connected short-stroke glyph clusters (candidate exploded-text glyphs)
//   - long lines / leader / duct-boundary candidates
//   - a diagnostic SVG written to disk
//   - an ASCII glyph reader (short strokes only) so vector labels can be read
//
// Nothing here embeds or copies the PDF; it only reads bytes from the given path.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface Seg { x1: number; y1: number; x2: number; y2: number; w: number; dashed: boolean; path: number; }
export interface Region { cx: number; cy: number; hw: number; hh: number; }

function mul(a: number[], b: number[]): number[] {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
function ap(m: number[], x: number, y: number): [number, number] { return [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]]; }
function scaleOf(m: number[]): number { return Math.sqrt(Math.abs(m[0]*m[3]-m[1]*m[2])) || 1; }
function num(v: unknown): number[] | null { if (Array.isArray(v) && v.every((n) => typeof n === 'number')) return v as number[]; if (ArrayBuffer.isView(v)) return Array.from(v as ArrayLike<number>); return null; }

// Full extraction retaining stroke width + dash + path id, in viewport space.
export async function extractRichSegments(file: string): Promise<{ segs: Seg[]; width: number; height: number }> {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true, isEvalSupported: false }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList();
  const segs: Seg[] = [];
  const stack: Array<{ ctm: number[]; w: number; dash: boolean }> = [];
  let ctm = [1, 0, 0, 1, 0, 0]; let lineWidth = 1; let dash = false; let pathId = 0;
  const vt = [...vp.transform];
  const emit = (m: number[], ops: number[], coords: number[]): void => {
    let c = 0; let cur: [number, number] | null = null; let start: [number, number] | null = null;
    const wpx = lineWidth * scaleOf(m);
    for (const op of ops) {
      if (op === 0 || op === 1) { const p = ap(m, coords[c] ?? 0, coords[c+1] ?? 0); c += 2; if (op === 0) { cur = p; start = p; } else if (cur) { segs.push({ x1: cur[0], y1: cur[1], x2: p[0], y2: p[1], w: wpx, dashed: dash, path: pathId }); cur = p; } }
      else if (op === 2) { const p = ap(m, coords[c+4] ?? 0, coords[c+5] ?? 0); if (cur) segs.push({ x1: cur[0], y1: cur[1], x2: p[0], y2: p[1], w: wpx, dashed: dash, path: pathId }); cur = p; start ??= p; c += 6; }
      else if (op === 3 || op === 5 || op === 6) { const p = ap(m, coords[c+2] ?? 0, coords[c+3] ?? 0); if (cur) segs.push({ x1: cur[0], y1: cur[1], x2: p[0], y2: p[1], w: wpx, dashed: dash, path: pathId }); cur = p; start ??= p; c += 4; }
      else if (op === 4 && cur && start) { segs.push({ x1: cur[0], y1: cur[1], x2: start[0], y2: start[1], w: wpx, dashed: dash, path: pathId }); cur = start; }
    }
  };
  ol.fnArray.forEach((fn, i) => {
    const a = ol.argsArray[i] as any;
    if (fn === OPS.save) { stack.push({ ctm: [...ctm], w: lineWidth, dash }); return; }
    if (fn === OPS.restore) { const s = stack.pop(); if (s) { ctm = s.ctm; lineWidth = s.w; dash = s.dash; } return; }
    if (fn === OPS.transform) { const m = num(a); if (m && m.length >= 6) ctm = mul(ctm, m.slice(0, 6)); return; }
    if (fn === OPS.setLineWidth) { if (typeof a?.[0] === 'number') lineWidth = a[0]; return; }
    if (fn === OPS.setDash) { dash = Array.isArray(a?.[0]) && a[0].length > 0; return; }
    if (fn !== OPS.constructPath || !Array.isArray(a)) return;
    pathId += 1; const m = mul(vt, ctm); const ops = num(a[0]); const coords = num(a[1]);
    if (ops && coords) { emit(m, ops, coords); return; }
    if (Array.isArray(a[1])) a[1].forEach((sp: unknown) => { const st = num(sp); if (st) { const o: number[] = []; const cc: number[] = []; for (let k = 0; k < st.length;) { const op = st[k++]; o.push(op); const n = op === 0 || op === 1 ? 2 : op === 2 ? 6 : op === 3 || op === 5 || op === 6 ? 4 : 0; cc.push(...st.slice(k, k+n)); k += n; } emit(m, o, cc); } });
  });
  return { segs, width: vp.width, height: vp.height };
}

const len = (s: Seg): number => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const inRegion = (s: Seg, r: Region): boolean => {
  const x0 = r.cx - r.hw, x1 = r.cx + r.hw, y0 = r.cy - r.hh, y1 = r.cy + r.hh;
  return (s.x1 >= x0 && s.x1 <= x1 && s.y1 >= y0 && s.y1 <= y1) || (s.x2 >= x0 && s.x2 <= x1 && s.y2 >= y0 && s.y2 <= y1);
};

export interface Cluster { n: number; minx: number; miny: number; maxx: number; maxy: number; members: number[]; }
// Connected-component clustering of strokes → candidate glyph groups (with members).
export function clusterStrokes(pool: Seg[], gap = 6): Cluster[] {
  const cell = Math.max(2, gap); const grid = new Map<string, number[]>();
  pool.forEach((s, i) => { const mx = (s.x1+s.x2)/2, my = (s.y1+s.y2)/2; const k = `${Math.floor(mx/cell)},${Math.floor(my/cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  const seen = new Uint8Array(pool.length); const out: Cluster[] = [];
  const endpts = (s: Seg) => [[s.x1, s.y1], [s.x2, s.y2]] as const;
  for (let i = 0; i < pool.length; i++) {
    if (seen[i]) continue; const stack = [i]; seen[i] = 1; let n = 0, minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9; const members: number[] = [];
    while (stack.length) { const j = stack.pop()!; n++; members.push(j); const sj = pool[j];
      for (const [px, py] of endpts(sj)) { minx = Math.min(minx, px); miny = Math.min(miny, py); maxx = Math.max(maxx, px); maxy = Math.max(maxy, py); }
      const cx = Math.floor(((sj.x1+sj.x2)/2)/cell), cy = Math.floor(((sj.y1+sj.y2)/2)/cell);
      for (let gx = cx-1; gx <= cx+1; gx++) for (let gy = cy-1; gy <= cy+1; gy++) { for (const k of grid.get(`${gx},${gy}`) ?? []) { if (seen[k]) continue; const sk = pool[k];
        const close = endpts(sj).some(([ax, ay]) => endpts(sk).some(([bx, by]) => Math.hypot(ax-bx, ay-by) <= gap));
        if (close) { seen[k] = 1; stack.push(k); } } }
    }
    out.push({ n, minx, miny, maxx, maxy, members });
  }
  return out.sort((a, b) => b.n - a.n);
}
export function glyphClusters(short: Seg[], gap = 6) { return clusterStrokes(short, gap); }
// A glyph-sized cluster: enough strokes to be a character group, but not a long line.
export function isGlyphSized(c: Cluster): boolean {
  const w = c.maxx - c.minx, h = c.maxy - c.miny; const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
  return c.n >= 6 && w <= 70 && h <= 55 && aspect <= 6;
}

// ASCII raster of a region (optionally short strokes only) so labels can be read.
export function asciiRaster(segs: Seg[], r: Region, opts: { maxLen?: number; cols?: number } = {}): string {
  const x0 = r.cx - r.hw, x1 = r.cx + r.hw, y0 = r.cy - r.hh, y1 = r.cy + r.hh;
  const local = segs.filter((s) => inRegion(s, r) && (opts.maxLen ? len(s) <= opts.maxLen : true));
  const COLS = opts.cols ?? Math.min(220, Math.round(x1 - x0));
  const ROWS = Math.max(6, Math.round(COLS * (y1 - y0) / (x1 - x0) * 0.5));
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
  const put = (px: number, py: number) => { const gx = Math.round((px-x0)/(x1-x0)*(COLS-1)); const gy = Math.round((py-y0)/(y1-y0)*(ROWS-1)); if (gx>=0&&gx<COLS&&gy>=0&&gy<ROWS) grid[gy][gx] = '#'; };
  for (const s of local) { const steps = Math.max(2, Math.ceil(len(s))); for (let i=0;i<=steps;i++){ const t=i/steps; put(s.x1+(s.x2-s.x1)*t, s.y1+(s.y2-s.y1)*t); } }
  return grid.map((r) => r.join('')).join('\n');
}

// Diagnostic SVG of a region: glyph strokes (thin), long lines (thick), leaders (red).
export function regionSvg(segs: Seg[], r: Region): string {
  const x0 = r.cx - r.hw, y0 = r.cy - r.hh, w = r.hw*2, h = r.hh*2;
  const local = segs.filter((s) => inRegion(s, r));
  const line = (s: Seg, col: string, sw: number) => `<line x1="${(s.x1-x0).toFixed(1)}" y1="${(s.y1-y0).toFixed(1)}" x2="${(s.x2-x0).toFixed(1)}" y2="${(s.y2-y0).toFixed(1)}" stroke="${col}" stroke-width="${sw}"/>`;
  const body = local.map((s) => { const l = len(s); return l < 22 ? line(s, '#0a7', 0.6) : l > 120 ? line(s, '#c33', 1.4) : line(s, '#357', 1.0); }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/>${body}</svg>`;
}

export function regionReport(segs: Seg[], r: Region) {
  const local = segs.filter((s) => inRegion(s, r));
  const short = local.filter((s) => len(s) < 22);
  const long = local.filter((s) => len(s) > 60);
  const clusters = clusterStrokes(short).filter(isGlyphSized);
  const widthHist: Record<string, number> = {};
  for (const s of local) { const b = s.w < 0.8 ? 'thin<0.8' : s.w < 1.6 ? '0.8-1.6' : s.w < 3 ? '1.6-3' : '>3'; widthHist[b] = (widthHist[b] ?? 0) + 1; }
  return { region: r, totalSegments: local.length, shortStrokes: short.length, longLines: long.length, glyphClusters: clusters.length, widthHist,
    clusters: clusters.slice(0, 30).map((c) => ({ n: c.n, cx: Math.round((c.minx+c.maxx)/2), cy: Math.round((c.miny+c.maxy)/2), w: Math.round(c.maxx-c.minx), h: Math.round(c.maxy-c.miny) })) };
}

// CLI: node pdf-inspector.bundle.mjs <file> <cx> <cy> <hw> <hh> [read|svg|report]
// Flag parsing so a captured browser seed can be fed straight in:
//   node pdf-inspector.bundle.mjs <file> --seed-x <vx> --seed-y <vy> [--width 500 --height 200] [--region-hw 250 --region-hh 180]
function flag(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
// Only act as a CLI when run directly (not when imported as a library by duct-trace).
const RUN_CLI = (process.argv[1] ?? '').includes('pdf-inspector');
const seedX = flag('--seed-x'); const seedY = flag('--seed-y');
if (RUN_CLI && process.argv[2] && seedX !== undefined && seedY !== undefined) {
  const file = process.argv[2];
  const sx = Number(seedX), sy = Number(seedY);
  const hw = Number(flag('--region-hw') ?? 250), hh = Number(flag('--region-hh') ?? 180);
  const dw = flag('--width') ? Number(flag('--width')) : undefined; const dh = flag('--height') ? Number(flag('--height')) : undefined;
  const r: Region = { cx: sx, cy: sy, hw, hh };
  const { segs } = await extractRichSegments(file);
  mkdirSync('tools/out', { recursive: true });
  const svgPath = `tools/out/seed_${Math.round(sx)}_${Math.round(sy)}.svg`; writeFileSync(svgPath, regionSvg(segs, r));
  console.log(JSON.stringify({
    seed: { viewportX: sx, viewportY: sy, assignedProfile: dw && dh ? `rectangular ${dw}x${dh}` : null },
    diagnosticRegion: r,
    report: regionReport(segs, r),
    diagnosticSvg: svgPath,
  }, null, 1));
} else if (RUN_CLI) {
const [,, file, cxs, cys, hws, hhs, mode = 'report'] = process.argv;
if (file) {
  const r: Region = { cx: Number(cxs), cy: Number(cys), hw: Number(hws ?? 120), hh: Number(hhs ?? 30) };
  const { segs } = await extractRichSegments(file);
  if (mode === 'read') { console.log(asciiRaster(segs, r, { maxLen: 22, cols: 200 })); }
  else if (mode === 'readall') { console.log(asciiRaster(segs, r, { cols: 200 })); }
  else if (mode === 'glyphread') {
    // Render only strokes belonging to glyph-sized clusters — excludes dash-dot duct lines.
    const local = segs.filter((s) => inRegion(s, r) && len(s) < 22);
    const clusters = clusterStrokes(local).filter(isGlyphSized);
    const keep = new Set<number>(); clusters.forEach((c) => c.members.forEach((m) => keep.add(m)));
    const glyphSegs = local.filter((_, i) => keep.has(i));
    console.log(`glyph clusters kept: ${clusters.length}`);
    console.log(asciiRaster(glyphSegs, r, { cols: 200 }));
  }
  else if (mode === 'svg') { mkdirSync('tools/out', { recursive: true }); const p = `tools/out/region_${r.cx}_${r.cy}.svg`; writeFileSync(p, regionSvg(segs, r)); console.log('wrote', p); }
  else if (mode === 'clusters') {
    // Find glyph-sized clusters in the region and print each one tightly, isolated
    // from long lines, at high resolution so individual characters are readable.
    const local = segs.filter((s) => inRegion(s, r) && len(s) < 22);
    const clusters = clusterStrokes(local).filter(isGlyphSized).slice(0, Number(process.argv[8] ?? 12));
    clusters.forEach((c, i) => {
      const pad = 4; const bb: Region = { cx: (c.minx+c.maxx)/2, cy: (c.miny+c.maxy)/2, hw: (c.maxx-c.minx)/2+pad, hh: (c.maxy-c.miny)/2+pad };
      const strokes = c.members.map((m) => local[m]);
      const cols = Math.min(120, Math.max(24, Math.round((c.maxx-c.minx+2*pad) * 1.4)));
      const x0 = bb.cx-bb.hw, x1 = bb.cx+bb.hw, y0 = bb.cy-bb.hh, y1 = bb.cy+bb.hh;
      const rows = Math.max(6, Math.round(cols * (y1-y0)/(x1-x0)));
      const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
      const put = (px: number, py: number) => { const gx = Math.round((px-x0)/(x1-x0)*(cols-1)); const gy = Math.round((py-y0)/(y1-y0)*(rows-1)); if (gx>=0&&gx<cols&&gy>=0&&gy<rows) grid[gy][gx] = '#'; };
      for (const s of strokes) { const st = Math.max(2, Math.ceil(len(s)*2)); for (let k=0;k<=st;k++){ const t=k/st; put(s.x1+(s.x2-s.x1)*t, s.y1+(s.y2-s.y1)*t); } }
      console.log(`\n--- cluster ${i} @ (${Math.round(bb.cx)},${Math.round(bb.cy)}) strokes=${c.n} w=${Math.round(c.maxx-c.minx)} h=${Math.round(c.maxy-c.miny)} ---`);
      console.log(grid.map((r) => r.join('')).join('\n'));
    });
  }
  else if (mode === 'textlines') {
    // Locate label text lines: small character-sized clusters sharing a baseline and
    // regular spacing form a horizontal run (e.g. "500x200 A25(E)"). Reports runs so
    // labels can be located without recognising the glyphs.
    const local = segs.filter((s) => (r.hw ? inRegion(s, r) : true) && len(s) < 22);
    const chars = clusterStrokes(local).filter((c) => { const w = c.maxx-c.minx, h = c.maxy-c.miny; return c.n >= 3 && c.n <= 90 && w >= 2 && w <= 34 && h >= 6 && h <= 30; })
      .map((c) => ({ cx: (c.minx+c.maxx)/2, cy: (c.miny+c.maxy)/2, w: c.maxx-c.minx, h: c.maxy-c.miny }));
    chars.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
    const used = new Uint8Array(chars.length); const runs: Array<{ chars: typeof chars }> = [];
    for (let i = 0; i < chars.length; i++) { if (used[i]) continue; const line = [chars[i]]; used[i] = 1; const h0 = chars[i].h;
      let extended = true; while (extended) { extended = false; const last = line[line.length-1];
        for (let j = 0; j < chars.length; j++) { if (used[j]) continue; const c = chars[j];
          if (Math.abs(c.cy - last.cy) <= h0*0.55 && c.cx > last.cx && c.cx - last.cx <= Math.max(22, last.w*1.8)) { line.push(c); used[j] = 1; extended = true; break; } } }
      if (line.length >= 3) runs.push({ chars: line });
    }
    const report = runs.map((run) => { const xs = run.chars.map((c) => c.cx), ys = run.chars.map((c) => c.cy); const minx = Math.min(...run.chars.map((c) => c.cx-c.w/2)), maxx = Math.max(...run.chars.map((c) => c.cx+c.w/2)); return { chars: run.chars.length, cx: Math.round((minx+maxx)/2), cy: Math.round(ys.reduce((a,b)=>a+b,0)/ys.length), width: Math.round(maxx-minx), height: Math.round(Math.max(...run.chars.map((c)=>c.h))) }; })
      .filter((r) => r.width >= 20).sort((a, b) => b.chars - a.chars);
    console.log(JSON.stringify({ region: r.hw ? r : 'whole page', textRuns: report.length, runs: report.slice(0, 40) }, null, 1));
  }
  else if (mode === 'readlines') {
    // Group character-sized clusters into horizontal text runs, then render each run's
    // strokes to ASCII so duct-size labels (500x200, Ø160, PL, UR) can be read. Device
    // symbols (near-square, tall) and long lines are excluded by shape.
    const local = segs.filter((s) => (r.hw ? inRegion(s, r) : true) && len(s) < 22);
    const clusters = clusterStrokes(local).filter((c) => { const w = c.maxx-c.minx, h = c.maxy-c.miny; return c.n >= 3 && c.n <= 140 && w >= 2 && w <= 46 && h >= 5 && h <= 30; })
      .map((c) => ({ cx: (c.minx+c.maxx)/2, cy: (c.miny+c.maxy)/2, w: c.maxx-c.minx, h: c.maxy-c.miny, minx: c.minx, miny: c.miny, maxx: c.maxx, maxy: c.maxy, members: c.members }));
    clusters.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
    const used = new Uint8Array(clusters.length); const runs: Array<typeof clusters> = [];
    for (let i = 0; i < clusters.length; i++) { if (used[i]) continue; const line = [clusters[i]]; used[i] = 1; const h0 = clusters[i].h;
      let ext = true; while (ext) { ext = false; const last = line[line.length-1];
        for (let j = 0; j < clusters.length; j++) { if (used[j]) continue; const c = clusters[j];
          if (Math.abs(c.cy - last.cy) <= h0*0.6 && c.cx > last.cx && c.minx - last.maxx <= Math.max(14, last.w*0.9)) { line.push(c); used[j] = 1; ext = true; break; } } }
      runs.push(line);
    }
    const shaped = runs.map((run) => { const minx = Math.min(...run.map((c) => c.minx)), maxx = Math.max(...run.map((c) => c.maxx)), miny = Math.min(...run.map((c) => c.miny)), maxy = Math.max(...run.map((c) => c.maxy)); return { run, minx, maxx, miny, maxy, w: maxx-minx, h: maxy-miny }; })
      .filter((g) => g.run.length >= 2 && g.w >= 28 && g.w <= 340 && g.h <= 32).sort((a, b) => b.w - a.w).slice(0, Number(process.argv[8] ?? 18));
    console.log(`text runs: ${shaped.length}`);
    for (const g of shaped) {
      const pad = 3; const x0 = g.minx-pad, x1 = g.maxx+pad, y0 = g.miny-pad, y1 = g.maxy+pad;
      const strokes = g.run.flatMap((c) => c.members.map((m) => local[m]));
      const cols = Math.min(200, Math.max(30, Math.round((x1-x0)*1.5))); const rows = Math.max(6, Math.round(cols*(y1-y0)/(x1-x0)));
      const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
      const put = (px: number, py: number) => { const gx = Math.round((px-x0)/(x1-x0)*(cols-1)); const gy = Math.round((py-y0)/(y1-y0)*(rows-1)); if (gx>=0&&gx<cols&&gy>=0&&gy<rows) grid[gy][gx]='#'; };
      for (const s of strokes) { const st = Math.max(2, Math.ceil(len(s)*2)); for (let k=0;k<=st;k++){ const t=k/st; put(s.x1+(s.x2-s.x1)*t, s.y1+(s.y2-s.y1)*t); } }
      console.log(`\n--- run @ (${Math.round((g.minx+g.maxx)/2)},${Math.round((g.miny+g.maxy)/2)}) w=${Math.round(g.w)} h=${Math.round(g.h)} chars=${g.run.length} ---`);
      console.log(grid.map((r) => r.join('')).join('\n'));
    }
  }
  else if (mode === 'geom') {
    // Whole-page duct-geometry census: dashed segments and the longest lines, so a
    // real duct run can be located (and a Stage-2 seed picked) without reading labels.
    const dashed = segs.filter((s) => s.dashed);
    const longDashed = dashed.filter((s) => len(s) > 25).sort((a, b) => len(b) - len(a));
    const longAny = [...segs].sort((a, b) => len(b) - len(a)).slice(0, 40);
    // Spatial density of dashed strokes on a coarse grid → where the duct network lives.
    const CELL = 150; const cells = new Map<string, number>();
    dashed.forEach((s) => { const k = `${Math.floor((s.x1+s.x2)/2/CELL)},${Math.floor((s.y1+s.y2)/2/CELL)}`; cells.set(k, (cells.get(k) ?? 0) + 1); });
    const denseDash = [...cells.entries()].map(([k, n]) => { const [gx, gy] = k.split(',').map(Number); return { cx: gx*CELL+CELL/2, cy: gy*CELL+CELL/2, n }; }).sort((a, b) => b.n - a.n).slice(0, 20);
    console.log(JSON.stringify({
      totalSegments: segs.length,
      dashedSegments: dashed.length,
      longDashedSegments: longDashed.length,
      dashedDensityGrid150: denseDash,
      longestLines: longAny.slice(0, 20).map((s) => ({ x1: Math.round(s.x1), y1: Math.round(s.y1), x2: Math.round(s.x2), y2: Math.round(s.y2), len: Math.round(len(s)), w: Number(s.w.toFixed(2)), dashed: s.dashed })),
    }, null, 1));
  }
  else { console.log(JSON.stringify(regionReport(segs, r), null, 1)); }
}
}
