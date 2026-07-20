import type { DetectionSuggestion } from './types';

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

function candidates(items: PdfTextItem[]): Array<{ normalized: string; raw: string; start: number; end: number }> {
  const positioned: PositionedText[] = items
    .filter((item) => item.str.trim())
    .map((item) => ({
      text: normalizePdfText(item.str), raw: item.str,
      x: item.transform[4] ?? 0, y: item.transform[5] ?? 0,
      width: Math.abs(item.width ?? 0), height: Math.max(1, Math.abs(item.transform[3] ?? item.transform[0] ?? 10)),
    }))
    .sort((a, b) => Math.abs(b.y - a.y) > Math.max(a.height, b.height) * 0.55 ? b.y - a.y : a.x - b.x);

  const result = positioned.map((item, index) => ({ normalized: compactCandidate(item.text), raw: item.raw, start: index, end: index }));
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
      result.push({ normalized: compactCandidate(joined), raw, start, end });
    }
  }
  return result;
}

export function detectLabels(items: PdfTextItem[], page: number): DetectionSuggestion[] {
  const matches: Array<{ model: string; quantity: number; raw: string; start: number; end: number }> = [];
  for (const candidate of candidates(items)) {
    const match = candidate.normalized.match(LABEL_RE);
    if (!match) continue;
    const model = match[2].toUpperCase();
    const quantity = Math.max(1, Number(match[1] ?? 1));
    matches.push({ model, quantity, raw: candidate.raw, start: candidate.start, end: candidate.end });
  }

  const maximalMatches = matches.filter((entry, index) => !matches.some((other, otherIndex) =>
    otherIndex !== index && other.model === entry.model && other.start <= entry.start && other.end >= entry.end
    && (other.end - other.start) > (entry.end - entry.start),
  ));
  const unique = new Map<string, { model: string; quantity: number; raw: string }>();
  maximalMatches.forEach((entry) => unique.set(`${entry.model}|${entry.quantity}|${entry.start}|${entry.end}`, entry));

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
