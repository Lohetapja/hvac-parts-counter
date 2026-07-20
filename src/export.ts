import { routeLengthM } from './measurements';
import { profileForEnd } from './custom-part-assembly';
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
    'Horizontal offset (mm)', 'Vertical offset (mm)', 'Material', 'Thickness (mm)', 'Part number',
    'End A diameter (mm)', 'End B diameter (mm)', 'Outlet horizontal angle (deg)', 'Outlet vertical angle (deg)', 'Outlet rotation (deg)',
    'Airflow classification', 'Related duct route', 'Related device model', 'Confidence',
    'Tail X', 'Tail Y', 'Tip X', 'Tip Y',
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
    'Custom fitting', part.partType, 'assembly', `${profileForEnd(part, 'a') === 'round' ? `Ø${part.endADiameterMm}` : `${part.endAWidthMm}x${part.endAHeightMm}`} to ${profileForEnd(part, 'b') === 'round' ? `Ø${part.endBDiameterMm}` : `${part.endBWidthMm}x${part.endBHeightMm}`}`,
    part.system, part.quantity, '', '', 'custom-builder', part.verificationStatus, part.notes, '', part.partType, part.name,
    part.endAWidthMm, part.endAHeightMm, part.endBWidthMm, part.endBHeightMm, part.lengthMm,
    part.horizontalOffsetMm, part.verticalOffsetMm, part.material, part.thicknessMm, part.partNumber ?? '', part.endADiameterMm, part.endBDiameterMm, part.outletHorizontalAngleDeg, part.outletVerticalAngleDeg, part.outletRotationDeg,
  ]));
  project.airflowMarkers.filter((marker) => marker.verificationStatus !== 'rejected').forEach((marker) => rows.push([
    'Airflow point', '', '', '', marker.system ?? '', 1, '', '', marker.source, marker.verificationStatus, marker.notes, marker.pageNumber,
    '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', marker.classification, marker.nearestRouteId ?? marker.temporaryAxisId ?? '', marker.deviceModel ?? '', marker.confidence.toFixed(3),
    marker.tail.x.toFixed(3), marker.tail.y.toFixed(3), marker.tip.x.toFixed(3), marker.tip.y.toFixed(3),
  ]));
  const width = rows[0].length; rows.slice(1).forEach((row) => { while (row.length < width) row.push(''); });
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
    const endA = profileForEnd(part, 'a') === 'round' ? `Ø${part.endADiameterMm}` : `${part.endAWidthMm}x${part.endAHeightMm}`; const endB = profileForEnd(part, 'b') === 'round' ? `Ø${part.endBDiameterMm}` : `${part.endBWidthMm}x${part.endBHeightMm}`;
    const geometry = `${endA} → ${endB}, L${part.lengthMm}, X${part.horizontalOffsetMm}, Y${part.verticalOffsetMm}, H${part.outletHorizontalAngleDeg}°, V${part.outletVerticalAngleDeg}°`;
    const key = `${part.name}|${geometry}|${part.system}|${part.verificationStatus}`;
    const current = customParts.get(key) ?? { label: `${part.name} / ${geometry}`, system: part.system, quantity: 0, status: part.verificationStatus };
    current.quantity += part.quantity; customParts.set(key, current);
  });
  customParts.forEach((part) => rows.push(['Custom fitting', part.label, part.system, part.quantity, part.status]));
  const activeAirflow = project.airflowMarkers.filter((marker) => marker.verificationStatus !== 'rejected');
  rows.push([], ['AIRFLOW POINTS'], ['Classification', 'Count', 'Verified', 'Suggested']);
  (['supply', 'extract', 'uncertain'] as const).forEach((classification) => {
    const matching = activeAirflow.filter((marker) => marker.classification === classification);
    rows.push([classification === 'supply' ? 'Tulo / Supply' : classification === 'extract' ? 'Poisto / Extract' : 'Epävarma / Uncertain', matching.length, matching.filter((marker) => marker.verificationStatus === 'verified').length, matching.filter((marker) => marker.verificationStatus === 'suggested').length]);
  });
  rows.push([], ['AIRFLOW BY SYSTEM / MODEL / PAGE'], ['System', 'Device model', 'Page', 'Tulo', 'Poisto', 'Uncertain', 'Verified', 'Suggested']);
  const airflowGroups = new Map<string, { system: string; model: string; page: number; supply: number; extract: number; uncertain: number; verified: number; suggested: number }>();
  activeAirflow.forEach((marker) => {
    const system = marker.system ?? 'Unassigned'; const model = marker.deviceModel ?? 'No model'; const key = `${system}|${model}|${marker.pageNumber}`;
    const group = airflowGroups.get(key) ?? { system, model, page: marker.pageNumber, supply: 0, extract: 0, uncertain: 0, verified: 0, suggested: 0 };
    group[marker.classification] += 1; if (marker.verificationStatus === 'verified') group.verified += 1; else group.suggested += 1; airflowGroups.set(key, group);
  });
  airflowGroups.forEach((group) => rows.push([group.system, group.model, group.page, group.supply, group.extract, group.uncertain, group.verified, group.suggested]));
  return rows.map((row) => row.map(csv).join(',')).join('\r\n');
}
