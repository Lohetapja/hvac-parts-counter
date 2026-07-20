import type { DetectionLocation, DetectionSuggestion } from './types';

export interface PdfTextItem {
  str: string;
  transform: number[];
  width?: number;
}

interface PositionedText {
  text: string;
  raw: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const FAMILY = '(?:KSO|KTS|ROX(?:-S)?|OLO|FLO|VIVA(?:-S)?|RISD|IMUKARTIO)';
const PRODUCT = `${FAMILY}(?:[A-Z0-9+./_-]*[A-Z0-9])?`;
const LABEL_RE = new RegExp(`^(?:(\\d+)\\s*[xX]\\s*)?(${PRODUCT}(?:\\+${PRODUCT})*)$`, 'i');

export function normalizePdfText(value: string): string {
  return value
    .replace(/[×✕]/g, 'x')
    .replace(/[øØ]/g, 'Ø')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]+$/, '');
}

function compactCandidate(value: string): string {
  return normalizePdfText(value)
    .replace(/^(\d+\s*[xX]\s*)?(ROX|RISD|IMUKARTIO)\s+(?=[A-Z0-9])/i, '$1$2-')
    .replace(/\s+/g, '');
}

function hash(value: string): string {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return (result >>> 0).toString(36);
}

interface TextCandidate { normalized: string; raw: string; start: number; end: number; x: number; y: number; width: number; height: number }

function candidates(items: PdfTextItem[]): TextCandidate[] {
  const positioned: PositionedText[] = items
    .filter((item) => item.str.trim())
    .map((item) => ({
      text: normalizePdfText(item.str), raw: item.str,
      x: item.transform[4] ?? 0, y: item.transform[5] ?? 0,
      width: Math.abs(item.width ?? 0), height: Math.max(1, Math.abs(item.transform[3] ?? item.transform[0] ?? 10)),
    }))
    .sort((a, b) => Math.abs(b.y - a.y) > Math.max(a.height, b.height) * 0.55 ? b.y - a.y : a.x - b.x);

  const result = positioned.map((item, index) => ({ normalized: compactCandidate(item.text), raw: item.raw, start: index, end: index, x: item.x, y: item.y, width: item.width, height: item.height }));
  for (let start = 0; start < positioned.length; start += 1) {
    let joined = positioned[start].text;
    let raw = positioned[start].raw;
    let right = positioned[start].x + positioned[start].width;
    for (let end = start + 1; end < Math.min(positioned.length, start + 5); end += 1) {
      const previous = positioned[end - 1];
      const next = positioned[end];
      const sameLine = Math.abs(next.y - previous.y) <= Math.max(next.height, previous.height) * 0.55;
      const gap = next.x - right;
      if (!sameLine || gap > Math.max(28, next.height * 3) || gap < -4) break;
      joined += next.text;
      raw += ` | ${next.raw}`;
      right = next.x + next.width;
      result.push({ normalized: compactCandidate(joined), raw, start, end, x: positioned[start].x, y: positioned[start].y, width: Math.max(1, right - positioned[start].x), height: Math.max(positioned[start].height, next.height) });
    }
  }
  return result;
}

function matchedCandidates(items: PdfTextItem[]): Array<TextCandidate & { model: string; quantity: number }> {
  const matches: Array<TextCandidate & { model: string; quantity: number }> = [];
  for (const candidate of candidates(items)) {
    const match = candidate.normalized.match(LABEL_RE);
    if (match) matches.push({ ...candidate, model: match[2].toUpperCase(), quantity: Math.max(1, Number(match[1] ?? 1)) });
  }
  return matches.filter((entry, index) => !matches.some((other, otherIndex) =>
    otherIndex !== index && other.model === entry.model && other.start <= entry.start && other.end >= entry.end
    && (other.end - other.start) > (entry.end - entry.start),
  ));
}

export function detectLabelLocations(items: PdfTextItem[], page: number): DetectionLocation[] {
  const unique = new Map<string, DetectionLocation>();
  matchedCandidates(items).forEach((entry) => {
    const key = `${entry.model}|${entry.quantity}|${entry.start}|${entry.end}`;
    unique.set(key, { id: `label-${page}-${hash(key)}`, model: entry.model, quantity: entry.quantity, page, raw: entry.raw, x: entry.x, y: entry.y, width: Math.max(entry.width, entry.height), height: entry.height });
  });
  return [...unique.values()];
}

export function detectLabels(items: PdfTextItem[], page: number): DetectionSuggestion[] {
  const matches: Array<{ model: string; quantity: number; raw: string; start: number; end: number }> = [];
  matchedCandidates(items).forEach((candidate) => matches.push({ model: candidate.model, quantity: candidate.quantity, raw: candidate.raw, start: candidate.start, end: candidate.end }));
  const unique = new Map<string, { model: string; quantity: number; raw: string }>();
  matches.forEach((entry) => unique.set(`${entry.model}|${entry.quantity}|${entry.start}|${entry.end}`, entry));

  const grouped = new Map<string, DetectionSuggestion>();
  for (const entry of unique.values()) {
    const key = `${entry.model}|${entry.quantity}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.occurrences += 1;
      existing.quantity += entry.quantity;
      continue;
    }
    grouped.set(key, {
      id: `det-${page}-${hash(key)}`,
      model: entry.model,
      quantity: entry.quantity,
      occurrences: 1,
      page,
      raw: entry.raw,
    });
  }
  return [...grouped.values()].sort((a, b) => b.quantity - a.quantity || a.model.localeCompare(b.model));
}
