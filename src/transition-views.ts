import type { CustomPart } from './types';
import type { TransitionGeometry, Vertex3 } from './transition-geometry';

export type GridSize = 0 | 10 | 50 | 100;
type Projection = 'front' | 'top' | 'side';
interface P2 { x: number; y: number }

function esc(value: string): string { return value.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c] ?? c); }
function point(vertex: Vertex3, projection: Projection): P2 {
  if (projection === 'front') return { x: vertex.x, y: -vertex.y };
  if (projection === 'top') return { x: vertex.z, y: -vertex.x };
  return { x: vertex.z, y: -vertex.y };
}
function line(a: P2, b: P2, className = 'geo'): string { return `<line class="${className}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`; }
function polygon(points: P2[], className: string): string { return `<polygon class="${className}" points="${points.map((p) => `${p.x},${p.y}`).join(' ')}"/>`; }
function dimension(a: P2, b: P2, label: string, offset: number, vertical = false): string {
  if (vertical) {
    const x = Math.max(a.x, b.x) + offset; const middle = (a.y + b.y) / 2;
    return `<g class="dimension">${line(a, { x, y: a.y }, 'extension')}${line(b, { x, y: b.y }, 'extension')}<line x1="${x}" y1="${a.y}" x2="${x}" y2="${b.y}" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="${x + 8}" y="${middle}" dominant-baseline="middle">${label}</text></g>`;
  }
  const y = Math.max(a.y, b.y) + offset; const middle = (a.x + b.x) / 2;
  return `<g class="dimension">${line(a, { x: a.x, y }, 'extension')}${line(b, { x: b.x, y }, 'extension')}<line x1="${a.x}" y1="${y}" x2="${b.x}" y2="${y}" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="${middle}" y="${y - 7}" text-anchor="middle">${label}</text></g>`;
}

export function renderTechnicalView(part: CustomPart, geometry: TransitionGeometry, projection: Projection, showDimensions: boolean, grid: GridSize): string {
  const points = geometry.vertices.map((vertex) => point(vertex, projection));
  const relevant = projection === 'front' ? points : projection === 'top' ? [points[0], points[1], points[4], points[5], points[3], points[2], points[7], points[6]] : [points[0], points[3], points[4], points[7], points[1], points[2], points[5], points[6]];
  const xs = relevant.map((p) => p.x); const ys = relevant.map((p) => p.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 100); const padding = span * 0.28 + 45;
  const viewBox = `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`;
  const patternId = `grid-${projection}`;
  const gridMarkup = grid ? `<defs><pattern id="${patternId}" width="${grid}" height="${grid}" patternUnits="userSpaceOnUse"><path d="M ${grid} 0 L 0 0 0 ${grid}" class="grid-line"/></pattern></defs><rect x="${minX - padding}" y="${minY - padding}" width="${maxX - minX + padding * 2}" height="${maxY - minY + padding * 2}" fill="url(#${patternId})"/>` : '';
  const defs = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 10 1 L 1 5 L 10 9" fill="none" stroke="currentColor"/></marker></defs>`;
  let geometryMarkup = '';
  if (projection === 'front') {
    geometryMarkup = polygon(points.slice(0, 4), 'profile end-a') + polygon(points.slice(4, 8), 'profile end-b') + line({ x: minX, y: 0 }, { x: maxX, y: 0 }, 'centre') + line({ x: 0, y: minY }, { x: 0, y: maxY }, 'centre');
  } else {
    const aLow = projection === 'top' ? points[0] : points[0]; const aHigh = projection === 'top' ? points[1] : points[3];
    const bLow = projection === 'top' ? points[4] : points[4]; const bHigh = projection === 'top' ? points[5] : points[7];
    geometryMarkup = polygon([aLow, aHigh, bHigh, bLow], 'transition-outline') + line({ x: 0, y: 0 }, { x: part.lengthMm, y: projection === 'top' ? -part.horizontalOffsetMm : -part.verticalOffsetMm }, 'centre');
  }
  let dimensions = '';
  if (showDimensions) {
    if (projection === 'front') {
      dimensions = dimension(points[0], points[1], `A ${part.endAWidthMm} mm`, padding * .38) + dimension(points[0], points[3], `A ${part.endAHeightMm} mm`, padding * .38, true) + dimension(points[4], points[5], `B ${part.endBWidthMm} mm`, padding * .68) + dimension(points[4], points[7], `B ${part.endBHeightMm} mm`, padding * .68, true);
    } else {
      const transverse = projection === 'top' ? { a1: points[0], a2: points[1], b1: points[4], b2: points[5], aSize: part.endAWidthMm, bSize: part.endBWidthMm, offset: part.horizontalOffsetMm } : { a1: points[0], a2: points[3], b1: points[4], b2: points[7], aSize: part.endAHeightMm, bSize: part.endBHeightMm, offset: part.verticalOffsetMm };
      dimensions = dimension({ x: 0, y: maxY }, { x: part.lengthMm, y: maxY }, `${part.lengthMm} mm`, padding * .55) + dimension(transverse.a1, transverse.a2, `A ${transverse.aSize} mm`, padding * .35, true) + dimension(transverse.b1, transverse.b2, `B ${transverse.bSize} mm`, padding * .35, true) + `<text class="offset-label" x="${part.lengthMm / 2}" y="${minY - padding * .35}" text-anchor="middle">Offset ${transverse.offset > 0 ? '+' : ''}${transverse.offset} mm</text>`;
    }
  }
  return `<figure class="technical-view"><svg viewBox="${viewBox}" role="img" aria-label="${projection} view of ${esc(part.name)}">${gridMarkup}${defs}${geometryMarkup}${dimensions}</svg><figcaption>${projection.toUpperCase()} VIEW · ${esc(part.name)}</figcaption></figure>`;
}
