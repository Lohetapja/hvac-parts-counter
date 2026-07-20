import { routeLengthM } from './measurements';
import { profileForEnd } from './custom-part-assembly';
import { boundariesForNetwork, countNetworkParts, networkCounts, networksOfKind, networkTotals } from './duct-network';
import { systemTypeToLabel } from './duct-network-types';
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
    'Network name', 'System type', 'Angle (deg)', 'Related labels', 'Vertical confirmed (m)', 'Contract boundary', 'In project scope',
  ]];
  const networkRow = (leading: Array<string | number>, extras: Array<string | number>): Array<string | number> => {
    const row = [...leading];
    while (row.length < 37) row.push('');
    return [...row, ...extras];
  };
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
  // Individual airflow-arrow markers are intentionally NOT emitted in normal material
  // exports; they are internal classification evidence only.
  // Duct networks: measured lengths per profile and derived fittings (rejected + out-of-scope excluded).
  project.ductNetworks.forEach((network) => {
    const systemLabel = systemTypeToLabel(network.systemType);
    const labelSummary = project.ductLabels.filter((label) => network.segmentIds.some((id) => id === label.segmentId) || network.nodeIds.some((id) => id === label.nodeId)).map((label) => label.normalized).join(' ');
    const verticalConfirmed = networkCounts(project, network).verticalConfirmedM;
    const scopeSummary = boundariesForNetwork(project, network).map((boundary) => boundary.scopeSide).join('/');
    countNetworkParts(project, network).forEach((partRow) => {
      rows.push(networkRow(
        [partRow.category, partRow.label, partRow.shape, partRow.size, systemLabel, partRow.quantity, partRow.lengthM !== undefined ? partRow.lengthM.toFixed(3) : '', '', `network-${partRow.source}`, partRow.status, network.notes, network.pageNumber],
        [network.name, network.systemType, partRow.angleDeg ?? '', labelSummary, verticalConfirmed.toFixed(3), partRow.category === 'Boundary' ? partRow.label : scopeSummary, 'yes'],
      ));
    });
  });
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

  rows.push([], ['DUCT SYSTEMS (NETWORKS)'], ['Group', 'Network', 'System type', 'Segments', 'Length (m)', 'Verification']);
  (['tulo', 'poisto'] as const).forEach((kind) => {
    const label = kind === 'tulo' ? 'TULO SYSTEMS' : 'POISTO SYSTEMS';
    const networks = networksOfKind(project, kind);
    if (!networks.length) { rows.push([label, '(none)', '', 0, '0.000', '']); return; }
    networks.forEach((network) => { const totals = networkTotals(project, network); rows.push([label, network.name, systemTypeToLabel(network.systemType), totals.segments, totals.lengthM.toFixed(3), network.verificationStatus]); });
  });
  const otherNetworks = project.ductNetworks.filter((network) => !['supply', 'extract', 'exhaust'].includes(network.systemType));
  otherNetworks.forEach((network) => { const totals = networkTotals(project, network); rows.push(['OTHER SYSTEMS', network.name, systemTypeToLabel(network.systemType), totals.segments, totals.lengthM.toFixed(3), network.verificationStatus]); });

  rows.push([], ['DUCT NETWORK PARTS'], ['Network', 'Category', 'Part', 'Size', 'Angle', 'Quantity', 'Length (m)', 'Status']);
  project.ductNetworks.forEach((network) => countNetworkParts(project, network).forEach((part) => rows.push([network.name, part.category, part.label, part.size, part.angleDeg ?? '', part.quantity, part.lengthM !== undefined ? part.lengthM.toFixed(3) : '', part.status])));

  return rows.map((row) => row.map(csv).join(',')).join('\r\n');
}
