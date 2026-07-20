export type Point = { x: number; y: number };
export type DuctShape = 'round' | 'rectangular';
export type Tool = 'pan' | 'calibrate' | 'trace';
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

export interface ProjectData {
  version: 3;
  projectName: string;
  drawing: DrawingIdentity | null;
  page: number;
  scaleRatio: number;
  customScaleRatio: number;
  calibration: Calibration;
  routes: RouteItem[];
  parts: PartItem[];
  customParts: CustomPart[];
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
