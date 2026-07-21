import type { Point } from './types';

// Connected duct-system takeoff models. These are intentionally separate from the
// airflow-marker models: individual arrow selection and whole-system highlighting
// are different capabilities and must not share selection state.

export type DuctSystemType =
  | 'supply'
  | 'extract'
  | 'outdoor'
  | 'exhaust'
  | 'transfer'
  | 'other'
  | 'unknown';

export type DuctProfile =
  | { shape: 'rectangular'; widthMm: number; heightMm: number }
  | { shape: 'round'; diameterMm: number };

export type DuctVerificationStatus = 'suggested' | 'verified';
export type DuctSegmentSource = 'manual' | 'vector-detected';
export type DuctNetworkSource = 'manual' | 'assisted-vector' | 'mixed';

export type DuctNodeType =
  | 'continuation'
  | 'bend'
  | 'branch'
  | 'transition'
  | 'terminal'
  | 'end'
  | 'damper'
  | 'fire-damper'
  | 'silencer'
  | 'cleaning-hatch'
  | 'duct'
  | 'equipment'
  | 'unknown';

export type TransitionOffset = 'centred' | 'horizontal' | 'vertical' | 'unknown';

export interface DuctNetwork {
  id: string;
  pageNumber: number;
  name: string;
  systemType: DuctSystemType;
  segmentIds: string[];
  nodeIds: string[];
  verificationStatus: DuctVerificationStatus;
  source: DuctNetworkSource;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface DuctSegment {
  id: string;
  pageNumber: number;
  networkId?: string;
  profile?: DuctProfile;
  centrelinePoints: Point[];
  lengthMm: number;
  source: DuctSegmentSource;
  verificationStatus: DuctVerificationStatus;
  relatedLabelIds: string[];
  startNodeId?: string;
  endNodeId?: string;
}

export interface DuctNode {
  id: string;
  pageNumber: number;
  networkId?: string;
  point: Point;
  type: DuctNodeType;
  direction?: 'up' | 'down';
  incomingProfile?: DuctProfile;
  outgoingProfile?: DuctProfile;
  // Vertical continuation (YLÖS / ALAS) details. Vertical length is never invented;
  // it stays undefined until the user confirms it and confirmedVerticalLength is set.
  verticalLengthMm?: number;
  confirmedVerticalLength?: boolean;
  floorDestination?: string;
  matchingReference?: string;
  matchingNodeId?: string;
  angleDeg?: number;
  transitionOffset?: TransitionOffset;
  relatedLabelIds: string[];
  notes?: string;
  verificationStatus: DuctVerificationStatus;
  // Scan-derived candidate metadata (optional; absent for manually created nodes).
  confidence?: number;
  reviewStatus?: ReviewStatus;
  source?: 'scan' | 'manual';
  occurrenceKey?: string;
}

// A size / direction label recognised from PDF text and associated with the nearest
// plausible segment. The association is only ever a suggestion the user can move.
export interface DuctLabelAssociation {
  id: string;
  pageNumber: number;
  raw: string;
  normalized: string;
  kind: 'rectangular' | 'round' | 'ylos' | 'alas' | 'unknown';
  profile?: DuctProfile;
  classes: string[];
  point: Point;
  segmentId?: string;
  nodeId?: string;
  verificationStatus: DuctVerificationStatus;
}

// UR / urakkaraja — the contract boundary. Not an airflow marker. Network tracing
// stops here by default and only the verified project-side ductwork is counted.
export type ContractScopeSide = 'before' | 'after' | 'both' | 'unknown';

export interface ContractBoundary {
  id: string;
  pageNumber: number;
  point: Point;
  relatedNetworkId?: string;
  relatedSegmentId?: string;
  scopeSide: ContractScopeSide;
  verificationStatus: DuctVerificationStatus;
  notes: string;
}

export type PartMappingStatus = 'suggested' | 'verified' | 'manual' | 'rejected';

// Maps a detected/derived fitting (identified by a stable key) onto a catalogue
// definition. Rejected mappings never enter totals.
export interface DuctPartMapping {
  id: string;
  networkId: string;
  fittingKey: string;
  catalogueId: string;
  status: PartMappingStatus;
  notes: string;
}

export interface PartDefinition {
  id: string;
  category: string;
  shape: 'round' | 'rectangular' | 'both';
  names: { fi: string; en: string };
  requiredFields: string[];
  optionalFields: string[];
  aliases: string[];
  externalReferenceUrl?: string;
  builtin?: boolean;
  disabled?: boolean;
}

// --- Automatic scan model --------------------------------------------------
export type ScanFieldSource = 'pdf-text' | 'title-block' | 'derived' | 'manual';
export interface ScanField { value: string; source: ScanFieldSource; confidence: number; }

export interface ScanMetadata {
  fileName: ScanField;
  projectName: ScanField;
  address: ScanField;
  title: ScanField;
  floor: ScanField;
  drawingNumber: ScanField;
  drawingType: ScanField;
  scale: ScanField;
  revision: ScanField;
  date: ScanField;
  designer: ScanField;
  company: ScanField;
}

export interface ScanSummary {
  page: number;
  tuloNetworks: number;
  poistoNetworks: number;
  ductMetres: number;
  fittings: number;
  devices: number;
  unresolved: number;
}

export interface ScanDiagnostics {
  page: number;
  scanMs: number;
  labelCount: number;
  segmentCount: number;
  networkCandidates: number;
  partCandidates: number;
  unresolvedReasons: string[];
  labels: Array<{ raw: string; normalized: string; kind: string; x: number; y: number }>;
}

export interface ScanState {
  ranAt: string | null;
  page: number | null;
  metadata: ScanMetadata | null;
  summary: ScanSummary | null;
  diagnostics: ScanDiagnostics | null;
}

// Confidence lifecycle for scanned candidates.
export type ReviewStatus = 'confirmed' | 'likely' | 'unresolved' | 'rejected';

export interface DuctHighlightState {
  active: boolean;
  scope: 'none' | 'tulo' | 'poisto' | 'selected' | 'all';
  showOnly: boolean;
  dimOthers: boolean;
  selectedNetworkId: string | null;
}

// A resolved parts-list row produced from verified network topology.
export type NetworkPartStatus = 'suggested' | 'verified' | 'manual' | 'rejected' | 'confirmed' | 'likely' | 'unresolved';

export interface NetworkPartRow {
  key: string;
  networkId: string;
  catalogueId: string;
  category: string;
  label: string;
  shape: 'round' | 'rectangular' | 'both';
  size: string;
  angleDeg?: number;
  quantity: number;
  lengthM?: number;
  status: NetworkPartStatus;
  source: 'topology' | 'manual';
  confidence?: number;
  occurrences?: Point[];
}

export function defaultHighlightState(): DuctHighlightState {
  return { active: false, scope: 'none', showOnly: false, dimOthers: false, selectedNetworkId: null };
}

export function systemTypeToLabel(type: DuctSystemType): string {
  switch (type) {
    case 'supply': return 'Tulo / Supply';
    case 'extract': return 'Poisto / Extract';
    case 'outdoor': return 'Ulko / Outdoor';
    case 'exhaust': return 'Jäte / Exhaust';
    case 'transfer': return 'Siirto / Transfer';
    case 'other': return 'Muu / Other';
    default: return 'Tuntematon / Unknown';
  }
}

export function isSupplyType(type: DuctSystemType): boolean { return type === 'supply'; }
export function isExtractType(type: DuctSystemType): boolean { return type === 'extract' || type === 'exhaust'; }

export function profileLabel(profile: DuctProfile | undefined): string {
  if (!profile) return 'Unknown size';
  return profile.shape === 'round' ? `Ø${profile.diameterMm}` : `${profile.widthMm}×${profile.heightMm}`;
}

export function profilesEqual(a: DuctProfile | undefined, b: DuctProfile | undefined): boolean {
  if (!a || !b) return false;
  if (a.shape !== b.shape) return false;
  if (a.shape === 'round' && b.shape === 'round') return a.diameterMm === b.diameterMm;
  if (a.shape === 'rectangular' && b.shape === 'rectangular') return a.widthMm === b.widthMm && a.heightMm === b.heightMm;
  return false;
}
