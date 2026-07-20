import type { ProjectData } from './types';

export const STORAGE_KEY = 'hvac-parts-counter-project-v3';
const LEGACY_STORAGE_KEY = 'hvac-parts-counter-project-v2';

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

function isCustomPart(value: unknown): boolean {
  const numericKeys = ['endAWidthMm', 'endAHeightMm', 'endBWidthMm', 'endBHeightMm', 'lengthMm', 'horizontalOffsetMm', 'verticalOffsetMm', 'quantity', 'thicknessMm'];
  return isRecord(value)
    && ['id', 'name', 'system', 'material', 'notes', 'createdAt', 'updatedAt'].every((key) => isString(value[key]))
    && value.partType === 'rectangular-transition'
    && numericKeys.every((key) => isFiniteNumber(value[key]))
    && (value.verificationStatus === 'suggested' || value.verificationStatus === 'verified');
}

function isValidProject(value: unknown): value is ProjectData {
  if (!isRecord(value) || value.version !== 3) return false;
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
    if (raw === null) {
      key = LEGACY_STORAGE_KEY;
      raw = localStorage.getItem(key);
    }
  } catch (error) {
    console.warn('Browser storage is unavailable.', error);
    return null;
  }
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (isRecord(value) && value.version === 2) {
      const migrated: unknown = { ...value, version: 3, customParts: [] };
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
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (error) {
    console.warn('Could not clear browser storage.', error);
  }
}
