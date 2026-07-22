import type { ConnectionPort, CustomPart, Vector3 } from './types';
import type { TransitionGeometry, Vertex3 } from './transition-geometry';

const RING_POINTS = 24;
const add = (a: Vector3, b: Vector3): Vertex3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vector3, value: number): Vector3 => ({ x: a.x * value, y: a.y * value, z: a.z * value });
const distance = (a: Vertex3, b: Vertex3): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
const subtract = (a: Vertex3, b: Vertex3): Vertex3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vector3, b: Vector3): Vector3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const triangleArea = (a: Vertex3, b: Vertex3, c: Vertex3): number => { const value = cross(subtract(b, a), subtract(c, a)); return Math.hypot(value.x, value.y, value.z) / 2; };

function rectangularPerimeter(index: number, width: number, height: number): { u: number; v: number } {
  const perEdge = RING_POINTS / 4; const edge = Math.floor(index / perEdge); const t = (index % perEdge) / perEdge;
  if (edge === 0) return { u: -width / 2 + width * t, v: -height / 2 };
  if (edge === 1) return { u: width / 2, v: -height / 2 + height * t };
  if (edge === 2) return { u: width / 2 - width * t, v: height / 2 };
  return { u: -width / 2, v: height / 2 - height * t };
}

function ring(part: CustomPart, centre: Vector3, tangent: Vector3): Vertex3[] {
  const round = part.partType === 'round-elbow';
  const width = round ? part.endADiameterMm : part.endAWidthMm; const height = round ? part.endADiameterMm : part.endAHeightMm;
  const horizontal = { x: tangent.z, y: 0, z: -tangent.x }; const vertical = { x: 0, y: 1, z: 0 };
  return Array.from({ length: RING_POINTS }, (_, index) => {
    const point = round
      ? { u: Math.cos(index / RING_POINTS * Math.PI * 2) * width / 2, v: Math.sin(index / RING_POINTS * Math.PI * 2) * height / 2 }
      : rectangularPerimeter(index, width, height);
    return add(centre, add(scale(horizontal, point.u), scale(vertical, point.v)));
  });
}

/** Sweeps one profile around a real planar arc, with optional straight extensions. */
export function buildElbowGeometry(part: CustomPart): TransitionGeometry {
  const radius = Math.max(1, part.bendRadiusMm ?? part.lengthMm);
  const angleDeg = Math.min(135, Math.max(15, part.bendAngleDeg ?? 90)); const angle = angleDeg * Math.PI / 180;
  const inlet = Math.max(0, part.inletExtensionMm ?? 120); const outlet = Math.max(0, part.outletExtensionMm ?? 120);
  const arcSegments = Math.max(4, Math.round(part.segmentCount ?? Math.max(8, angleDeg / 7.5)));
  const centres: Vertex3[] = [{ x: 0, y: 0, z: -inlet }, { x: 0, y: 0, z: 0 }];
  for (let index = 1; index <= arcSegments; index += 1) {
    const t = angle * index / arcSegments;
    centres.push({ x: radius * (1 - Math.cos(t)), y: 0, z: radius * Math.sin(t) });
  }
  const end = centres[centres.length - 1]; const tangentB = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
  centres.push(add(end, scale(tangentB, outlet)));
  const rings = centres.map((centre, index) => {
    const tangent = index < 2 ? { x: 0, y: 0, z: 1 } : index >= centres.length - 2 ? tangentB : { x: Math.sin(angle * (index - 1) / arcSegments), y: 0, z: Math.cos(angle * (index - 1) / arcSegments) };
    return ring(part, centre, tangent);
  });
  const vertices = rings.flat(); const sideFaces: Array<[number, number, number, number]> = [];
  for (let section = 0; section < rings.length - 1; section += 1) for (let point = 0; point < RING_POINTS; point += 1) {
    const next = (point + 1) % RING_POINTS; const a = section * RING_POINTS + point; const b = section * RING_POINTS + next; const c = (section + 1) * RING_POINTS + next; const d = (section + 1) * RING_POINTS + point;
    sideFaces.push([a, b, c, d]);
  }
  const endRings: [number[], number[]] = [Array.from({ length: RING_POINTS }, (_, i) => i), Array.from({ length: RING_POINTS }, (_, i) => (rings.length - 1) * RING_POINTS + i)];
  const areaMm2 = sideFaces.reduce((sum, [a, b, c, d]) => sum + triangleArea(vertices[a], vertices[b], vertices[c]) + triangleArea(vertices[a], vertices[c], vertices[d]), 0);
  const round = part.partType === 'round-elbow';
  const port = (id: string, position: Vertex3, direction: Vector3, role: 'inlet' | 'outlet'): ConnectionPort => ({ id, profile: round ? 'round' : 'rectangular', position, direction, rotationDeg: 0, role, ...(round ? { diameterMm: part.endADiameterMm } : { widthMm: part.endAWidthMm, heightMm: part.endAHeightMm }) });
  const ports: [ConnectionPort, ConnectionPort] = [port(`${part.id}-P1`, centres[0], { x: 0, y: 0, z: -1 }, 'inlet'), port(`${part.id}-P2`, centres[centres.length - 1], tangentB, 'outlet')];
  const cornerIndexes = [0, 6, 12, 18]; const cornerEdgeLengthsMm = cornerIndexes.map((i) => distance(vertices[endRings[0][i]], vertices[endRings[1][i]])) as [number, number, number, number];
  return { vertices, sideFaces, endRings, ports, centreline: centres, centrelineLengthMm: inlet + radius * angle + outlet, cornerEdgeLengthsMm, surfaceAreaM2: areaMm2 / 1_000_000 };
}
