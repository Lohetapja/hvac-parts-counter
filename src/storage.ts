import type { ProjectData } from './types';

export const STORAGE_KEY = 'hvac-parts-counter-project-v3';
const LEGACY_STORAGE_KEY = 'hvac-parts-counter-project-v2';

export function saveProject(project: ProjectData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

export function loadProject(): ProjectData | null {
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value)) return null;
    if (value.version === 3) return value as ProjectData;
    if (value.version === 2) return { ...(value as unknown as Omit<ProjectData, 'version' | 'customParts'>), version: 3, customParts: [] };
    return null;
  } catch {
    return null;
  }
}

export function clearSavedProject(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}
