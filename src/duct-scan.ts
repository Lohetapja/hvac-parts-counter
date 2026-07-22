import type { Point } from './types';
import type {
  ContractBoundary, DuctNetwork, DuctNode, DuctNodeType, DuctProfile, DuctSegment,
  ReviewStatus, ScanDiagnostics, ScanMetadata, ScanSummary,
} from './duct-network-types';
import { parseDuctLabel, normalizeLabelText } from './duct-labels';
import { extractTitleBlock, type PositionedText } from './title-block';
import { uid } from './duct-network';
import { detectDuctSections, type DuctLabelAnchor, type GeomSegment } from './duct-geometry';

// Local, staged drawing scan. No OCR, no backend, no AI. Candidate components are
// derived from embedded PDF text labels + cached vector-symbol evidence and grouped
// into per-system networks. Every candidate carries a confidence and review status.

export interface ScanLine { start: Point; end: Point; }
export interface ScanInput {
  page: number; fileName: string; pageWidth: number; pageHeight: number;
  textItems: PositionedText[]; segments: ScanLine[]; mmPerPdfPoint: number;
  // Converts raw PDF text coordinates (Y up) into viewport/overlay space (Y down),
  // so labels, detected duct polygons and cached vector geometry share one space.
  toViewport: (point: Point) => Point;
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

const IRIS_RE = /\b(IRIS)\b/i;
const PRA_RE = /\b(PRA)\b/i;
const FIRE_RE = /\b(palopelti|fire damper|EI\d{2,3})\b/i;
const SILENCER_RE = /\b(vaimennin|silencer|[AÄ][AÄ]NENVAIMENNIN)\b/i;
const MULT_RE = /^\s*(\d{1,3})\s*(?:x|kpl|st)\b/i;
// Air-terminal product families are unambiguous. Bare T1/T3/P1 are matched only when
// standalone (they collide with door/joinery schedule codes like TLO-10x20).
// Terminal families are only accepted when immediately followed by a size (KTS-125,
// ROX 200…). Bare "KTS." is the Finnish abbreviation "katso" (see) and must be rejected.
const FAMILY_RE = /\b(KTS|KSO|ROX|OLO|FLO|VIVA|RISD|IMUKARTIO)(?:-S)?(?=\s*-?\s*\d{2,4})/i;
const STANDALONE_TERMINAL_RE = /^(?:\d+\s*[x×]\s*)?(T1|T3|P1)$/i;
const TRIPLE_DIM_RE = /\d+\s*[x×]\s*\d+\s*[x×]\s*\d+/i;
// Non-duct architectural text: doors/windows (OVI/IKKUNA), service platforms
// (HOITOTASO), joinery schedule codes (letters-NNxNN-letter), floor levels (+30.250).
const NON_DUCT_RE = /\b(OVI|IKKUNA|HOITOTASO|TASO|PORRAS|LE-?WC|WC|AULA|K[ÄA]YT[ÄA]V[ÄA]|VAR|SIIV|PUH|OT|TH|ATK)\b/i;
const SCHEDULE_CODE_RE = /[A-ZÅÄÖ]{1,4}\d*\s*-\s*\d{1,3}\s*[x×]\s*\d{1,3}\b/i;

// Rectangular duct plausibility: real duct sizes are ~100..2500 wide and ~100..1200 tall.
// Door codes ("10x21") fall below 100; service platforms ("600x1800") exceed 1200 tall.
function plausibleRectDuct(widthMm: number, heightMm: number): boolean {
  return widthMm >= 100 && widthMm <= 2500 && heightMm >= 100 && heightMm <= 1200;
}
function plausibleRoundDuct(diameterMm: number): boolean {
  return diameterMm >= 50 && diameterMm <= 1600;
}

function recognize(raw: string): Recognition | null {
  const normalized = normalizeLabelText(raw);
  if (!normalized) return null;
  const upper = normalized.toUpperCase();
  const multMatch = normalized.match(MULT_RE);
  const quantity = multMatch ? Math.max(1, Number(multMatch[1])) : 1;

  if (/^UR\b|\bUR$|^UR$/.test(upper) || upper === 'UR') return { kind: 'ur', nodeType: 'unknown', category: 'Boundary', label: 'UR / urakkaraja', quantity: 1, system: 'unknown', confidence: 0.9 };
  if (/\bYL[ÖO]S\b/.test(upper)) return { kind: 'ylos', nodeType: 'continuation', category: 'Continuation', label: 'YLÖS continuation', quantity: 1, system: 'unknown', confidence: 0.85 };
  if (/\bALAS\b/.test(upper)) return { kind: 'alas', nodeType: 'continuation', category: 'Continuation', label: 'ALAS continuation', quantity: 1, system: 'unknown', confidence: 0.85 };
  if (/^PL$|^PL\b/.test(upper)) return { kind: 'cleaning-hatch', nodeType: 'cleaning-hatch', category: 'Access', label: 'PL cleaning hatch', quantity, system: 'unknown', confidence: 0.7 };
  if (SILENCER_RE.test(normalized)) return { kind: 'silencer', nodeType: 'silencer', category: 'Silencer', label: 'Silencer', quantity, system: 'unknown', confidence: 0.6 };
  if (IRIS_RE.test(normalized) || PRA_RE.test(normalized)) return { kind: 'damper', nodeType: 'damper', category: 'Damper', label: IRIS_RE.test(normalized) ? 'IRIS damper' : 'PRA damper', quantity, system: 'unknown', confidence: 0.7 };

  // Reject architectural / door-schedule / 3D-object text before size parsing.
  const architectural = NON_DUCT_RE.test(normalized) || SCHEDULE_CODE_RE.test(normalized) || TRIPLE_DIM_RE.test(normalized);

  const parsed = parseDuctLabel(normalized);
  if (parsed?.profile && !architectural) {
    if (parsed.profile.shape === 'round' && plausibleRoundDuct(parsed.profile.diameterMm)) {
      const branch = parsed.profile.diameterMm <= 200;
      return { kind: 'round-size', nodeType: branch ? 'branch' : 'duct', category: branch ? 'Branch' : 'Duct', label: `${parsed.normalized}${branch ? ' branch' : ' round duct'}`, profile: parsed.profile, quantity, system: 'unknown', confidence: 0.72 };
    }
    if (parsed.profile.shape === 'rectangular' && plausibleRectDuct(parsed.profile.widthMm, parsed.profile.heightMm)) {
      return { kind: 'rect-size', nodeType: 'duct', category: 'Duct', label: `${parsed.normalized} rectangular duct`, profile: parsed.profile, quantity, system: 'unknown', confidence: 0.7 };
    }
  }

  // Fire class only counts as a fire damper on a duct label context, not on wall EI ratings.
  if (FIRE_RE.test(normalized) && !architectural && /palopelti|fire damper/i.test(normalized)) {
    return { kind: 'fire-damper', nodeType: 'fire-damper', category: 'Damper', label: 'Fire damper', quantity, system: 'unknown', confidence: 0.6 };
  }

  const family = normalized.match(FAMILY_RE);
  const standalone = normalized.match(STANDALONE_TERMINAL_RE);
  if ((family || standalone) && !SCHEDULE_CODE_RE.test(normalized)) {
    const token = (standalone?.[1] ?? family?.[1] ?? '').toUpperCase();
    const system: SystemKind = /^(T1|T3|TLO|KTS)/.test(token) ? 'supply' : /^(P1|PO|KSO)/.test(token) ? 'extract' : 'unknown';
    return { kind: 'terminal', nodeType: 'terminal', category: 'Terminal', label: `${normalized} terminal`, quantity, system, confidence: family ? 0.75 : 0.55 };
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
  // Round duct-size labels double as geometry anchors for duct-body detection.
  const ductAnchors: Array<DuctLabelAnchor & { networkId: string }> = [];
  // Classified terminals (KTS = supply, KSO = extract) classify nearby duct bodies.
  const terminalAnchors: Array<{ x: number; y: number; system: 'supply' | 'extract' }> = [];

  input.textItems.forEach((item) => {
    const recognition = recognize(item.text);
    if (!recognition) return;
    const point: Point = input.toViewport({ x: item.x, y: item.y });
    diagnosticsLabels.push({ raw: item.text, normalized: recognition.label, kind: recognition.kind, x: point.x, y: point.y });

    if (recognition.kind === 'ur') {
      boundaries.push({ id: uid('dur'), pageNumber: input.page, point, relatedNetworkId: undefined, scopeSide: 'unknown', verificationStatus: 'suggested', notes: 'Scanned UR boundary' });
      unresolvedReasons.add('UR boundary needs a project-side decision');
      return;
    }

    const inferred = inferSystem(recognition.system, point, input.segments);
    const network = networkFor(inferred.system);
    if (recognition.kind === 'round-size' && recognition.profile?.shape === 'round') {
      ductAnchors.push({ x: point.x, y: point.y, diameterMm: recognition.profile.diameterMm, raw: recognition.label, networkId: network.id });
    }
    if (recognition.kind === 'terminal' && (inferred.system === 'supply' || inferred.system === 'extract')) {
      terminalAnchors.push({ x: point.x, y: point.y, system: inferred.system });
    }
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

  // --- Stage D/E: real duct-body detection from paired PDF vector edges -------
  const ductSegments: DuctSegment[] = [];
  let detectedMetres = 0;
  let mmPerUnit = 0;
  if (ductAnchors.length && input.segments.length) {
    const geom: GeomSegment[] = input.segments.map((line) => ({ x1: line.start.x, y1: line.start.y, x2: line.end.x, y2: line.end.y }));
    const detection = detectDuctSections(geom, ductAnchors);
    mmPerUnit = detection.mmPerUnit;
    detection.sections.forEach((section, i) => {
      // Classify the duct body from the nearest classified terminal (supply/extract
      // evidence propagated along the physical run), else leave it unclassified.
      const mid = section.centreline[0];
      let nearest: { system: 'supply' | 'extract'; distance: number } | null = null;
      terminalAnchors.forEach((t) => {
        const distance = Math.hypot(t.x - mid.x, t.y - mid.y);
        if (distance <= 320 && (!nearest || distance < nearest.distance)) nearest = { system: t.system, distance };
      });
      const resolved: 'supply' | 'extract' | null = nearest ? (nearest as { system: 'supply' | 'extract' }).system : null;
      const anchor = ductAnchors.find((a) => Math.abs(a.x - section.labelPoint.x) < 0.01 && Math.abs(a.y - section.labelPoint.y) < 0.01);
      const network = resolved ? networkFor(resolved) : ([tulo, poisto, unknown].find((n) => n.id === anchor?.networkId) ?? unknown);
      const segment: DuctSegment = {
        id: uid('dseg'), pageNumber: input.page, networkId: network.id,
        profile: { shape: 'round', diameterMm: section.diameterMm },
        footprint: section.polygon,
        confidence: section.confidence,
        centrelinePoints: section.centreline,
        lengthMm: section.lengthMm,
        source: 'vector-detected',
        verificationStatus: 'suggested',
        relatedLabelIds: [],
      };
      ductSegments.push(segment); network.segmentIds.push(segment.id);
      detectedMetres += section.lengthMm / 1000;
      void i;
    });
    Object.entries(detection.rejects).forEach(([reason, count]) => unresolvedReasons.add(`${count} duct label(s): ${reason}`));
    if (!detection.sections.length) unresolvedReasons.add('No paired duct edges matched the drawing scale near any size label.');
  }

  const networks = [tulo, poisto, unknown].filter((network) => network.nodeIds.length || network.segmentIds.length);
  boundaries.forEach((boundary) => { boundary.relatedNetworkId = (tulo.nodeIds.length ? tulo : poisto.nodeIds.length ? poisto : unknown).id; });
  // Honest empty result: no placeholder network when the page has no ventilation labels.
  if (!partCandidates && !boundaries.length && !ductSegments.length) {
    unresolvedReasons.add(input.textItems.length > 40
      ? 'No ventilation duct labels detected on this page — it looks like an architectural drawing, not an IV/ventilation drawing.'
      : 'No recognisable duct labels found. If this is a ventilation drawing, its labels may be drawn as vector geometry rather than text.');
  }

  const scanMs = Math.round(performance.now() - started);
  const summary: ScanSummary = {
    page: input.page,
    tuloNetworks: tulo.nodeIds.length ? 1 : 0,
    poistoNetworks: poisto.nodeIds.length ? 1 : 0,
    ductMetres: detectedMetres,
    fittings: nodes.filter((node) => ['bend', 'branch', 'transition', 'damper', 'fire-damper', 'silencer', 'cleaning-hatch'].includes(node.type)).length,
    devices: nodes.filter((node) => node.type === 'terminal').length,
    unresolved: nodes.filter((node) => node.reviewStatus === 'unresolved').length + boundaries.length,
  };
  const diagnostics: ScanDiagnostics = {
    page: input.page, scanMs, labelCount: diagnosticsLabels.length, segmentCount: input.segments.length,
    networkCandidates: networks.length, partCandidates,
    unresolvedReasons: [...unresolvedReasons], labels: diagnosticsLabels,
  };

  if (mmPerUnit) unresolvedReasons.add(`Drawing scale solved from duct edges: ${mmPerUnit.toFixed(2)} mm per PDF unit (~1:${(mmPerUnit / (25.4 / 72)).toFixed(0)}).`);
  return { metadata, summary, diagnostics, networks, nodes, segments: ductSegments, boundaries };
}
