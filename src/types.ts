import type { DuctHighlightState, DuctLabelAssociation, DuctNetwork, DuctNode, DuctPartMapping, DuctSegment, PartDefinition } from './duct-network-types';
export type * from './duct-network-types';

export type Point = { x: number; y: number };
export type DuctShape = 'round' | 'rectangular';
export type Tool = 'pan' | 'calibrate' | 'trace' | 'airflow' | 'axis' | 'label' | 'network-seed' | 'network-trace';
export type VerificationStatus = 'suggested' | 'verified';
export type PartSource = 'manual' | 'detected';
export type CustomPartType = 'rectangular-transition' | 'rectangular-to-round-transition' | 'round-to-rectangular-transition';
export type SegmentType = 'rectangular-straight' | 'round-straight' | 'rectangular-transition' | 'rectangular-to-round-transition' | 'round-to-rectangular-transition' | 'rectangular-offset' | 'rectangular-elbow' | 'plenum-box';
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
  version: 6;
  projectName: string;
  drawing: DrawingIdentity | null;
  page: number;
  scaleRatio: number;
  customScaleRatio: number;
  calibration: Calibration;
  routes: RouteItem[];
  parts: PartItem[];
  customParts: CustomPart[];
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
  customCatalogue: PartDefinition[];
  disabledCatalogueIds: string[];
  ductHighlight: DuctHighlightState;
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
