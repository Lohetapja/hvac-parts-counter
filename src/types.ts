export type Point = { x: number; y: number };
export type DuctShape = 'round' | 'rectangular';
export type Tool = 'pan' | 'calibrate' | 'trace' | 'airflow' | 'axis' | 'label';
export type VerificationStatus = 'suggested' | 'verified';
export type PartSource = 'manual' | 'detected';
export type CustomPartType = 'rectangular-transition';

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
  quantity: number;
  system: string;
  material: string;
  thicknessMm: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
  verificationStatus: VerificationStatus;
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
  version: 4;
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
