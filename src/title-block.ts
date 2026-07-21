import type { ScanField, ScanMetadata } from './duct-network-types';

// Spatial title-block extraction (no OCR). HVAC drawings place the title block in
// the lower-right corner. We read embedded PDF text there and match Finnish/English
// field labels to their values, recording a source and confidence for every field.

export interface PositionedText { text: string; x: number; y: number; width: number; height: number; }

function field(value: string, confidence: number, source: ScanField['source'] = 'title-block'): ScanField {
  return { value, source, confidence };
}
function empty(): ScanField { return { value: '', source: 'derived', confidence: 0 }; }

function normalize(value: string): string {
  return value.replace(/[×✕]/g, 'x').replace(/[øØ⌀]/g, 'Ø').replace(/\s+/g, ' ').trim();
}

// Label → metadata key. Matches common Finnish and English title-block captions.
const LABEL_MAP: Array<{ re: RegExp; key: keyof ScanMetadata }> = [
  { re: /^(kohde|rakennuskohde|project)\b/i, key: 'projectName' },
  { re: /^(osoite|address)\b/i, key: 'address' },
  { re: /^(piirustus(?:laji|nimi)?|drawing title|title|sis[aä]lt[oö])\b/i, key: 'title' },
  { re: /^(kerros|floor|krs)\b/i, key: 'floor' },
  { re: /^(piirustus(?:numero|nro|n:?o)|drawing (?:number|no)|piir\.?\s*n:?o)\b/i, key: 'drawingNumber' },
  { re: /^(mittakaava|scale|mk)\b/i, key: 'scale' },
  { re: /^(muutos|revisio|rev\.?)\b/i, key: 'revision' },
  { re: /^(p[aä]iv[aä](?:ys|m[aä][aä]r[aä])?|date|pvm)\b/i, key: 'date' },
  { re: /^(suunnittelija|piirt[aä]j[aä]|designer|drawn)\b/i, key: 'designer' },
  { re: /^(yritys|toimisto|company|suunnittelutoimisto)\b/i, key: 'company' },
];

const SCALE_RE = /\b1\s*[:：]\s*(\d{1,4})\b/;
const DATE_RE = /\b(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})\b/;
const FLOOR_RE = /\b(\d{1,2})\.?\s*krs\b/i;
const DRAWING_NO_RE = /\b([A-Z]{1,3}\d{1,3}[-\s]?\d{1,3})\b/;

function baseMetadata(fileName: string): ScanMetadata {
  return {
    fileName: field(fileName, 1, 'derived'),
    projectName: empty(), address: empty(), title: empty(), floor: empty(),
    drawingNumber: empty(), drawingType: field('HVAC / IV', 0.3, 'derived'), scale: empty(),
    revision: empty(), date: empty(), designer: empty(), company: empty(),
  };
}

export function extractTitleBlock(items: PositionedText[], fileName: string, pageWidth: number, pageHeight: number): ScanMetadata {
  const metadata = baseMetadata(fileName);
  if (!items.length) return metadata;

  // Lower-right region: right 42% width, bottom 34% height (PDF origin bottom-left).
  const regionLeft = pageWidth * 0.58;
  const regionTop = pageHeight * 0.34;
  const region = items.filter((item) => item.x >= regionLeft && item.y <= regionTop).map((item) => ({ ...item, text: normalize(item.text) })).filter((item) => item.text);
  const pool = region.length >= 4 ? region : items.map((item) => ({ ...item, text: normalize(item.text) })).filter((item) => item.text);

  // Match "Label: value" both inline and as the nearest text to the right / below.
  pool.forEach((item) => {
    const inline = item.text.match(/^([^:：]{2,40})[:：]\s*(.+)$/);
    const caption = inline ? inline[1] : item.text;
    const inlineValue = inline ? inline[2] : '';
    const mapping = LABEL_MAP.find((entry) => entry.re.test(caption));
    if (!mapping) return;
    if (inlineValue && metadata[mapping.key].confidence < 0.8) {
      // "Mittakaava 1:50" splits on the ratio colon; recombine a bare scale value.
      const value = mapping.key === 'scale' && /^\d{1,4}$/.test(inlineValue.trim()) ? `1:${inlineValue.trim()}` : inlineValue;
      metadata[mapping.key] = field(value, 0.8); return;
    }
    // Otherwise use the nearest text to the right on the same row, else just below.
    const right = pool.filter((other) => other !== item && Math.abs(other.y - item.y) <= Math.max(item.height, 6) && other.x > item.x + item.width - 2).sort((a, b) => a.x - b.x)[0];
    const below = pool.filter((other) => other !== item && other.y < item.y && item.y - other.y <= item.height * 2.4 && Math.abs(other.x - item.x) <= item.width * 1.5).sort((a, b) => b.y - a.y)[0];
    const value = right?.text || below?.text || '';
    if (value && metadata[mapping.key].confidence < 0.6) metadata[mapping.key] = field(value, 0.6);
  });

  // Pattern fallbacks scanned across the whole region.
  const joined = pool.map((item) => item.text).join('  ');
  if (!metadata.scale.value) { const match = joined.match(SCALE_RE); if (match) metadata.scale = field(`1:${match[1]}`, 0.7, 'derived'); }
  if (!metadata.date.value) { const match = joined.match(DATE_RE); if (match) metadata.date = field(match[1], 0.5, 'derived'); }
  if (!metadata.floor.value) { const match = joined.match(FLOOR_RE); if (match) metadata.floor = field(`${match[1]}. krs`, 0.6, 'derived'); }
  if (!metadata.drawingNumber.value) { const match = joined.match(DRAWING_NO_RE); if (match) metadata.drawingNumber = field(match[1], 0.4, 'derived'); }
  // Project name fallback: file-name stem often carries the drawing identifier.
  if (!metadata.projectName.value) { const stem = fileName.replace(/\.pdf$/i, '').trim(); if (stem) metadata.projectName = field(stem, 0.3, 'derived'); }
  return metadata;
}

// Applies the drawing scale from the title block to a scale ratio if one was found.
export function scaleRatioFromTitleBlock(metadata: ScanMetadata | null): number | null {
  if (!metadata) return null;
  const value = metadata.scale.value;
  const ratio = value.match(/1\s*[:：]\s*(\d{1,4})/);
  if (ratio) return Number(ratio[1]);
  const bare = value.match(/\b(\d{2,4})\b/);
  return bare ? Number(bare[1]) : null;
}
