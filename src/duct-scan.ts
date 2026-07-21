import type { Point } from './types';
import type {
  ContractBoundary, DuctNetwork, DuctNode, DuctNodeType, DuctProfile, DuctSegment,
  ReviewStatus, ScanDiagnostics, ScanMetadata, ScanSummary,
} from './duct-network-types';
import { parseDuctLabel, normalizeLabelText } from './duct-labels';
import { extractTitleBlock, type PositionedText } from './title-block';
import { uid } from './duct-network';

// Local, staged drawing scan. No OCR, no backend, no AI. Candidate components are
// derived from embedded PDF text labels + cached vector-symbol evidence and grouped
// into per-system networks. Every candidate carries a confidence and review status.

export interface ScanLine { start: Point; end: Point; }
export interface ScanInput {
  page: number; fileName: string; pageWidth: number; pageHeight: number;
  textItems: PositionedText[]; segments: ScanLine[]; mmPerPdfPoint: number;
}
export interface ScanOutput {
  metadata: ScanMetadata; summary: ScanSummary; diagnostics: ScanDiagnostics;
  networks: DuctNetwork[]; nodes: DuctNode[]; segments: DuctSegment[]; boundaries: ContractBoundary[];
}

type SystemKind = 'supply' | 'extract' | 'unknown';

interface Recognition {
  kind: 'round-size' | 'rect-size' | 'terminal' | 'damper' | 'fire-damper' | 'silencer' | 'cleaning-hatch' | 'ur' | 'ylos' | 'alas' | 'annotation';
  nodeType: DuctNodeType;
  category: string;
  label: string;
  profile?: DuctProfile;
  quantity: number;
  system: SystemKind;
  confidence: number;
}

const DEVICE_RE = /\b(T\d{0,2}|P\d{0,2}|KSO|KTS|ROX(?:-S)?|OLO|FLO|VIVA(?:-S)?|RISD|IMUKARTIO)\b/i;
const IRIS_RE = /\b(IRIS)\b/i;
const PRA_RE = /\b(PRA)\b/i;
const FIRE_RE = /\b(palopelti|fire damper|EI\d{2,3})\b/i;
const SILENCER_RE = /\b(vaimennin|silencer|[AÄ][AÄ]NENVAIMENNIN)\b/i;
const MULT_RE = /^\s*(\d{1,3})\s*(?:x|kpl|st)\b/i;

function recognize(raw: string): Recognition | null {
  const normalized = normalizeLabelText(raw);
  if (!normalized) return null;
  const upper = normalized.toUpperCase();
  const multMatch = normalized.match(MULT_RE);
  const quantity = multMatch ? Math.max(1, Number(multMatch[1])) : 1;

  if (/\bUR\b/.test(upper)) return { kind: 'ur', nodeType: 'unknown', category: 'Boundary', label: 'UR / urakkaraja', quantity: 1, system: 'unknown', confidence: 0.9 };
  if (/\bYL[ÖO]S\b/.test(upper)) return { kind: 'ylos', nodeType: 'continuation', category: 'Continuation', label: 'YLÖS continuation', quantity: 1, system: 'unknown', confidence: 0.85 };
  if (/\bALAS\b/.test(upper)) return { kind: 'alas', nodeType: 'continuation', category: 'Continuation', label: 'ALAS continuation', quantity: 1, system: 'unknown', confidence: 0.85 };
  if (/\bPL\b/.test(upper)) return { kind: 'cleaning-hatch', nodeType: 'cleaning-hatch', category: 'Access', label: 'PL cleaning hatch', quantity, system: 'unknown', confidence: 0.75 };
  if (FIRE_RE.test(normalized)) return { kind: 'fire-damper', nodeType: 'fire-damper', category: 'Damper', label: 'Fire damper', quantity, system: 'unknown', confidence: 0.6 };
  if (SILENCER_RE.test(normalized)) return { kind: 'silencer', nodeType: 'silencer', category: 'Silencer', label: 'Silencer', quantity, system: 'unknown', confidence: 0.6 };
  if (IRIS_RE.test(normalized) || PRA_RE.test(normalized)) return { kind: 'damper', nodeType: 'damper', category: 'Damper', label: IRIS_RE.test(normalized) ? 'IRIS damper' : 'PRA damper', quantity, system: 'unknown', confidence: 0.7 };

  const parsed = parseDuctLabel(normalized);
  if (parsed?.profile) {
    if (parsed.profile.shape === 'round') {
      // Small round runs off a main are branch candidates; larger are duct runs.
      const branch = parsed.profile.diameterMm <= 200;
      return { kind: 'round-size', nodeType: branch ? 'branch' : 'duct', category: branch ? 'Branch' : 'Duct', label: `${parsed.normalized}${branch ? ' branch' : ' round duct'}`, profile: parsed.profile, quantity, system: 'unknown', confidence: 0.7 };
    }
    return { kind: 'rect-size', nodeType: 'duct', category: 'Duct', label: `${parsed.normalized} rectangular duct`, profile: parsed.profile, quantity, system: 'unknown', confidence: 0.7 };
  }

  const device = normalized.match(DEVICE_RE);
  if (device) {
    const token = device[1].toUpperCase();
    const system: SystemKind = token.startsWith('T') ? 'supply' : token.startsWith('P') ? 'extract' : 'unknown';
    return { kind: 'terminal', nodeType: 'terminal', category: 'Terminal', label: `${normalized} terminal`, quantity, system, confidence: system === 'unknown' ? 0.5 : 0.75 };
  }
  return null;
}

function reviewFromConfidence(confidence: number, ambiguous: boolean): ReviewStatus {
  if (ambiguous) return 'unresolved';
  if (confidence >= 0.75) return 'confirmed';
  if (confidence >= 0.5) return 'likely';
  return 'unresolved';
}

// Infers a candidate's system from its own label and nearby arrow-like short vector
// clusters (open/outward = supply evidence, filled/inward = extract). Fill state is
// frequently unavailable in PDFs, so we combine several cheap signals conservatively.
function inferSystem(base: SystemKind, point: Point, segments: ScanLine[]): { system: SystemKind; confidence: number } {
  if (base !== 'unknown') return { system: base, confidence: 0.2 };
  // Count short segments (arrow shafts/heads) within a small radius as weak evidence.
  const near = segments.filter((line) => {
    const mx = (line.start.x + line.end.x) / 2; const my = (line.start.y + line.end.y) / 2;
    return Math.hypot(mx - point.x, my - point.y) <= 40;
  }).length;
  // Without reliable fill/direction we cannot decide; leave unknown but note density.
  return { system: 'unknown', confidence: near > 6 ? 0.15 : 0 };
}

export function scanDrawing(input: ScanInput): ScanOutput {
  const started = performance.now();
  const metadata = extractTitleBlock(input.textItems, input.fileName, input.pageWidth, input.pageHeight);

  const now = new Date().toISOString();
  const makeNetwork = (system: 'supply' | 'extract' | 'unknown', name: string): DuctNetwork => ({
    id: uid('dnet'), pageNumber: input.page, name, systemType: system, segmentIds: [], nodeIds: [],
    verificationStatus: 'suggested', source: 'assisted-vector', notes: 'Auto-scanned candidate network.', createdAt: now, updatedAt: now,
  });
  const tulo = makeNetwork('supply', `Scanned Tulo (page ${input.page})`);
  const poisto = makeNetwork('extract', `Scanned Poisto (page ${input.page})`);
  const unknown = makeNetwork('unknown', `Scanned unclassified (page ${input.page})`);
  const networkFor = (system: SystemKind): DuctNetwork => system === 'supply' ? tulo : system === 'extract' ? poisto : unknown;

  const nodes: DuctNode[] = [];
  const boundaries: ContractBoundary[] = [];
  const diagnosticsLabels: ScanDiagnostics['labels'] = [];
  const unresolvedReasons = new Set<string>();
  let partCandidates = 0;

  input.textItems.forEach((item) => {
    const recognition = recognize(item.text);
    if (!recognition) return;
    const point: Point = { x: item.x, y: item.y };
    diagnosticsLabels.push({ raw: item.text, normalized: recognition.label, kind: recognition.kind, x: point.x, y: point.y });

    if (recognition.kind === 'ur') {
      boundaries.push({ id: uid('dur'), pageNumber: input.page, point, relatedNetworkId: undefined, scopeSide: 'unknown', verificationStatus: 'suggested', notes: 'Scanned UR boundary' });
      unresolvedReasons.add('UR boundary needs a project-side decision');
      return;
    }

    const inferred = inferSystem(recognition.system, point, input.segments);
    const network = networkFor(inferred.system);
    const ambiguous = inferred.system === 'unknown' && (recognition.kind === 'round-size' || recognition.kind === 'rect-size' || recognition.kind === 'terminal');
    const confidence = Math.min(0.95, recognition.confidence + inferred.confidence);
    const reviewStatus = reviewFromConfidence(confidence, ambiguous);
    if (ambiguous) unresolvedReasons.add(`${recognition.label}: system not determinable from labels alone`);
    if (recognition.nodeType === 'duct') unresolvedReasons.add(`${recognition.label}: straight length not measurable from text`);

    for (let index = 0; index < recognition.quantity; index += 1) {
      const node: DuctNode = {
        id: uid('dnode'), pageNumber: input.page, networkId: network.id,
        point: { x: point.x + index * 0.01, y: point.y }, type: recognition.nodeType,
        direction: recognition.kind === 'ylos' ? 'up' : recognition.kind === 'alas' ? 'down' : undefined,
        incomingProfile: recognition.profile, outgoingProfile: recognition.profile,
        relatedLabelIds: [], verificationStatus: 'suggested',
        confidence, reviewStatus, source: 'scan',
        occurrenceKey: `${recognition.category}|${recognition.label}`,
        notes: recognition.label,
      };
      nodes.push(node); network.nodeIds.push(node.id); partCandidates += 1;
    }
  });

  const networks = [tulo, poisto, unknown].filter((network) => network.nodeIds.length);
  boundaries.forEach((boundary) => { boundary.relatedNetworkId = (tulo.nodeIds.length ? tulo : poisto.nodeIds.length ? poisto : unknown).id; });

  const scanMs = Math.round(performance.now() - started);
  const summary: ScanSummary = {
    page: input.page,
    tuloNetworks: tulo.nodeIds.length ? 1 : 0,
    poistoNetworks: poisto.nodeIds.length ? 1 : 0,
    ductMetres: 0,
    fittings: nodes.filter((node) => ['bend', 'branch', 'transition', 'damper', 'fire-damper', 'silencer', 'cleaning-hatch'].includes(node.type)).length,
    devices: nodes.filter((node) => node.type === 'terminal').length,
    unresolved: nodes.filter((node) => node.reviewStatus === 'unresolved').length + boundaries.length,
  };
  const diagnostics: ScanDiagnostics = {
    page: input.page, scanMs, labelCount: diagnosticsLabels.length, segmentCount: input.segments.length,
    networkCandidates: networks.length, partCandidates,
    unresolvedReasons: [...unresolvedReasons], labels: diagnosticsLabels,
  };

  return { metadata, summary, diagnostics, networks, nodes, segments: [], boundaries };
}
