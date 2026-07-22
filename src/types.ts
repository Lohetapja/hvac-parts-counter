import type { ContractBoundary, DuctHighlightState, DuctLabelAssociation, DuctNetwork, DuctNode, DuctPartMapping, DuctSegment, PartDefinition, ScanState } from './duct-network-types';
export type * from './duct-network-types';

export type Point = { x: number; y: number };
export type DuctShape = 'round' | 'rectangular';
export type Tool = 'pan' | 'calibrate' | 'trace' | 'airflow' | 'axis' | 'label' | 'network-seed' | 'network-trace';
export type VerificationStatus = 'suggested' | 'verified';
export type PartSource = 'manual' | 'detected';
export type CustomPartType = 'rectangular-transition' | 'round-transition' | 'rectangular-to-round-transition' | 'round-to-rectangular-transition' | 'rectangular-elbow' | 'round-elbow' | 'plenum-box';

// --- Locking / grounding ---------------------------------------------------
export interface AxisLock { x: boolean; y: boolean; z: boolean }
export interface ElementLockState {
  grounded: boolean;
  position: AxisLock;
  rotation: AxisLock;
  /** Per-parameter dimension locks, keyed by the parameter name (e.g. lengthMm). */
  dimensions: Record<string, boolean>;
  profileLocked: boolean;
  hostFaceLocked: boolean;
  connectionLocked: boolean;
}
export type LockLevel = 'unlocked' | 'partial' | 'locked' | 'over-constrained';

export function emptyLockState(): ElementLockState {
  return {
    grounded: false,
    position: { x: false, y: false, z: false },
    rotation: { x: false, y: false, z: false },
    dimensions: {},
    profileLocked: false,
    hostFaceLocked: false,
    connectionLocked: false,
  };
}

// --- Plenum family ---------------------------------------------------------
export type PlenumFace = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right';
export interface PlenumPort {
  id: string;
  name: string;
  face: PlenumFace;
  shape: PortProfile;
  widthMm: number;
  heightMm: number;
  diameterMm: number;
  /** Offset from the face centre, along the face's local horizontal/vertical axes. */
  offsetHorizontalMm: number;
  offsetVerticalMm: number;
  projectionMm: number;
  rotationDeg: number;
  /** Branch angle relative to the main duct axis; 90° is perpendicular. */
  branchAngleDeg?: number;
  role: PortRole;
  notes: string;
  /** Absent on parts created before locking existed (treated as fully unlocked). */
  locks?: ElementLockState;
}

// --- Reusable personal template (not a project part) -----------------------
export interface PersonalTemplate {
  id: string;
  name: string;
  description: string;
  sourceTemplateId: string;
  tags: string[];
  favourite: boolean;
  /** Structured parameters only — never rendered screenshots or WebGL data. */
  part: CustomPart;
  createdAt: string;
  updatedAt: string;
}
export type SegmentType = 'rectangular-straight' | 'round-straight' | 'rectangular-transition' | 'round-transition' | 'rectangular-to-round-transition' | 'round-to-rectangular-transition' | 'rectangular-offset' | 'rectangular-elbow' | 'round-elbow' | 'plenum-box';
export type PortProfile = 'rectangular' | 'round';
export type PortRole = 'inlet' | 'outlet' | 'branch' | 'equipment';
export interface Vector3 { x: number; y: number; z: number }
export interface Transform3 { position: Vector3; rotationDeg: Vector3 }
export interface ConnectionPort {
  id: string;
  profile: PortProfile;
  widthMm?: number;
  heightMm?: number;
  diameterMm?: number;
  position: Vector3;
  direction: Vector3;
  rotationDeg: number;
  role: PortRole;
}
export interface PartSegment {
  id: string;
  type: SegmentType;
  transform: Transform3;
  startPortId: string;
  endPortId: string;
  parameters: Record<string, number>;
}
export interface SegmentConnection { id: string; fromPortId: string; toPortId: string }
export interface CustomAttachment {
  id: string;
  name: string;
  hostSegmentId: string;
  hostSurfaces: Array<'top' | 'bottom' | 'left' | 'right' | 'end-a' | 'end-b'>;
  position: Vector3;
  direction: Vector3;
  profile: PortProfile;
  widthMm?: number;
  heightMm?: number;
  diameterMm?: number;
  projectionLengthMm: number;
  collarLengthMm: number;
  rotationDeg: number;
  portId: string;
}
export interface CustomPartMetadata {
  partNumber?: string;
  system: string;
  material: string;
  thicknessMm: number;
  quantity: number;
  notes: string;
  verificationStatus: VerificationStatus;
  createdAt: string;
  updatedAt: string;
}
export interface CustomPartAssembly {
  id: string;
  name: string;
  partNumber?: string;
  segments: PartSegment[];
  connections: SegmentConnection[];
  attachments: CustomAttachment[];
  ports: ConnectionPort[];
  metadata: CustomPartMetadata;
}

export interface RouteItem {
  id: string;
  page: number;
  shape: DuctShape;
  size: string;
  system: string;
  notes: string;
  points: Point[];
  createdAt: string;
  status: VerificationStatus;
}

export interface PartItem {
  id: string;
  category: string;
  model: string;
  size: string;
  system: string;
  quantity: number;
  addedLengthM: number;
  notes: string;
  source: PartSource;
  status: VerificationStatus;
  page: number;
  createdAt: string;
  detectionId?: string;
}

export interface Calibration {
  mode: 'preset' | 'calibrated';
  mmPerPdfPoint: number;
  knownLengthMm?: number;
  measuredPdfPoints?: number;
  effectiveScale?: number;
}

export interface DrawingIdentity {
  fileName: string;
  fingerprint: string;
  pageCount: number;
}

export interface CustomPart {
  id: string;
  name: string;
  partType: CustomPartType;
  endAWidthMm: number;
  endAHeightMm: number;
  endBWidthMm: number;
  endBHeightMm: number;
  lengthMm: number;
  horizontalOffsetMm: number;
  verticalOffsetMm: number;
  endADiameterMm: number;
  endBDiameterMm: number;
  outletHorizontalAngleDeg: number;
  outletVerticalAngleDeg: number;
  outletRotationDeg: number;
  partNumber?: string;
  quantity: number;
  system: string;
  material: string;
  thicknessMm: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
  verificationStatus: VerificationStatus;
  assembly: CustomPartAssembly;
  // --- Template-architecture additions (optional keeps old saves valid) ---
  templateId?: string;
  revision?: string;
  tags?: string[];
  favourite?: boolean;
  /** Family preset and swept-elbow parameters. Millimetres/degrees. */
  presetId?: string;
  /** Real-world sample the part was started from (see part-samples.ts). */
  sampleId?: string;
  bendRadiusMm?: number;
  bendAngleDeg?: number;
  inletExtensionMm?: number;
  outletExtensionMm?: number;
  segmentCount?: number;
  /** Plenum body dimensions (plenum-box template only). */
  bodyWidthMm?: number;
  bodyHeightMm?: number;
  bodyDepthMm?: number;
  /** Plenum outlet/branch ports (plenum-box template only). */
  plenumPorts?: PlenumPort[];
  /** Lock state for the body itself (grounding, body dimensions). */
  bodyLocks?: ElementLockState;
  /** Lock state for the transition end ports P1 / P2. */
  portALocks?: ElementLockState;
  portBLocks?: ElementLockState;
}

export type AirflowClassification = 'supply' | 'extract' | 'uncertain';
export type AirflowVerificationStatus = 'suggested' | 'verified' | 'rejected';
export type AirflowSource = 'manual-two-point' | 'vector-detected' | 'similarity-scan';

export interface TemporaryDuctAxis {
  id: string;
  pageNumber: number;
  start: Point;
  end: Point;
  createdAt: string;
}

export interface AirflowMarker {
  id: string;
  pageNumber: number;
  tail: Point;
  tip: Point;
  nearestRouteId?: string;
  temporaryAxisId?: string;
  nearestPoint: Point;
  distanceToDuct: number;
  dotProductScore: number;
  arrowAngleDegrees: number;
  classification: AirflowClassification;
  verificationStatus: AirflowVerificationStatus;
  source: AirflowSource;
  confidence: number;
  deviceModel?: string;
  system?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AirflowVisibility {
  showSupply: boolean;
  showExtract: boolean;
  showUncertain: boolean;
  verifiedOnly: boolean;
  showLabels: boolean;
  showVectors: boolean;
}

export interface ProjectData {
  version: 9;
  projectName: string;
  drawing: DrawingIdentity | null;
  page: number;
  scaleRatio: number;
  customScaleRatio: number;
  calibration: Calibration;
  routes: RouteItem[];
  parts: PartItem[];
  customParts: CustomPart[];
  /** Reusable personal templates — do not enter the project material list. */
  personalTemplates: PersonalTemplate[];
  airflowMarkers: AirflowMarker[];
  temporaryDuctAxes: TemporaryDuctAxis[];
  airflowVisibility: AirflowVisibility;
  rejectedDetectionIds: string[];
  // Connected duct-system takeoff (network highlighting + network-based part counting).
  ductNetworks: DuctNetwork[];
  ductSegments: DuctSegment[];
  ductNodes: DuctNode[];
  ductLabels: DuctLabelAssociation[];
  ductPartMappings: DuctPartMapping[];
  contractBoundaries: ContractBoundary[];
  customCatalogue: PartDefinition[];
  disabledCatalogueIds: string[];
  ductHighlight: DuctHighlightState;
  scan: ScanState;
  createdAt: string;
  updatedAt: string;
}

export interface DetectionSuggestion {
  id: string;
  model: string;
  quantity: number;
  occurrences: number;
  page: number;
  raw: string;
}

export interface DetectionLocation {
  id: string;
  model: string;
  quantity: number;
  page: number;
  raw: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
