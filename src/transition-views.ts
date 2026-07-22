import { dimensionLabel, type DerivedEdgeKind, type EditableDimensionKey, type TransitionGeometry, type Vertex3 } from './transition-geometry';
import type { CustomPart } from './types';

export type GridSize = 0 | 10 | 50 | 100;
export type Projection = 'front' | 'top' | 'side' | 'isometric';
export interface TechnicalSelection { key?: EditableDimensionKey; edgeKind?: DerivedEdgeKind; edgeIndex?: number }
interface P2 { x: number; y: number }

function esc(value: string): string { return value.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c] ?? c); }
export function projectVertex(vertex: Vertex3, projection: Projection): P2 {
  if (projection === 'front') return { x: vertex.x, y: -vertex.y };
  if (projection === 'top') return { x: vertex.z, y: -vertex.x };
  if (projection === 'side') return { x: vertex.z, y: -vertex.y };
  return { x: (vertex.x - vertex.z) * .72, y: -vertex.y - (vertex.x + vertex.z) * .32 };
}
function line(a: P2, b: P2, className = 'geo', attributes = ''): string { return `<line class="${className}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${attributes}/>`; }
function polygon(points: P2[], className: string, attributes = ''): string { return `<polygon class="${className}" points="${points.map((p) => `${p.x},${p.y}`).join(' ')}" ${attributes}/>`; }
function editAttributes(key: EditableDimensionKey, selected: boolean, current: number): string {
  return `data-dimension-key="${key}" role="button" tabindex="0" aria-label="Edit ${esc(dimensionLabel(key))}, currently ${current} ${key.includes('Angle') || key === 'outletRotationDeg' ? 'degrees' : 'millimetres'}"`;
}
function dimension(a: P2, b: P2, label: string, offset: number, vertical: boolean, key: EditableDimensionKey, value: number, selected: boolean): string {
  const attributes = editAttributes(key, selected, value);
  if (vertical) {
    const x = Math.max(a.x, b.x) + offset; const middle = (a.y + b.y) / 2;
    return `<g class="editable-target${selected ? ' selected' : ''}" ${attributes}>${line(a, { x, y: a.y }, 'extension')}${line(b, { x, y: b.y }, 'extension')}<line class="dimension-line" x1="${x}" y1="${a.y}" x2="${x}" y2="${b.y}" marker-start="url(#arrow)" marker-end="url(#arrow)"/><line class="hit-line" x1="${x}" y1="${a.y}" x2="${x}" y2="${b.y}"/><text class="editable-value" x="${x + 8}" y="${middle}" dominant-baseline="middle">${esc(label)}</text></g>`;
  }
  const y = Math.max(a.y, b.y) + offset; const middle = (a.x + b.x) / 2;
  return `<g class="editable-target${selected ? ' selected' : ''}" ${attributes}>${line(a, { x: a.x, y }, 'extension')}${line(b, { x: b.x, y }, 'extension')}<line class="dimension-line" x1="${a.x}" y1="${y}" x2="${b.x}" y2="${y}" marker-start="url(#arrow)" marker-end="url(#arrow)"/><line class="hit-line" x1="${a.x}" y1="${y}" x2="${b.x}" y2="${y}"/><text class="editable-value" x="${middle}" y="${y - 7}" text-anchor="middle">${esc(label)}</text></g>`;
}
function editableText(key: EditableDimensionKey, value: number, label: string, x: number, y: number, selected: boolean, anchor = 'middle'): string {
  return `<text ${editAttributes(key, selected, value)} class="editable-target editable-value${selected ? ' selected' : ''}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(label)}</text>`;
}
function bounds(points: P2[]): { minX: number; maxX: number; minY: number; maxY: number } { return { minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)) }; }
function profileSize(part: CustomPart, end: 'a' | 'b'): { round: boolean; width: number; height: number; diameter: number } {
  const round = part.partType === 'round-transition' || part.partType === 'round-elbow' || (end === 'a' ? part.partType === 'round-to-rectangular-transition' : part.partType === 'rectangular-to-round-transition');
  return { round, width: end === 'a' ? part.endAWidthMm : part.endBWidthMm, height: end === 'a' ? part.endAHeightMm : part.endBHeightMm, diameter: end === 'a' ? part.endADiameterMm : part.endBDiameterMm };
}
function edgeLength(a: Vertex3, b: Vertex3, projection: Projection): number {
  if (projection === 'top') return Math.hypot(b.z - a.z, b.x - a.x);
  if (projection === 'side') return Math.hypot(b.z - a.z, b.y - a.y);
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
function endLocked(part: CustomPart, end: 'a' | 'b'): boolean { const locks = end === 'a' ? part.portALocks : part.portBLocks; return Boolean(locks && (locks.grounded || locks.position.x || locks.position.y || locks.position.z || locks.profileLocked)); }

export function renderTechnicalView(part: CustomPart, geometry: TransitionGeometry, projection: Projection, showDimensions: boolean, grid: GridSize, selection: TechnicalSelection = {}): string {
  const points = geometry.vertices.map((vertex) => projectVertex(vertex, projection)); const ringA = geometry.endRings[0].map((index) => points[index]); const ringB = geometry.endRings[1].map((index) => points[index]); const aBounds = bounds(ringA); const bBounds = bounds(ringB);
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y); const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys); const span = Math.max(maxX - minX, maxY - minY, 100); const padding = span * .25 + 55; const patternId = `grid-${projection}`;
  const viewBox = `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`;
  const gridMarkup = grid ? `<defs><pattern id="${patternId}" width="${grid}" height="${grid}" patternUnits="userSpaceOnUse"><path d="M ${grid} 0 L 0 0 0 ${grid}" class="grid-line"/></pattern></defs><rect x="${minX - padding}" y="${minY - padding}" width="${maxX - minX + padding * 2}" height="${maxY - minY + padding * 2}" fill="url(#${patternId})"/>` : '';
  const defs = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 10 1 L 1 5 L 10 9" fill="none" stroke="currentColor"/></marker></defs>`;
  const derivedKind: DerivedEdgeKind | null = projection === 'top' ? 'top-edge' : projection === 'side' ? 'side-edge' : null;
  const isElbow = part.partType === 'rectangular-elbow' || part.partType === 'round-elbow';
  let links = (isElbow ? [] : [0, 6, 12, 18]).map((index) => {
    const selected = derivedKind === selection.edgeKind && (selection.edgeIndex ?? 0) === index; const attributes = derivedKind ? `data-edge-kind="${derivedKind}" data-edge-index="${index}" role="button" tabindex="0" aria-label="Edit calculated ${projection} sloping edge length"` : '';
    return `<g class="edge-target${selected ? ' selected' : ''}" ${attributes}>${line(ringA[index], ringB[index], 'transition-edge')}${line(ringA[index], ringB[index], 'hit-line')}</g>`;
  }).join('');
  const edgeKeys = new Set<string>(); let bodyEdges = '';
  geometry.sideFaces.forEach((face) => face.forEach((index, position) => { const next = face[(position + 1) % face.length]; const key = index < next ? `${index}:${next}` : `${next}:${index}`; if (!edgeKeys.has(key)) { edgeKeys.add(key); bodyEdges += line(points[index], points[next], 'body-edge'); } }));
  links = bodyEdges + links;
  const centreA = projectVertex(geometry.ports[0].position, projection); const centreB = projectVertex(geometry.ports[1].position, projection);
  const sizeA = profileSize(part, 'a'); const sizeB = profileSize(part, 'b'); let profileHits = '';
  if (projection === 'front') {
    if (sizeA.round) profileHits += polygon(ringA, `profile-hit${selection.key === 'endADiameterMm' ? ' selected' : ''}`, editAttributes('endADiameterMm', selection.key === 'endADiameterMm', part.endADiameterMm));
    else profileHits += `<g class="editable-target${selection.key === 'endAWidthMm' ? ' selected' : ''}" ${editAttributes('endAWidthMm', selection.key === 'endAWidthMm', part.endAWidthMm)}>${line({ x: aBounds.minX, y: aBounds.minY }, { x: aBounds.maxX, y: aBounds.minY }, 'hit-line')}${line({ x: aBounds.minX, y: aBounds.maxY }, { x: aBounds.maxX, y: aBounds.maxY }, 'hit-line')}</g><g class="editable-target${selection.key === 'endAHeightMm' ? ' selected' : ''}" ${editAttributes('endAHeightMm', selection.key === 'endAHeightMm', part.endAHeightMm)}>${line({ x: aBounds.minX, y: aBounds.minY }, { x: aBounds.minX, y: aBounds.maxY }, 'hit-line')}${line({ x: aBounds.maxX, y: aBounds.minY }, { x: aBounds.maxX, y: aBounds.maxY }, 'hit-line')}</g>`;
    if (sizeB.round) profileHits += polygon(ringB, `profile-hit${selection.key === 'endBDiameterMm' ? ' selected' : ''}`, editAttributes('endBDiameterMm', selection.key === 'endBDiameterMm', part.endBDiameterMm));
    else profileHits += `<g class="editable-target${selection.key === 'endBWidthMm' ? ' selected' : ''}" ${editAttributes('endBWidthMm', selection.key === 'endBWidthMm', part.endBWidthMm)}>${line({ x: bBounds.minX, y: bBounds.minY }, { x: bBounds.maxX, y: bBounds.minY }, 'hit-line')}${line({ x: bBounds.minX, y: bBounds.maxY }, { x: bBounds.maxX, y: bBounds.maxY }, 'hit-line')}</g><g class="editable-target${selection.key === 'endBHeightMm' ? ' selected' : ''}" ${editAttributes('endBHeightMm', selection.key === 'endBHeightMm', part.endBHeightMm)}>${line({ x: bBounds.minX, y: bBounds.minY }, { x: bBounds.minX, y: bBounds.maxY }, 'hit-line')}${line({ x: bBounds.maxX, y: bBounds.minY }, { x: bBounds.maxX, y: bBounds.maxY }, 'hit-line')}</g>`;
  } else if (projection === 'top' || projection === 'side') {
    const keyA: EditableDimensionKey = sizeA.round ? 'endADiameterMm' : projection === 'top' ? 'endAWidthMm' : 'endAHeightMm'; const keyB: EditableDimensionKey = sizeB.round ? 'endBDiameterMm' : projection === 'top' ? 'endBWidthMm' : 'endBHeightMm';
    profileHits += `<g class="editable-target${selection.key === keyA ? ' selected' : ''}" ${editAttributes(keyA, selection.key === keyA, part[keyA])}>${line({ x: centreA.x, y: aBounds.minY }, { x: centreA.x, y: aBounds.maxY }, 'hit-line')}</g><g class="editable-target${selection.key === keyB ? ' selected' : ''}" ${editAttributes(keyB, selection.key === keyB, part[keyB])}>${line({ x: centreB.x, y: bBounds.minY }, { x: centreB.x, y: bBounds.maxY }, 'hit-line')}</g>`;
  }
  let dimensions = '';
  if (showDimensions) {
    if (projection === 'front') {
      const aWidthKey = sizeA.round ? 'endADiameterMm' : 'endAWidthMm'; const bWidthKey = sizeB.round ? 'endBDiameterMm' : 'endBWidthMm';
      dimensions += dimension({ x: aBounds.minX, y: aBounds.maxY }, { x: aBounds.maxX, y: aBounds.maxY }, `P1 ${sizeA.round ? 'Ø' + sizeA.diameter : sizeA.width} mm`, padding * .34, false, aWidthKey, part[aWidthKey], selection.key === aWidthKey);
      if (!sizeA.round) dimensions += dimension({ x: aBounds.maxX, y: aBounds.minY }, { x: aBounds.maxX, y: aBounds.maxY }, `P1 ${sizeA.height} mm`, padding * .3, true, 'endAHeightMm', part.endAHeightMm, selection.key === 'endAHeightMm');
      dimensions += dimension({ x: bBounds.minX, y: bBounds.maxY }, { x: bBounds.maxX, y: bBounds.maxY }, `P2 ${sizeB.round ? 'Ø' + sizeB.diameter : sizeB.width} mm`, padding * .68, false, bWidthKey, part[bWidthKey], selection.key === bWidthKey);
      if (!sizeB.round) dimensions += dimension({ x: bBounds.maxX, y: bBounds.minY }, { x: bBounds.maxX, y: bBounds.maxY }, `P2 ${sizeB.height} mm`, padding * .62, true, 'endBHeightMm', part.endBHeightMm, selection.key === 'endBHeightMm');
      dimensions += editableText('outletRotationDeg', part.outletRotationDeg, `Rotation ${part.outletRotationDeg}°`, maxX, minY - padding * .42, selection.key === 'outletRotationDeg', 'end');
    } else if (projection !== 'isometric') {
      if (isElbow) {
        dimensions += `<text class="editable-value" x="${(minX + maxX) / 2}" y="${minY - padding * .28}" text-anchor="middle">Bend radius ${part.bendRadiusMm ?? part.lengthMm} mm · angle ${part.bendAngleDeg ?? 90}°</text>`;
        dimensions += `<text class="editable-value" x="${(minX + maxX) / 2}" y="${maxY + padding * .55}" text-anchor="middle">Centreline ${geometry.centrelineLengthMm.toFixed(1)} mm</text>`;
      } else {
      dimensions += dimension({ x: centreA.x, y: maxY }, { x: centreB.x, y: maxY }, `${part.lengthMm} mm`, padding * .46, false, 'lengthMm', part.lengthMm, selection.key === 'lengthMm');
      const offsetKey: EditableDimensionKey = projection === 'top' ? 'horizontalOffsetMm' : 'verticalOffsetMm'; const angleKey: EditableDimensionKey = projection === 'top' ? 'outletHorizontalAngleDeg' : 'outletVerticalAngleDeg'; const offsetValue = part[offsetKey]; const angleValue = part[angleKey];
      dimensions += editableText(offsetKey, offsetValue, `${projection === 'top' ? 'Horizontal' : 'Vertical'} offset ${offsetValue >= 0 ? '+' : ''}${offsetValue} mm`, (centreA.x + centreB.x) / 2, minY - padding * .24, selection.key === offsetKey);
      dimensions += editableText(angleKey, angleValue, `Outlet angle ${angleValue}°`, maxX, minY - padding * .47, selection.key === angleKey, 'end');
      const edgeIndex = 0; const start = geometry.vertices[geometry.endRings[0][edgeIndex]]; const end = geometry.vertices[geometry.endRings[1][edgeIndex]]; const length = edgeLength(start, end, projection);
      dimensions += `<text data-edge-kind="${derivedKind}" data-edge-index="${edgeIndex}" role="button" tabindex="0" aria-label="Edit calculated ${projection} edge length, currently ${length.toFixed(1)} millimetres" class="editable-target editable-value derived-edge-value${selection.edgeKind === derivedKind && (selection.edgeIndex ?? 0) === edgeIndex ? ' selected' : ''}" x="${(centreA.x + centreB.x) / 2}" y="${maxY + padding * .8}" text-anchor="middle">Edge ${length.toFixed(1)} mm</text>`;
      }
    }
  }
  return `<figure class="technical-view${selection.key || selection.edgeKind ? ' has-selection' : ''}"><svg viewBox="${viewBox}" role="img" aria-label="${projection} view of ${esc(part.name)}">${gridMarkup}${defs}${links}${polygon(ringA, `profile end-a${selection.key?.startsWith('endA') ? ' selected' : ''}`)}${polygon(ringB, `profile end-b${selection.key?.startsWith('endB') ? ' selected' : ''}`)}${profileHits}${line(centreA, centreB, 'centre')}<text class="port-id" x="${centreA.x}" y="${centreA.y - 12}" text-anchor="middle">P1${endLocked(part, 'a') ? ' · LOCK' : ''}</text><text class="port-id" x="${centreB.x}" y="${centreB.y - 12}" text-anchor="middle">P2${endLocked(part, 'b') ? ' · LOCK' : ''}</text>${dimensions}</svg><figcaption>${projection.toUpperCase()} VIEW · ${esc(part.name)}</figcaption></figure>`;
}
