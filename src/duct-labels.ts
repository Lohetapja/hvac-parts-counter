import type { DuctProfile } from './duct-network-types';

// Recognises and normalises duct size / direction labels such as:
//   600x400 (E)   500x200 A25(E)   Ø160   YLÖS   ALAS
// Normalisation folds ×/x, whitespace, Ø/ø, optional parenthesised classifications
// and insulation / fire classes (A25, L30, EI60, ...).

export interface ParsedDuctLabel {
  normalized: string;
  kind: 'rectangular' | 'round' | 'ylos' | 'alas' | 'unknown';
  profile?: DuctProfile;
  classes: string[];
}

const CLASS_RE = /\b(?:A\d{2,3}|L\d{2,3}|EI?\d{2,3}|P\d{2,3})\b/gi;

export function normalizeLabelText(value: string): string {
  return value
    .replace(/[×✕╳]/g, 'x')
    .replace(/[øØ⌀]/g, 'Ø')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractClasses(value: string): string[] {
  const matches = value.match(CLASS_RE);
  return matches ? [...new Set(matches.map((entry) => entry.toUpperCase().replace(/^EI/, 'EI')))] : [];
}

export function parseDuctLabel(raw: string): ParsedDuctLabel | null {
  const normalized = normalizeLabelText(raw);
  if (!normalized) return null;
  const upper = normalized.toUpperCase();

  if (/\bYL[ÖO]S\b/.test(upper)) return { normalized: 'YLÖS', kind: 'ylos', classes: [] };
  if (/\bALAS\b/.test(upper)) return { normalized: 'ALAS', kind: 'alas', classes: [] };

  const classes = extractClasses(normalized);
  // Strip parenthesised classifications and standalone class tokens before matching size.
  const core = normalized.replace(/\([^)]*\)/g, ' ').replace(CLASS_RE, ' ').replace(/\s+/g, ' ').trim();

  const rect = core.match(/(\d{2,5})\s*x\s*(\d{2,5})/i);
  if (rect) {
    const widthMm = Number(rect[1]);
    const heightMm = Number(rect[2]);
    if (Number.isFinite(widthMm) && Number.isFinite(heightMm) && widthMm > 0 && heightMm > 0) {
      return { normalized: `${widthMm}×${heightMm}`, kind: 'rectangular', profile: { shape: 'rectangular', widthMm, heightMm }, classes };
    }
  }

  const round = core.match(/Ø\s*(\d{2,5})/) ?? core.match(/\bd\s*(\d{2,5})\b/i);
  if (round) {
    const diameterMm = Number(round[1]);
    if (Number.isFinite(diameterMm) && diameterMm > 0) {
      return { normalized: `Ø${diameterMm}`, kind: 'round', profile: { shape: 'round', diameterMm }, classes };
    }
  }

  return null;
}

// Parses a free-text size string (e.g. from a route "size" field) into a profile.
export function profileFromSizeText(raw: string): DuctProfile | undefined {
  return parseDuctLabel(raw)?.profile;
}
