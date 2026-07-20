import type { ProjectData } from './types';

export const STORAGE_KEY = 'hvac-parts-counter-project-v2';

export function saveProject(project: ProjectData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

export function loadProject(): ProjectData | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 2) return null;
    return value as ProjectData;
  } catch {
    return null;
  }
}

export function clearSavedProject(): void {
  localStorage.removeItem(STORAGE_KEY);
}
