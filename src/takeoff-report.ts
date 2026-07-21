import type { ProjectData } from './types';
import { countNetworkParts, networkTotals } from './duct-network';
import { systemTypeToLabel } from './duct-network-types';

// Minimal, dependency-free PDF takeoff report generated locally in the browser.
// Reuses the same PDF-serialisation approach as the custom-part drawing export.

function ascii(value: string): string {
  return value.normalize('NFKD').replace(/[^ -~]/g, (character) => character === 'Ø' ? 'DIA ' : character === '×' ? 'x' : character === '²' ? '2' : '-');
}
function pdfText(value: string): string { return ascii(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)'); }
function text(x: number, y: number, value: string, size = 9, bold = false): string { return `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(value)}) Tj ET\n`; }
function line(x1: number, y1: number, x2: number, y2: number, width = 0.6): string { return `${width} w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S\n`; }

interface Cursor { stream: string; y: number; }
const TOP = 812; const BOTTOM = 40; const LEFT = 40;

function serializePdf(pageStreams: string[]): string {
  const objects: string[] = ['', '', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
  const pageIds: number[] = [];
  pageStreams.forEach((stream) => { const pageId = objects.length; const contentId = pageId + 1; pageIds.push(pageId); objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`); objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`); });
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'; objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let output = '%PDF-1.4\n'; const offsets = [0]; for (let id = 1; id < objects.length; id += 1) { offsets[id] = output.length; output += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = output.length; output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`; for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  return `${output}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}

export function takeoffReportBlob(project: ProjectData, previewPng?: string): Blob {
  const pages: string[] = [];
  let cursor: Cursor = { stream: '', y: TOP };
  const meta = project.scan.metadata;
  const row = (label: string, value: string): void => { if (cursor.y < BOTTOM + 20) { pages.push(cursor.stream); cursor = { stream: '', y: TOP }; } cursor.stream += text(LEFT, cursor.y, `${label}: ${value}`, 9); cursor.y -= 14; };
  const heading = (value: string): void => { if (cursor.y < BOTTOM + 30) { pages.push(cursor.stream); cursor = { stream: '', y: TOP }; } cursor.y -= 6; cursor.stream += text(LEFT, cursor.y, value, 12, true) + line(LEFT, cursor.y - 3, 555, cursor.y - 3); cursor.y -= 18; };

  cursor.stream += text(LEFT, cursor.y, 'HVAC TAKEOFF REPORT', 16, true); cursor.y -= 24;
  heading('Project');
  row('Project', meta?.projectName.value || project.projectName);
  row('Address', meta?.address.value || '-');
  row('Drawing', meta?.title.value || project.drawing?.fileName || '-');
  row('Floor', meta?.floor.value || '-');
  row('Drawing number', meta?.drawingNumber.value || '-');
  row('Scale', meta?.scale.value || `1:${project.scaleRatio}`);
  row('Revision', meta?.revision.value || '-');
  row('Date', meta?.date.value || '-');
  row('Designer', meta?.designer.value || '-');
  row('Company', meta?.company.value || '-');
  row('Scan date', project.scan.ranAt ? new Date(project.scan.ranAt).toLocaleString() : 'not scanned');

  heading('System summary');
  const tulo = project.ductNetworks.filter((n) => n.systemType === 'supply');
  const poisto = project.ductNetworks.filter((n) => n.systemType === 'extract' || n.systemType === 'exhaust');
  const totalM = project.ductNetworks.reduce((sum, n) => sum + networkTotals(project, n).lengthM, 0);
  row('Tulo networks', String(tulo.length));
  row('Poisto networks', String(poisto.length));
  row('Total measured duct', `${totalM.toFixed(2)} m`);

  if (previewPng) {
    heading('Highlighted drawing preview');
    // Embedded raster preview omitted from stream to keep the report dependency-free;
    // the drawing preview is available in the app. (Placeholder box.)
    cursor.stream += line(LEFT, cursor.y - 120, 555, cursor.y - 120) + text(LEFT + 6, cursor.y - 60, 'See app for highlighted drawing.', 8);
    cursor.y -= 130;
  }

  heading('Parts by network');
  project.ductNetworks.forEach((network) => {
    const rows = countNetworkParts(project, network).filter((r) => r.status !== 'rejected');
    if (!rows.length) return;
    if (cursor.y < BOTTOM + 40) { pages.push(cursor.stream); cursor = { stream: '', y: TOP }; }
    cursor.stream += text(LEFT, cursor.y, `${network.name} - ${systemTypeToLabel(network.systemType)}`, 10, true); cursor.y -= 15;
    rows.forEach((r) => {
      if (cursor.y < BOTTOM + 16) { pages.push(cursor.stream); cursor = { stream: '', y: TOP }; }
      const length = r.lengthM !== undefined ? ` ${r.lengthM.toFixed(2)} m` : '';
      cursor.stream += text(LEFT + 8, cursor.y, `${r.quantity}x ${ascii(r.label)}${length}  [${r.status}]`, 8); cursor.y -= 12;
    });
    cursor.y -= 6;
  });

  const unresolved = project.scan.summary?.unresolved ?? 0;
  heading('Unresolved & disclaimer');
  row('Unresolved items', String(unresolved));
  cursor.stream += text(LEFT, cursor.y, 'Assisted local estimate. Verify every dimension, quantity, and system before ordering or fabrication.', 8); cursor.y -= 14;

  pages.push(cursor.stream);
  return new Blob([serializePdf(pages)], { type: 'application/pdf' });
}
