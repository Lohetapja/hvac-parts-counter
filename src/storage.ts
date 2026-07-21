import { syncCustomPartAssembly } from './custom-part-assembly';
import type { CustomPart } from './types';
import type { ProjectData } from './types';

export const STORAGE_KEY = 'hvac-parts-counter-project-v8';
const LEGACY_KEYS = ['hvac-parts-counter-project-v7', 'hvac-parts-counter-project-v6', 'hvac-parts-counter-project-v5', 'hvac-parts-counter-project-v4', 'hvac-parts-counter-project-v3', 'hvac-parts-counter-project-v2'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isPoint(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isRoute(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id)
    && isFiniteNumber(value.page)
    && (value.shape === 'round' || value.shape === 'rectangular')
    && isString(value.size)
    && isString(value.system)
    && isString(value.notes)
    && Array.isArray(value.points)
    && value.points.every(isPoint)
    && isString(value.createdAt)
    && (value.status === 'suggested' || value.status === 'verified');
}

function isPart(value: unknown): boolean {
  return isRecord(value)
    && ['id', 'category', 'model', 'size', 'system', 'notes', 'createdAt'].every((key) => isString(value[key]))
    && isFiniteNumber(value.quantity)
    && isFiniteNumber(value.addedLengthM)
    && isFiniteNumber(value.page)
    && (value.source === 'manual' || value.source === 'detected')
    && (value.status === 'suggested' || value.status === 'verified')
    && (value.detectionId === undefined || isString(value.detectionId));
}

function isVector3(value: unknown): boolean { return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z); }
function isPort(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && (value.profile === 'rectangular' || value.profile === 'round') && isVector3(value.position) && isVector3(value.direction) && isFiniteNumber(value.rotationDeg) && ['inlet', 'outlet', 'branch', 'equipment'].includes(String(value.role));
}
function isAssembly(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && isString(value.name) && Array.isArray(value.segments) && Array.isArray(value.connections) && Array.isArray(value.attachments) && Array.isArray(value.ports) && value.ports.every(isPort) && isRecord(value.metadata);
}
function isLegacyCustomPart(value: unknown): value is Record<string, unknown> {
  const numericKeys = ['endAWidthMm', 'endAHeightMm', 'endBWidthMm', 'endBHeightMm', 'lengthMm', 'horizontalOffsetMm', 'verticalOffsetMm', 'quantity', 'thicknessMm'];
  return isRecord(value)
    && ['id', 'name', 'system', 'material', 'notes', 'createdAt', 'updatedAt'].every((key) => isString(value[key]))
    && value.partType === 'rectangular-transition'
    && numericKeys.every((key) => isFiniteNumber(value[key]))
    && (value.verificationStatus === 'suggested' || value.verificationStatus === 'verified');
}
function isCustomPart(value: unknown): boolean {
  const numericKeys = ['endAWidthMm', 'endAHeightMm', 'endADiameterMm', 'endBWidthMm', 'endBHeightMm', 'endBDiameterMm', 'lengthMm', 'horizontalOffsetMm', 'verticalOffsetMm', 'outletHorizontalAngleDeg', 'outletVerticalAngleDeg', 'outletRotationDeg', 'quantity', 'thicknessMm'];
  return isRecord(value) && ['id', 'name', 'system', 'material', 'notes', 'createdAt', 'updatedAt'].every((key) => isString(value[key]))
    && ['rectangular-transition', 'rectangular-to-round-transition', 'round-to-rectangular-transition'].includes(String(value.partType))
    && numericKeys.every((key) => isFiniteNumber(value[key])) && (value.partNumber === undefined || isString(value.partNumber))
    && (value.verificationStatus === 'suggested' || value.verificationStatus === 'verified') && isAssembly(value.assembly);
}
function migrateCustomPart(value: unknown): CustomPart | null {
  if (!isLegacyCustomPart(value)) return null;
  const part = { ...value, endADiameterMm: 250, endBDiameterMm: 250, outletHorizontalAngleDeg: 0, outletVerticalAngleDeg: 0, outletRotationDeg: 0, partNumber: '' } as unknown as CustomPart;
  return syncCustomPartAssembly(part);
}

function isAirflowMarker(value: unknown): boolean {
  const classifications = ['supply', 'extract', 'uncertain']; const statuses = ['suggested', 'verified', 'rejected']; const sources = ['manual-two-point', 'vector-detected', 'similarity-scan'];
  return isRecord(value)
    && ['id', 'notes', 'createdAt', 'updatedAt'].every((key) => isString(value[key]))
    && isFiniteNumber(value.pageNumber)
    && isPoint(value.tail) && isPoint(value.tip) && isPoint(value.nearestPoint)
    && ['distanceToDuct', 'dotProductScore', 'arrowAngleDegrees', 'confidence'].every((key) => isFiniteNumber(value[key]))
    && classifications.includes(String(value.classification))
    && statuses.includes(String(value.verificationStatus))
    && sources.includes(String(value.source))
    && (value.nearestRouteId === undefined || isString(value.nearestRouteId))
    && (value.temporaryAxisId === undefined || isString(value.temporaryAxisId))
    && (value.deviceModel === undefined || isString(value.deviceModel))
    && (value.system === undefined || isString(value.system));
}

function isTemporaryAxis(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && isFiniteNumber(value.pageNumber) && isPoint(value.start) && isPoint(value.end) && isString(value.createdAt);
}

function isAirflowVisibility(value: unknown): boolean {
  return isRecord(value) && ['showSupply', 'showExtract', 'showUncertain', 'verifiedOnly', 'showLabels', 'showVectors'].every((key) => typeof value[key] === 'boolean');
}

function airflowDefaults(): Pick<ProjectData, 'airflowMarkers' | 'temporaryDuctAxes' | 'airflowVisibility'> {
  return { airflowMarkers: [], temporaryDuctAxes: [], airflowVisibility: { showSupply: true, showExtract: true, showUncertain: true, verifiedOnly: false, showLabels: true, showVectors: true } };
}

function emptyScan(): ProjectData['scan'] { return { ranAt: null, page: null, metadata: null, summary: null, diagnostics: null }; }

function ductDefaults(): Pick<ProjectData, 'ductNetworks' | 'ductSegments' | 'ductNodes' | 'ductLabels' | 'ductPartMappings' | 'contractBoundaries' | 'customCatalogue' | 'disabledCatalogueIds' | 'ductHighlight' | 'scan'> {
  return { ductNetworks: [], ductSegments: [], ductNodes: [], ductLabels: [], ductPartMappings: [], contractBoundaries: [], customCatalogue: [], disabledCatalogueIds: [], ductHighlight: { active: false, scope: 'none', showOnly: false, dimOthers: false, selectedNetworkId: null }, scan: emptyScan() };
}

function pickDuctArrays(value: Record<string, unknown>): Record<string, unknown> {
  const keys = ['ductNetworks', 'ductSegments', 'ductNodes', 'ductLabels', 'ductPartMappings', 'contractBoundaries', 'customCatalogue', 'disabledCatalogueIds', 'ductHighlight'];
  const result: Record<string, unknown> = {};
  keys.forEach((key) => { if (value[key] !== undefined) result[key] = value[key]; });
  return result;
}

function isDuctShape(value: Record<string, unknown>): boolean {
  return Array.isArray(value.ductNetworks) && Array.isArray(value.ductSegments) && Array.isArray(value.ductNodes)
    && Array.isArray(value.ductLabels) && Array.isArray(value.ductPartMappings) && Array.isArray(value.contractBoundaries)
    && Array.isArray(value.customCatalogue) && Array.isArray(value.disabledCatalogueIds) && isRecord(value.ductHighlight)
    && isRecord(value.scan);
}

function isValidProject(value: unknown): value is ProjectData {
  if (!isRecord(value) || value.version !== 8) return false;
  if (!isDuctShape(value)) return false;
  const calibration = value.calibration;
  const drawing = value.drawing;
  return typeof value.projectName === 'string'
    && (drawing === null || (isRecord(drawing)
      && isString(drawing.fileName)
      && isString(drawing.fingerprint)
      && isFiniteNumber(drawing.pageCount)))
    && isFiniteNumber(value.page)
    && isFiniteNumber(value.scaleRatio)
    && isFiniteNumber(value.customScaleRatio)
    && isRecord(calibration)
    && (calibration.mode === 'preset' || calibration.mode === 'calibrated')
    && isFiniteNumber(calibration.mmPerPdfPoint)
    && Array.isArray(value.routes)
    && value.routes.every(isRoute)
    && Array.isArray(value.parts)
    && value.parts.every(isPart)
    && Array.isArray(value.customParts)
    && value.customParts.every(isCustomPart)
    && Array.isArray(value.airflowMarkers)
    && value.airflowMarkers.every(isAirflowMarker)
    && Array.isArray(value.temporaryDuctAxes)
    && value.temporaryDuctAxes.every(isTemporaryAxis)
    && isAirflowVisibility(value.airflowVisibility)
    && Array.isArray(value.rejectedDetectionIds)
    && value.rejectedDetectionIds.every(isString)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

function quarantineInvalidState(key: string, raw: string): void {
  console.warn(`Ignored malformed saved project in ${key}.`);
  try {
    localStorage.setItem(`${key}-invalid`, raw);
    localStorage.removeItem(key);
  } catch (error) {
    console.warn('Could not quarantine malformed saved project.', error);
  }
}

export function saveProject(project: ProjectData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    return true;
  } catch (error) {
    console.error('Local project save failed.', error);
    return false;
  }
}

export function loadProject(): ProjectData | null {
  let key = STORAGE_KEY;
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
    for (const legacyKey of LEGACY_KEYS) {
      if (raw !== null) break;
      key = legacyKey; raw = localStorage.getItem(key);
    }
  } catch (error) {
    console.warn('Browser storage is unavailable.', error);
    return null;
  }
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (isRecord(value) && typeof value.version === 'number' && value.version >= 2 && value.version <= 7) {
      const legacyCustomParts = value.version < 5;
      const customParts = legacyCustomParts
        ? (Array.isArray(value.customParts) ? value.customParts.map(migrateCustomPart).filter((part): part is CustomPart => Boolean(part)) : [])
        : value.customParts;
      // Carry any duct arrays already present forward; fill missing ones with defaults.
      const defaults = ductDefaults();
      const carriedDuct = { ...defaults, ...pickDuctArrays(value) };
      const migrated: unknown = {
        ...value,
        version: 8,
        customParts,
        ...(value.version === 2 || value.version === 3 ? airflowDefaults() : {}),
        ...carriedDuct,
      };
      if (isValidProject(migrated)) return migrated;
    }
    if (isValidProject(value)) return value;
    quarantineInvalidState(key, raw);
    return null;
  } catch (error) {
    console.warn('Saved project JSON could not be parsed.', error);
    quarantineInvalidState(key, raw);
    return null;
  }
}

export function clearSavedProject(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    console.warn('Could not clear browser storage.', error);
  }
}
