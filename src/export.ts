import { routeLengthM } from './measurements';
import type { PartItem, ProjectData } from './types';

function csv(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function safeFileBase(projectName: string): string {
  return projectName.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'hvac-takeoff';
}

export function exportDate(): string { return new Date().toISOString().slice(0, 10); }

export function makeDetailedCsv(project: ProjectData): string {
  const rows: Array<Array<string | number>> = [[
    'Category', 'Subtype / model', 'Shape', 'Size', 'System', 'Quantity', 'Measured length (m)',
    'Added vertical length (m)', 'Source', 'Verification status', 'Notes', 'Page', 'Part type', 'Name',
    'End A width (mm)', 'End A height (mm)', 'End B width (mm)', 'End B height (mm)', 'Length (mm)',
    'Horizontal offset (mm)', 'Vertical offset (mm)', 'Material', 'Thickness (mm)',
  ]];
  project.routes.forEach((route) => rows.push([
    'Duct', 'Route', route.shape, route.size, route.system, 1, routeLengthM(route, project).toFixed(3),
    '', 'manual', route.status, route.notes, route.page, '', '', '', '', '', '', '', '', '', '', '',
  ]));
  project.parts.forEach((part) => rows.push([
    part.category, part.model, '', part.size, part.system, part.quantity, '', part.addedLengthM || '',
    part.source, part.status, part.notes, part.page, '', '', '', '', '', '', '', '', '', '', '',
  ]));
  project.customParts.forEach((part) => rows.push([
    'Custom fitting', 'Rectangular transition', 'rectangular', `${part.endAWidthMm}x${part.endAHeightMm} to ${part.endBWidthMm}x${part.endBHeightMm}`,
    part.system, part.quantity, '', '', 'custom-builder', part.verificationStatus, part.notes, '', part.partType, part.name,
    part.endAWidthMm, part.endAHeightMm, part.endBWidthMm, part.endBHeightMm, part.lengthMm,
    part.horizontalOffsetMm, part.verticalOffsetMm, part.material, part.thicknessMm,
  ]));
  return rows.map((row) => row.map(csv).join(',')).join('\r\n');
}

export function makeSummaryCsv(project: ProjectData): string {
  const rows: Array<Array<string | number>> = [['GROUPED DUCT SUMMARY'], ['Shape', 'Size', 'System', 'Routes', 'Measured length (m)']];
  const ducts = new Map<string, { shape: string; size: string; system: string; routes: number; length: number }>();
  project.routes.forEach((route) => {
    const key = `${route.shape}|${route.size}|${route.system}`;
    const current = ducts.get(key) ?? { shape: route.shape, size: route.size, system: route.system, routes: 0, length: 0 };
    current.routes += 1; current.length += routeLengthM(route, project); ducts.set(key, current);
  });
  ducts.forEach((item) => rows.push([item.shape, item.size, item.system, item.routes, item.length.toFixed(3)]));
  rows.push([], ['GROUPED PARTS AND DEVICES'], ['Category', 'Model / size', 'System', 'Quantity', 'Status']);
  const parts = new Map<string, PartItem & { total: number }>();
  project.parts.forEach((part) => {
    const key = `${part.category}|${part.model}|${part.size}|${part.system}|${part.status}`;
    const current = parts.get(key) ?? { ...part, total: 0 }; current.total += part.quantity; parts.set(key, current);
  });
  parts.forEach((part) => rows.push([part.category, [part.model, part.size].filter(Boolean).join(' / '), part.system, part.total, part.status]));
  rows.push([], ['CUSTOM PARTS'], ['Category', 'Name / geometry', 'System', 'Quantity', 'Status']);
  const customParts = new Map<string, { label: string; system: string; quantity: number; status: string }>();
  project.customParts.forEach((part) => {
    const geometry = `${part.endAWidthMm}x${part.endAHeightMm} → ${part.endBWidthMm}x${part.endBHeightMm}, L${part.lengthMm}, X${part.horizontalOffsetMm}, Y${part.verticalOffsetMm}`;
    const key = `${part.name}|${geometry}|${part.system}|${part.verificationStatus}`;
    const current = customParts.get(key) ?? { label: `${part.name} / ${geometry}`, system: part.system, quantity: 0, status: part.verificationStatus };
    current.quantity += part.quantity; customParts.set(key, current);
  });
  customParts.forEach((part) => rows.push(['Custom fitting', part.label, part.system, part.quantity, part.status]));
  return rows.map((row) => row.map(csv).join(',')).join('\r\n');
}
