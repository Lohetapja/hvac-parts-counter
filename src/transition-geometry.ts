import { buildCustomPartAssembly, outletDirection, profileForEnd } from './custom-part-assembly';
import type { ConnectionPort, CustomPart, PortProfile, Vector3 } from './types';

export interface Vertex3 extends Vector3 {}
export interface TransitionGeometry {
  vertices: Vertex3[];
  sideFaces: Array<[number, number, number, number]>;
  endRings: [number[], number[]];
  ports: [ConnectionPort, ConnectionPort];
  centrelineLengthMm: number;
  cornerEdgeLengthsMm: [number, number, number, number];
  surfaceAreaM2: number;
}

export type ValidationErrors = Partial<Record<keyof CustomPart, string>>;
export type EditableDimensionKey = 'endAWidthMm' | 'endAHeightMm' | 'endBWidthMm' | 'endBHeightMm' | 'endADiameterMm' | 'endBDiameterMm' | 'lengthMm' | 'horizontalOffsetMm' | 'verticalOffsetMm' | 'outletHorizontalAngleDeg' | 'outletVerticalAngleDeg' | 'outletRotationDeg';
export type DerivedEdgeKind = 'top-edge' | 'side-edge' | 'corner-edge';
export interface EdgeLengthSolution { bodyLengthMm?: number; minimumTargetMm: number; error?: string }
const MAX_DIMENSION_MM = 20_000; const RING_POINTS = 24;

export function validateCustomPart(part: CustomPart): ValidationErrors {
  const errors: ValidationErrors = {};
  const positive = (key: keyof CustomPart): void => {
    const value = part[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) errors[key] = 'Enter a value greater than zero.';
    else if (value > MAX_DIMENSION_MM) errors[key] = `Maximum ${MAX_DIMENSION_MM.toLocaleString()} mm.`;
  };
  positive('lengthMm');
  if (part.partType === 'plenum-box') {
    (['bodyWidthMm', 'bodyHeightMm', 'bodyDepthMm'] as const).forEach((key) => {
      const value = part[key]; if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) errors[key] = 'Enter a value greater than zero.'; else if (value > MAX_DIMENSION_MM) errors[key] = `Maximum ${MAX_DIMENSION_MM.toLocaleString()} mm.`;
    });
    const invalidPort = (part.plenumPorts ?? []).find((port) => !Number.isFinite(port.offsetHorizontalMm) || !Number.isFinite(port.offsetVerticalMm) || !Number.isFinite(port.projectionMm) || port.projectionMm < 0 || (port.shape === 'round' ? !Number.isFinite(port.diameterMm) || port.diameterMm <= 0 : !Number.isFinite(port.widthMm) || port.widthMm <= 0 || !Number.isFinite(port.heightMm) || port.heightMm <= 0));
    if (invalidPort) errors.plenumPorts = `${invalidPort.id} has invalid size, position or connector length.`;
  }
  if (profileForEnd(part, 'a') === 'round') positive('endADiameterMm'); else { positive('endAWidthMm'); positive('endAHeightMm'); }
  if (profileForEnd(part, 'b') === 'round') positive('endBDiameterMm'); else { positive('endBWidthMm'); positive('endBHeightMm'); }
  (['horizontalOffsetMm', 'verticalOffsetMm'] as const).forEach((key) => {
    const value = part[key];
    if (!Number.isFinite(value)) errors[key] = 'Enter a finite offset.';
    else if (Math.abs(value) > MAX_DIMENSION_MM) errors[key] = `Maximum ±${MAX_DIMENSION_MM.toLocaleString()} mm.`;
  });
  (['outletHorizontalAngleDeg', 'outletVerticalAngleDeg'] as const).forEach((key) => {
    const value = part[key]; if (!Number.isFinite(value) || Math.abs(value) > 85) errors[key] = 'Enter an outlet angle from −85° to 85°.';
  });
  if (!Number.isFinite(part.outletRotationDeg) || Math.abs(part.outletRotationDeg) > 180) errors.outletRotationDeg = 'Enter a rotation from −180° to 180°.';
  if (!Number.isFinite(part.quantity) || !Number.isInteger(part.quantity) || part.quantity < 1) errors.quantity = 'Quantity must be a whole number of at least one.';
  else if (part.quantity > 10_000) errors.quantity = 'Maximum quantity is 10,000.';
  if (!Number.isFinite(part.thicknessMm) || part.thicknessMm <= 0) errors.thicknessMm = 'Enter a thickness greater than zero.';
  else if (part.thicknessMm > 20) errors.thicknessMm = 'Maximum thickness is 20 mm.';
  if (!part.name.trim()) errors.name = 'Enter a part name.';
  return errors;
}

export function dimensionLabel(key: EditableDimensionKey): string {
  const labels: Record<EditableDimensionKey, string> = { endAWidthMm: 'End A width', endAHeightMm: 'End A height', endBWidthMm: 'End B width', endBHeightMm: 'End B height', endADiameterMm: 'End A diameter', endBDiameterMm: 'End B diameter', lengthMm: 'Body length', horizontalOffsetMm: 'Horizontal offset', verticalOffsetMm: 'Vertical offset', outletHorizontalAngleDeg: 'Horizontal outlet angle', outletVerticalAngleDeg: 'Vertical outlet angle', outletRotationDeg: 'Outlet-axis rotation' };
  return labels[key];
}
export function dimensionUnit(key: EditableDimensionKey): 'mm' | '°' { return key.includes('Angle') || key === 'outletRotationDeg' ? '°' : 'mm'; }
export function validateDimensionValue(part: CustomPart, key: EditableDimensionKey, value: number): string | null {
  if (!Number.isFinite(value)) return 'Enter a finite number.';
  const candidate = { ...part, [key]: value }; return validateCustomPart(candidate)[key] ?? null;
}

function add(a: Vector3, b: Vector3): Vector3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(a: Vector3, value: number): Vector3 { return { x: a.x * value, y: a.y * value, z: a.z * value }; }
function subtract(a: Vertex3, b: Vertex3): Vertex3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function cross(a: Vector3, b: Vector3): Vector3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function normalize(value: Vector3): Vector3 { const length = Math.hypot(value.x, value.y, value.z) || 1; return scale(value, 1 / length); }
function distance(a: Vertex3, b: Vertex3): number { return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); }
function triangleArea(a: Vertex3, b: Vertex3, c: Vertex3): number { const value = cross(subtract(b, a), subtract(c, a)); return Math.hypot(value.x, value.y, value.z) / 2; }

function planeBasis(direction: Vector3, rotationDeg: number): [Vector3, Vector3] {
  const normal = normalize(direction); const reference = Math.abs(normal.y) > .92 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const baseU = normalize(cross(reference, normal)); const baseV = normalize(cross(normal, baseU)); const angle = rotationDeg * Math.PI / 180;
  return [add(scale(baseU, Math.cos(angle)), scale(baseV, Math.sin(angle))), add(scale(baseU, -Math.sin(angle)), scale(baseV, Math.cos(angle)))];
}

function perimeterPoint(index: number, width: number, height: number): { u: number; v: number } {
  const edgePoints = RING_POINTS / 4; const edge = Math.floor(index / edgePoints); const t = (index % edgePoints) / edgePoints;
  if (edge === 0) return { u: -width / 2 + width * t, v: -height / 2 };
  if (edge === 1) return { u: width / 2, v: -height / 2 + height * t };
  if (edge === 2) return { u: width / 2 - width * t, v: height / 2 };
  return { u: -width / 2, v: height / 2 - height * t };
}

function makeRing(profile: PortProfile, width: number, height: number, diameter: number, centre: Vector3, direction: Vector3, rotationDeg: number): Vertex3[] {
  const [uAxis, vAxis] = planeBasis(direction, rotationDeg);
  return Array.from({ length: RING_POINTS }, (_, index) => {
    const point = profile === 'round'
      ? { u: Math.cos(-Math.PI / 2 + index * Math.PI * 2 / RING_POINTS) * diameter / 2, v: Math.sin(-Math.PI / 2 + index * Math.PI * 2 / RING_POINTS) * diameter / 2 }
      : perimeterPoint(index, width, height);
    return add(centre, add(scale(uAxis, point.u), scale(vAxis, point.v)));
  });
}

export function buildTransitionGeometry(part: CustomPart): TransitionGeometry {
  const profileA = profileForEnd(part, 'a'); const profileB = profileForEnd(part, 'b');
  const centreB = { x: part.horizontalOffsetMm, y: part.verticalOffsetMm, z: part.lengthMm };
  const ringA = makeRing(profileA, part.endAWidthMm, part.endAHeightMm, part.endADiameterMm, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 0);
  const ringB = makeRing(profileB, part.endBWidthMm, part.endBHeightMm, part.endBDiameterMm, centreB, outletDirection(part.outletHorizontalAngleDeg, part.outletVerticalAngleDeg), part.outletRotationDeg);
  const vertices = [...ringA, ...ringB]; const endRings: TransitionGeometry['endRings'] = [Array.from({ length: RING_POINTS }, (_, index) => index), Array.from({ length: RING_POINTS }, (_, index) => index + RING_POINTS)];
  const sideFaces = Array.from({ length: RING_POINTS }, (_, index) => [index, (index + 1) % RING_POINTS, RING_POINTS + (index + 1) % RING_POINTS, RING_POINTS + index] as [number, number, number, number]);
  const cornerIndexes = [0, 6, 12, 18]; const cornerEdgeLengthsMm = cornerIndexes.map((index) => distance(ringA[index], ringB[index])) as TransitionGeometry['cornerEdgeLengthsMm'];
  const areaMm2 = sideFaces.reduce((sum, [a, b, c, d]) => sum + triangleArea(vertices[a], vertices[b], vertices[c]) + triangleArea(vertices[a], vertices[c], vertices[d]), 0);
  const ports = buildCustomPartAssembly(part).ports as [ConnectionPort, ConnectionPort];
  return { vertices, sideFaces, endRings, ports, centrelineLengthMm: Math.hypot(part.lengthMm, part.horizontalOffsetMm, part.verticalOffsetMm), cornerEdgeLengthsMm, surfaceAreaM2: areaMm2 / 1_000_000 };
}

export function solveBodyLengthFromEdge(part: CustomPart, kind: DerivedEdgeKind, targetLengthMm: number, edgeIndex = 0): EdgeLengthSolution {
  const geometry = buildTransitionGeometry(part); const index = ((edgeIndex % 24) + 24) % 24; const start = geometry.vertices[geometry.endRings[0][index]]; const end = geometry.vertices[geometry.endRings[1][index]];
  const deltaX = end.x - start.x; const deltaY = end.y - start.y; const axialLocal = end.z - start.z - part.lengthMm;
  const fixedSquared = kind === 'top-edge' ? deltaX * deltaX : kind === 'side-edge' ? deltaY * deltaY : deltaX * deltaX + deltaY * deltaY;
  const minimumTargetMm = Math.sqrt(fixedSquared + Math.max(0, axialLocal) ** 2);
  if (!Number.isFinite(targetLengthMm) || targetLengthMm < minimumTargetMm || (Math.abs(targetLengthMm - minimumTargetMm) < .000001 && axialLocal >= 0)) return { minimumTargetMm, error: `Enter an edge length greater than ${minimumTargetMm.toFixed(1)} mm.` };
  const axialSquared = targetLengthMm * targetLengthMm - fixedSquared;
  if (axialSquared < -.000001) return { minimumTargetMm, error: `No real body length exists below ${minimumTargetMm.toFixed(1)} mm.` };
  const bodyLengthMm = Math.sqrt(Math.max(0, axialSquared)) - axialLocal;
  if (!Number.isFinite(bodyLengthMm) || bodyLengthMm <= 0 || bodyLengthMm > MAX_DIMENSION_MM) return { minimumTargetMm, error: `The solved body length must be greater than zero and at most ${MAX_DIMENSION_MM.toLocaleString()} mm.` };
  return { minimumTargetMm, bodyLengthMm };
}

export function classifyTransition(part: CustomPart): string {
  const centred = part.horizontalOffsetMm === 0 && part.verticalOffsetMm === 0; const angled = part.outletHorizontalAngleDeg !== 0 || part.outletVerticalAngleDeg !== 0;
  if (part.partType === 'round-transition') {
    const sameSize = part.endADiameterMm === part.endBDiameterMm;
    if (sameSize) return centred ? 'Round straight section' : 'Round same-size offset';
    return `Round ${centred ? 'concentric' : 'eccentric'} ${part.endBDiameterMm > part.endADiameterMm ? 'enlargement' : 'reducer'}${angled ? ' angled' : ''}`;
  }
  if (part.partType === 'rectangular-to-round-transition') return `Rectangular-to-round ${centred ? 'centred' : 'eccentric'}${angled ? ' angled' : ''} transition`;
  if (part.partType === 'round-to-rectangular-transition') return `Round-to-rectangular ${centred ? 'centred' : 'eccentric'}${angled ? ' angled' : ''} transition`;
  const sameSize = part.endAWidthMm === part.endBWidthMm && part.endAHeightMm === part.endBHeightMm;
  if (sameSize) return centred ? 'Rectangular straight section' : 'Rectangular same-size offset';
  const enlargement = part.endBWidthMm * part.endBHeightMm > part.endAWidthMm * part.endAHeightMm;
  return `Rectangular ${centred ? 'centred' : 'offset'} ${enlargement ? 'enlargement' : 'reducer'}`;
}

export function swapTransitionEnds(part: CustomPart): CustomPart {
  const partType = part.partType === 'rectangular-to-round-transition' ? 'round-to-rectangular-transition' : part.partType === 'round-to-rectangular-transition' ? 'rectangular-to-round-transition' : part.partType;
  return {
    ...part, partType, endAWidthMm: part.endBWidthMm, endAHeightMm: part.endBHeightMm, endADiameterMm: part.endBDiameterMm,
    endBWidthMm: part.endAWidthMm, endBHeightMm: part.endAHeightMm, endBDiameterMm: part.endADiameterMm,
    horizontalOffsetMm: -part.horizontalOffsetMm, verticalOffsetMm: -part.verticalOffsetMm,
    outletHorizontalAngleDeg: -part.outletHorizontalAngleDeg, outletVerticalAngleDeg: -part.outletVerticalAngleDeg, outletRotationDeg: -part.outletRotationDeg,
  };
}
