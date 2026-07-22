import { buildElbowGeometry } from './elbow-geometry';
import { buildPlenumGeometry } from './plenum-geometry';
import { buildTransitionGeometry } from './transition-geometry';
import type { CustomPart, Vector3 } from './types';

type Edge = [Vector3, Vector3];

function project(point: Vector3): { x: number; y: number } {
  return { x: (point.x - point.z) * .72, y: -point.y - (point.x + point.z) * .34 };
}

function meshEdges(part: CustomPart): Edge[] {
  if (part.partType === 'plenum-box') {
    const geometry = buildPlenumGeometry(part); const edges: Edge[] = [];
    geometry.boxFaces.forEach((face) => face.forEach((index, position) => edges.push([geometry.corners[index], geometry.corners[face[(position + 1) % face.length]]] as Edge)));
    [geometry.inlet, ...geometry.ports].forEach((port) => {
      if (!port) return;
      port.outline.forEach((point, index) => {
        const next = (index + 1) % port.outline.length;
        edges.push([point, port.outline[next]], [port.outerRing[index], port.outerRing[next]]);
        if (index % Math.max(1, Math.floor(port.outline.length / 8)) === 0) edges.push([point, port.outerRing[index]]);
      });
    });
    return edges;
  }
  const geometry = part.partType === 'rectangular-elbow' || part.partType === 'round-elbow' ? buildElbowGeometry(part) : buildTransitionGeometry(part);
  const keys = new Set<string>(); const edges: Edge[] = [];
  geometry.sideFaces.forEach((face) => face.forEach((index, position) => {
    const next = face[(position + 1) % face.length]; const key = index < next ? `${index}:${next}` : `${next}:${index}`;
    if (!keys.has(key)) { keys.add(key); edges.push([geometry.vertices[index], geometry.vertices[next]]); }
  }));
  geometry.endRings.forEach((ring) => ring.forEach((index, position) => {
    const next = ring[(position + 1) % ring.length]; const key = index < next ? `${index}:${next}` : `${next}:${index}`;
    if (!keys.has(key)) { keys.add(key); edges.push([geometry.vertices[index], geometry.vertices[next]]); }
  }));
  return edges;
}

/** Small, label-free isometric generated from the same vertices used by the editor. */
export function realGeometryThumbnail(part: CustomPart): string {
  const projected = meshEdges(part).map(([a, b]) => [project(a), project(b)] as const); const points = projected.flat();
  const minX = Math.min(...points.map((p) => p.x)); const maxX = Math.max(...points.map((p) => p.x)); const minY = Math.min(...points.map((p) => p.y)); const maxY = Math.max(...points.map((p) => p.y));
  const width = Math.max(1, maxX - minX); const height = Math.max(1, maxY - minY); const scale = Math.min(116 / width, 76 / height); const ox = 70 - (minX + maxX) * scale / 2; const oy = 46 - (minY + maxY) * scale / 2;
  const lines = projected.map(([a, b]) => `<line x1="${(a.x * scale + ox).toFixed(1)}" y1="${(a.y * scale + oy).toFixed(1)}" x2="${(b.x * scale + ox).toFixed(1)}" y2="${(b.y * scale + oy).toFixed(1)}"/>`).join('');
  return `<svg viewBox="0 0 140 92" class="tpl-thumb-svg real-geometry-thumb" fill="none" stroke="currentColor" stroke-width="1.25" vector-effect="non-scaling-stroke" aria-hidden="true">${lines}</svg>`;
}
