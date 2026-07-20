import type { CustomPart } from './types';
import type { TransitionGeometry, Vertex3 } from './transition-geometry';

export type GridSize = 0 | 10 | 50 | 100;
export type Projection = 'front' | 'top' | 'side' | 'isometric';
interface P2 { x: number; y: number }

function esc(value: string): string { return value.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c] ?? c); }
export function projectVertex(vertex: Vertex3, projection: Projection): P2 {
  if (projection === 'front') return { x: vertex.x, y: -vertex.y };
  if (projection === 'top') return { x: vertex.z, y: -vertex.x };
  if (projection === 'side') return { x: vertex.z, y: -vertex.y };
  return { x: (vertex.x - vertex.z) * .72, y: -vertex.y - (vertex.x + vertex.z) * .32 };
}
function line(a: P2, b: P2, className = 'geo'): string { return `<line class="${className}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`; }
function polygon(points: P2[], className: string): string { return `<polygon class="${className}" points="${points.map((p) => `${p.x},${p.y}`).join(' ')}"/>`; }
function dimension(a: P2, b: P2, label: string, offset: number, vertical = false): string {
  if (vertical) {
    const x = Math.max(a.x, b.x) + offset; const middle = (a.y + b.y) / 2;
    return `<g class="dimension">${line(a, { x, y: a.y }, 'extension')}${line(b, { x, y: b.y }, 'extension')}<line x1="${x}" y1="${a.y}" x2="${x}" y2="${b.y}" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="${x + 8}" y="${middle}" dominant-baseline="middle">${esc(label)}</text></g>`;
  }
  const y = Math.max(a.y, b.y) + offset; const middle = (a.x + b.x) / 2;
  return `<g class="dimension">${line(a, { x: a.x, y }, 'extension')}${line(b, { x: b.x, y }, 'extension')}<line x1="${a.x}" y1="${y}" x2="${b.x}" y2="${y}" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="${middle}" y="${y - 7}" text-anchor="middle">${esc(label)}</text></g>`;
}
function portSize(part: CustomPart, end: 'a' | 'b'): string {
  const round = end === 'a' ? part.partType === 'round-to-rectangular-transition' : part.partType === 'rectangular-to-round-transition';
  if (round) return `Ø${end === 'a' ? part.endADiameterMm : part.endBDiameterMm}`;
  return `${end === 'a' ? part.endAWidthMm : part.endBWidthMm}×${end === 'a' ? part.endAHeightMm : part.endBHeightMm}`;
}

export function renderTechnicalView(part: CustomPart, geometry: TransitionGeometry, projection: Projection, showDimensions: boolean, grid: GridSize): string {
  const points = geometry.vertices.map((vertex) => projectVertex(vertex, projection)); const ringA = geometry.endRings[0].map((index) => points[index]); const ringB = geometry.endRings[1].map((index) => points[index]);
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y); const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 100); const padding = span * .25 + 55; const patternId = `grid-${projection}`;
  const viewBox = `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`;
  const gridMarkup = grid ? `<defs><pattern id="${patternId}" width="${grid}" height="${grid}" patternUnits="userSpaceOnUse"><path d="M ${grid} 0 L 0 0 0 ${grid}" class="grid-line"/></pattern></defs><rect x="${minX - padding}" y="${minY - padding}" width="${maxX - minX + padding * 2}" height="${maxY - minY + padding * 2}" fill="url(#${patternId})"/>` : '';
  const defs = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 10 1 L 1 5 L 10 9" fill="none" stroke="currentColor"/></marker></defs>`;
  const links = [0, 6, 12, 18].map((index) => line(ringA[index], ringB[index], 'transition-edge')).join('');
  const centreA = projectVertex({ x: 0, y: 0, z: 0 }, projection); const centreB = projectVertex({ x: part.horizontalOffsetMm, y: part.verticalOffsetMm, z: part.lengthMm }, projection);
  let dimensions = '';
  if (showDimensions) {
    if (projection === 'front') {
      dimensions = dimension({ x: Math.min(...ringA.map((p) => p.x)), y: maxY }, { x: Math.max(...ringA.map((p) => p.x)), y: maxY }, `P1 ${portSize(part, 'a')} mm`, padding * .34)
        + dimension({ x: Math.min(...ringB.map((p) => p.x)), y: maxY }, { x: Math.max(...ringB.map((p) => p.x)), y: maxY }, `P2 ${portSize(part, 'b')} mm`, padding * .68);
    } else if (projection !== 'isometric') {
      dimensions = dimension({ x: centreA.x, y: maxY }, { x: centreB.x, y: maxY }, `${part.lengthMm} mm`, padding * .46)
        + `<text class="offset-label" x="${(centreA.x + centreB.x) / 2}" y="${minY - padding * .25}" text-anchor="middle">X ${part.horizontalOffsetMm >= 0 ? '+' : ''}${part.horizontalOffsetMm} · Y ${part.verticalOffsetMm >= 0 ? '+' : ''}${part.verticalOffsetMm} mm</text>`;
    }
    if (part.outletHorizontalAngleDeg || part.outletVerticalAngleDeg) dimensions += `<text class="offset-label" x="${maxX}" y="${minY - padding * .48}" text-anchor="end">Outlet H ${part.outletHorizontalAngleDeg}° · V ${part.outletVerticalAngleDeg}° · R ${part.outletRotationDeg}°</text>`;
  }
  return `<figure class="technical-view"><svg viewBox="${viewBox}" role="img" aria-label="${projection} view of ${esc(part.name)}">${gridMarkup}${defs}${links}${polygon(ringA, 'profile end-a')}${polygon(ringB, 'profile end-b')}${line(centreA, centreB, 'centre')}<text class="port-id" x="${centreA.x}" y="${centreA.y - 12}" text-anchor="middle">P1</text><text class="port-id" x="${centreB.x}" y="${centreB.y - 12}" text-anchor="middle">P2</text>${dimensions}</svg><figcaption>${projection.toUpperCase()} VIEW · ${esc(part.name)}</figcaption></figure>`;
}
