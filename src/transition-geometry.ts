import type { CustomPart } from './types';

export interface Vertex3 { x: number; y: number; z: number }
export interface TransitionGeometry {
  vertices: [Vertex3, Vertex3, Vertex3, Vertex3, Vertex3, Vertex3, Vertex3, Vertex3];
  sideFaces: Array<[number, number, number, number]>;
  centrelineLengthMm: number;
  cornerEdgeLengthsMm: [number, number, number, number];
  surfaceAreaM2: number;
}

export type ValidationErrors = Partial<Record<keyof CustomPart, string>>;
const MAX_DIMENSION_MM = 20_000;

export function validateCustomPart(part: CustomPart): ValidationErrors {
  const errors: ValidationErrors = {};
  const positiveDimensions: Array<keyof CustomPart> = ['endAWidthMm', 'endAHeightMm', 'endBWidthMm', 'endBHeightMm', 'lengthMm'];
  positiveDimensions.forEach((key) => {
    const value = part[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) errors[key] = 'Enter a value greater than zero.';
    else if (value > MAX_DIMENSION_MM) errors[key] = `Maximum ${MAX_DIMENSION_MM.toLocaleString()} mm.`;
  });
  (['horizontalOffsetMm', 'verticalOffsetMm'] as const).forEach((key) => {
    const value = part[key];
    if (!Number.isFinite(value)) errors[key] = 'Enter a finite offset.';
    else if (Math.abs(value) > MAX_DIMENSION_MM) errors[key] = `Maximum ±${MAX_DIMENSION_MM.toLocaleString()} mm.`;
  });
  if (!Number.isFinite(part.quantity) || !Number.isInteger(part.quantity) || part.quantity < 1) errors.quantity = 'Quantity must be a whole number of at least one.';
  else if (part.quantity > 10_000) errors.quantity = 'Maximum quantity is 10,000.';
  if (!Number.isFinite(part.thicknessMm) || part.thicknessMm <= 0) errors.thicknessMm = 'Enter a thickness greater than zero.';
  else if (part.thicknessMm > 20) errors.thicknessMm = 'Maximum thickness is 20 mm.';
  if (!part.name.trim()) errors.name = 'Enter a part name.';
  return errors;
}

function distance(a: Vertex3, b: Vertex3): number { return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); }
function subtract(a: Vertex3, b: Vertex3): Vertex3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function cross(a: Vertex3, b: Vertex3): Vertex3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function triangleArea(a: Vertex3, b: Vertex3, c: Vertex3): number {
  const value = cross(subtract(b, a), subtract(c, a));
  return Math.hypot(value.x, value.y, value.z) / 2;
}

export function buildTransitionGeometry(part: CustomPart): TransitionGeometry {
  const aw = part.endAWidthMm / 2; const ah = part.endAHeightMm / 2;
  const bw = part.endBWidthMm / 2; const bh = part.endBHeightMm / 2;
  const ox = part.horizontalOffsetMm; const oy = part.verticalOffsetMm; const z = part.lengthMm;
  const vertices: TransitionGeometry['vertices'] = [
    { x: -aw, y: -ah, z: 0 }, { x: aw, y: -ah, z: 0 }, { x: aw, y: ah, z: 0 }, { x: -aw, y: ah, z: 0 },
    { x: ox - bw, y: oy - bh, z }, { x: ox + bw, y: oy - bh, z }, { x: ox + bw, y: oy + bh, z }, { x: ox - bw, y: oy + bh, z },
  ];
  const sideFaces: TransitionGeometry['sideFaces'] = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const cornerEdgeLengthsMm = [0, 1, 2, 3].map((index) => distance(vertices[index], vertices[index + 4])) as TransitionGeometry['cornerEdgeLengthsMm'];
  const areaMm2 = sideFaces.reduce((sum, [a, b, c, d]) => sum + triangleArea(vertices[a], vertices[b], vertices[c]) + triangleArea(vertices[a], vertices[c], vertices[d]), 0);
  return { vertices, sideFaces, centrelineLengthMm: Math.hypot(z, ox, oy), cornerEdgeLengthsMm, surfaceAreaM2: areaMm2 / 1_000_000 };
}

export function classifyTransition(part: CustomPart): string {
  const centred = part.horizontalOffsetMm === 0 && part.verticalOffsetMm === 0;
  const sameSize = part.endAWidthMm === part.endBWidthMm && part.endAHeightMm === part.endBHeightMm;
  if (sameSize) return centred ? 'Rectangular straight section' : 'Rectangular same-size offset';
  const enlargement = part.endBWidthMm * part.endBHeightMm > part.endAWidthMm * part.endAHeightMm;
  return `Rectangular ${centred ? 'centred' : 'offset'} ${enlargement ? 'enlargement' : 'reducer'}`;
}

export function swapTransitionEnds(part: CustomPart): CustomPart {
  return { ...part, endAWidthMm: part.endBWidthMm, endAHeightMm: part.endBHeightMm, endBWidthMm: part.endAWidthMm, endBHeightMm: part.endAHeightMm, horizontalOffsetMm: -part.horizontalOffsetMm, verticalOffsetMm: -part.verticalOffsetMm };
}
