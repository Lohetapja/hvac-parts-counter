// Verifies classifyRiserCross() against real risers. IV 1 F carries YLÖS/ALAS as real
// text, so their anchors are locatable and the diagonal-cross classification can be
// checked on actual drawing geometry. (G3-03 carries them as vector glyphs, pending
// glyph recovery, so it cannot be text-anchored yet.)
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractLineSegments } from '../src/airflow.ts';
import { classifyRiserCross, DEFAULT_RISER_CROSS_CONFIG } from '../src/riser-cross.ts';

const file = process.argv[2] ?? 'local-test-drawings/IV 1 F (1).pdf';
const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true, isEvalSupported: false }).promise;
const page = await doc.getPage(1);
const vp = page.getViewport({ scale: 1 });
const tc = await page.getTextContent();
const ol = await page.getOperatorList();
const segs = extractLineSegments({ fnArray: [...ol.fnArray], argsArray: ol.argsArray as unknown[] }, [...vp.transform]).map((s) => ({ x1: s.start.x, y1: s.start.y, x2: s.end.x, y2: s.end.y }));

const anchors = tc.items
  .filter((it: any) => 'str' in it && /YL[ÖO]S|ALAS/i.test(it.str))
  .map((it: any) => { const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]); return { text: it.str.trim(), x, y }; });

let tulo = 0, poisto = 0, none = 0;
const rows = anchors.map((a) => {
  const r = classifyRiserCross({ x: a.x, y: a.y }, segs, DEFAULT_RISER_CROSS_CONFIG);
  if (r.systemEvidence === 'tulo') tulo++; else if (r.systemEvidence === 'poisto') poisto++; else none++;
  return { label: a.text, at: `${Math.round(a.x)},${Math.round(a.y)}`, arms: r.crossingCount, fwd: r.hasForward, bwd: r.hasBackward, X: r.intersects, evidence: r.systemEvidence };
});

console.log(JSON.stringify({ file: file.split(/[\\/]/).pop(), risers: anchors.length, tulo, poisto, none, sample: rows.slice(0, 24) }, null, 1));
