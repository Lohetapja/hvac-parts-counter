import { buildTransitionGeometry } from './transition-geometry';
import { projectVertex, type Projection } from './transition-views';
import { buildPlenumGeometry, portSizeLabel } from './plenum-geometry';
import { buildElbowGeometry } from './elbow-geometry';
import type { CustomPart } from './types';

function ascii(value: string): string {
  return value.normalize('NFKD').replace(/[^ -~]/g, (character) => character === 'Ø' ? 'DIA ' : character === '×' ? 'x' : '-');
}
function pdfText(value: string): string { return ascii(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)'); }
function text(x: number, y: number, value: string, size = 9, bold = false): string { return `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(value)}) Tj ET\n`; }
function line(x1: number, y1: number, x2: number, y2: number, width = .7): string { return `${width} w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S\n`; }
function profileLabel(part: CustomPart, end: 'a' | 'b'): string {
  const round = part.partType === 'round-transition' || part.partType === 'round-elbow' || (end === 'a' ? part.partType === 'round-to-rectangular-transition' : part.partType === 'rectangular-to-round-transition');
  return round ? `DIA ${end === 'a' ? part.endADiameterMm : part.endBDiameterMm} mm` : `${end === 'a' ? part.endAWidthMm : part.endBWidthMm} x ${end === 'a' ? part.endAHeightMm : part.endBHeightMm} mm`;
}

function drawing(part: CustomPart, projection: Projection, x: number, y: number, width: number, height: number): string {
  if (part.partType === 'plenum-box') return plenumDrawing(part, projection, x, y, width, height);
  const geometry = part.partType === 'rectangular-elbow' || part.partType === 'round-elbow' ? buildElbowGeometry(part) : buildTransitionGeometry(part); const points = geometry.vertices.map((vertex) => projectVertex(vertex, projection));
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y); const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const availableWidth = width - 24; const availableHeight = height - 35; const scale = Math.min(availableWidth / Math.max(1, maxX - minX), availableHeight / Math.max(1, maxY - minY));
  const usedWidth = (maxX - minX) * scale; const usedHeight = (maxY - minY) * scale; const originX = x + 12 + (availableWidth - usedWidth) / 2; const originY = y + 10 + (availableHeight - usedHeight) / 2;
  const map = (point: { x: number; y: number }): { x: number; y: number } => ({ x: originX + (point.x - minX) * scale, y: originY + (maxY - point.y) * scale });
  let commands = text(x, y + height - 11, projection.toUpperCase(), 8, true) + line(x, y, x + width, y) + line(x + width, y, x + width, y + height) + line(x + width, y + height, x, y + height) + line(x, y + height, x, y);
  geometry.endRings.forEach((ring) => ring.forEach((index, ringIndex) => { const a = map(points[index]); const b = map(points[ring[(ringIndex + 1) % ring.length]]); commands += line(a.x, a.y, b.x, b.y, .8); }));
  const edgeKeys = new Set<string>(); geometry.sideFaces.forEach((face) => face.forEach((index, position) => { const next = face[(position + 1) % face.length]; const key = index < next ? `${index}:${next}` : `${next}:${index}`; if (!edgeKeys.has(key)) { edgeKeys.add(key); const a = map(points[index]); const b = map(points[next]); commands += line(a.x, a.y, b.x, b.y, .45); } }));
  const p1 = map(projectVertex(geometry.ports[0].position, projection)); const p2 = map(projectVertex(geometry.ports[1].position, projection));
  commands += text(p1.x + 3, p1.y + 3, 'P1', 7, true) + text(p2.x + 3, p2.y + 3, 'P2', 7, true); return commands;
}

function plenumDrawing(part: CustomPart, projection: Projection, x: number, y: number, width: number, height: number): string {
  const geometry = buildPlenumGeometry(part); const edges: Array<[{ x: number; y: number; z: number }, { x: number; y: number; z: number }]> = [];
  geometry.boxFaces.forEach((face) => face.forEach((index, position) => edges.push([geometry.corners[index], geometry.corners[face[(position + 1) % face.length]]])));
  [geometry.inlet, ...geometry.ports].forEach((entry) => { if (!entry) return; entry.outline.forEach((point, index) => { edges.push([point, entry.outline[(index + 1) % entry.outline.length]]); edges.push([entry.outerRing[index], entry.outerRing[(index + 1) % entry.outerRing.length]]); if (index % Math.max(1, Math.floor(entry.outline.length / 4)) === 0) edges.push([point, entry.outerRing[index]]); }); });
  const points = edges.flat().map((vertex) => projectVertex(vertex, projection)); const xs = points.map((point) => point.x); const ys = points.map((point) => point.y); const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const availableWidth = width - 24; const availableHeight = height - 35; const scale = Math.min(availableWidth / Math.max(1, maxX - minX), availableHeight / Math.max(1, maxY - minY)); const originX = x + 12 + (availableWidth - (maxX - minX) * scale) / 2; const originY = y + 10 + (availableHeight - (maxY - minY) * scale) / 2;
  const map = (point: { x: number; y: number }): { x: number; y: number } => ({ x: originX + (point.x - minX) * scale, y: originY + (maxY - point.y) * scale });
  let commands = text(x, y + height - 11, projection.toUpperCase(), 8, true) + line(x, y, x + width, y) + line(x + width, y, x + width, y + height) + line(x + width, y + height, x, y + height) + line(x, y + height, x, y);
  for (let index = 0; index < points.length; index += 2) { const a = map(points[index]); const b = map(points[index + 1]); commands += line(a.x, a.y, b.x, b.y, .65); }
  [geometry.inlet, ...geometry.ports].forEach((entry) => { if (!entry) return; const p = map(projectVertex(entry.tip, projection)); commands += text(p.x + 3, p.y + 3, entry.port.id, 7, true); }); return commands;
}

function firstPage(part: CustomPart): string {
  const elbow = part.partType === 'rectangular-elbow' || part.partType === 'round-elbow';
  let page = text(36, 565, `CUSTOM HVAC FITTING - ${part.name}`, 15, true);
  page += text(36, 547, `Project: HVAC Parts Counter   Part no: ${part.partNumber || '-'}   Rev: ${part.revision || 'A'}   Qty: ${part.quantity}`, 9);
  page += part.partType === 'plenum-box' ? text(36, 532, `Body ${part.bodyWidthMm} x ${part.bodyHeightMm} x ${part.bodyDepthMm} mm   Inlet ${profileLabel(part, 'a')}   Outlets ${part.plenumPorts?.length ?? 0}`, 9) : text(36, 532, `P1 ${profileLabel(part, 'a')}   P2 ${profileLabel(part, 'b')}   ${elbow ? `Radius ${part.bendRadiusMm} mm / angle ${part.bendAngleDeg} deg` : `Length ${part.lengthMm} mm`}`, 9);
  page += part.partType === 'plenum-box' ? text(36, 517, 'Parametric host body and connector projections shown to fit.', 8) : elbow ? text(36, 517, `Inlet extension ${part.inletExtensionMm} mm / outlet extension ${part.outletExtensionMm} mm / sweep segments ${part.segmentCount}`, 8) : text(36, 517, `Offsets X ${part.horizontalOffsetMm} mm / Y ${part.verticalOffsetMm} mm   Outlet H ${part.outletHorizontalAngleDeg} deg / V ${part.outletVerticalAngleDeg} deg / rotation ${part.outletRotationDeg} deg`, 8);
  page += drawing(part, 'isometric', 36, 250, 770, 250) + drawing(part, 'front', 36, 48, 246, 182) + drawing(part, 'top', 298, 48, 246, 182) + drawing(part, 'side', 560, 48, 246, 182);
  page += text(36, 25, 'GEOMETRIC REFERENCE - VERIFY DIMENSIONS BEFORE FABRICATION.', 8, true); return page;
}

function schedulePage(part: CustomPart): string {
  const assembly = part.assembly; let y = 548; let page = text(36, 570, `${part.name} - PORT AND ATTACHMENT SCHEDULE`, 14, true);
  page += text(36, y, 'PORT  ROLE       PROFILE       SIZE                 POSITION X/Y/Z       DIRECTION X/Y/Z       ROT', 8, true); y -= 17;
  if (part.partType === 'plenum-box') {
    const geometry = buildPlenumGeometry(part);
    [geometry.inlet, ...geometry.ports].forEach((entry) => { if (!entry) return; const port = entry.port; page += text(36, y, `${port.id.padEnd(5)} ${port.role.padEnd(10)} ${port.shape.padEnd(12)} ${portSizeLabel(port).padEnd(20)} ${entry.tip.x.toFixed(1)}/${entry.tip.y.toFixed(1)}/${entry.tip.z.toFixed(1)}        ${entry.normal.x.toFixed(3)}/${entry.normal.y.toFixed(3)}/${entry.normal.z.toFixed(3)}      ${port.rotationDeg} deg`, 7); y -= 15; });
  } else assembly.ports.forEach((port) => {
    const size = port.profile === 'round' ? `DIA ${port.diameterMm} mm` : `${port.widthMm} x ${port.heightMm} mm`;
    page += text(36, y, `${port.id.endsWith('P1') ? 'P1' : 'P2'}    ${port.role.padEnd(10)} ${port.profile.padEnd(12)} ${size.padEnd(20)} ${port.position.x.toFixed(1)}/${port.position.y.toFixed(1)}/${port.position.z.toFixed(1)}        ${port.direction.x.toFixed(3)}/${port.direction.y.toFixed(3)}/${port.direction.z.toFixed(3)}      ${port.rotationDeg} deg`, 7); y -= 15;
  });
  y -= 12; page += text(36, y, 'ATTACHMENTS', 10, true); y -= 17;
  if (!assembly.attachments.length) { page += text(36, y, 'No additional branch attachments in this assembly.', 8); y -= 18; }
  assembly.attachments.slice(0, 12).forEach((attachment, index) => {
    const size = attachment.profile === 'round' ? `DIA ${attachment.diameterMm}` : `${attachment.widthMm} x ${attachment.heightMm}`;
    page += text(36, y, `${index + 1}. ${attachment.name} / ${attachment.profile} ${size} / host ${attachment.hostSurfaces.join('+')} / direction ${attachment.direction.x.toFixed(2)},${attachment.direction.y.toFixed(2)},${attachment.direction.z.toFixed(2)} / projection ${attachment.projectionLengthMm} / collar ${attachment.collarLengthMm}`, 7); y -= 15;
  });
  y -= 12; page += text(36, y, 'METADATA AND WARNINGS', 10, true); y -= 17;
  [`System: ${part.system}`, `Material: ${part.material}`, `Thickness: ${part.thicknessMm} mm`, `Verification: ${part.verificationStatus}`, 'No seam, flange, bend allowance, boolean cut, or sheet-development calculation is included.', 'Verify dimensions, clearances, outlet directions, and fabrication method before manufacture.'].forEach((value) => { page += text(36, y, value, 8); y -= 15; });
  if (part.notes) { y -= 5; page += text(36, y, 'Notes:', 9, true); y -= 15; const words = ascii(part.notes).split(/\s+/); let row = ''; words.forEach((word) => { if (`${row} ${word}`.length > 105) { page += text(36, y, row, 8); y -= 14; row = word; } else row = `${row} ${word}`.trim(); }); if (row) page += text(36, y, row, 8); }
  return page;
}

function serializePdf(pageStreams: string[]): string {
  const objects: string[] = ['', '', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>']; const pageIds: number[] = [];
  pageStreams.forEach((stream) => { const pageId = objects.length; const contentId = pageId + 1; pageIds.push(pageId); objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`); objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`); });
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'; objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let output = '%PDF-1.4\n'; const offsets = [0]; for (let id = 1; id < objects.length; id += 1) { offsets[id] = output.length; output += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = output.length; output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`; for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  return `${output}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}

export function customPartPdfBlob(part: CustomPart): Blob { return new Blob([serializePdf([firstPage(part), schedulePage(part)])], { type: 'application/pdf' }); }

export function downloadCustomPartPdf(part: CustomPart): void {
  const base = part.name.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'custom-hvac-part'; const url = URL.createObjectURL(customPartPdfBlob(part));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${base}-drawing.pdf`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
