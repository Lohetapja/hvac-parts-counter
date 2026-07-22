import type { ConnectionPort, CustomPart, CustomPartAssembly, PartSegment, PortProfile, Vector3 } from './types';

function radians(value: number): number { return value * Math.PI / 180; }
export function outletDirection(horizontalDeg: number, verticalDeg: number): Vector3 {
  const horizontal = radians(horizontalDeg); const vertical = radians(verticalDeg);
  const vector = { x: Math.sin(horizontal) * Math.cos(vertical), y: Math.sin(vertical), z: Math.cos(horizontal) * Math.cos(vertical) };
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

export function profileForEnd(part: CustomPart, end: 'a' | 'b'): PortProfile {
  if (part.partType === 'round-transition') return 'round';
  if (part.partType === 'rectangular-to-round-transition') return end === 'a' ? 'rectangular' : 'round';
  if (part.partType === 'round-to-rectangular-transition') return end === 'a' ? 'round' : 'rectangular';
  return 'rectangular';
}

function port(part: CustomPart, end: 'a' | 'b'): ConnectionPort {
  const profile = profileForEnd(part, end); const isA = end === 'a';
  const position = isA ? { x: 0, y: 0, z: 0 } : { x: part.horizontalOffsetMm, y: part.verticalOffsetMm, z: part.lengthMm };
  const direction = isA ? { x: 0, y: 0, z: -1 } : outletDirection(part.outletHorizontalAngleDeg, part.outletVerticalAngleDeg);
  return {
    id: `${part.id}-${isA ? 'P1' : 'P2'}`, profile, position, direction,
    rotationDeg: isA ? 0 : part.outletRotationDeg, role: isA ? 'inlet' : 'outlet',
    ...(profile === 'round'
      ? { diameterMm: isA ? part.endADiameterMm : part.endBDiameterMm }
      : { widthMm: isA ? part.endAWidthMm : part.endBWidthMm, heightMm: isA ? part.endAHeightMm : part.endBHeightMm }),
  };
}

export function buildCustomPartAssembly(part: CustomPart): CustomPartAssembly {
  const p1 = port(part, 'a'); const p2 = port(part, 'b');
  const segment: PartSegment = {
    id: `${part.id}-S1`, type: part.partType, transform: { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } },
    startPortId: p1.id, endPortId: p2.id,
    parameters: {
      endAWidthMm: part.endAWidthMm, endAHeightMm: part.endAHeightMm, endADiameterMm: part.endADiameterMm,
      endBWidthMm: part.endBWidthMm, endBHeightMm: part.endBHeightMm, endBDiameterMm: part.endBDiameterMm,
      lengthMm: part.lengthMm, horizontalOffsetMm: part.horizontalOffsetMm, verticalOffsetMm: part.verticalOffsetMm,
      outletHorizontalAngleDeg: part.outletHorizontalAngleDeg, outletVerticalAngleDeg: part.outletVerticalAngleDeg, outletRotationDeg: part.outletRotationDeg,
    },
  };
  const previous = part.assembly;
  return {
    id: part.id, name: part.name, partNumber: part.partNumber,
    segments: [segment, ...(previous?.segments ?? []).slice(1)],
    connections: previous?.connections ?? [], attachments: previous?.attachments ?? [],
    ports: [p1, p2, ...(previous?.ports ?? []).slice(2)],
    metadata: {
      partNumber: part.partNumber, system: part.system, material: part.material, thicknessMm: part.thicknessMm, quantity: part.quantity,
      notes: part.notes, verificationStatus: part.verificationStatus, createdAt: part.createdAt, updatedAt: part.updatedAt,
    },
  };
}

export function syncCustomPartAssembly(part: CustomPart): CustomPart {
  const next = { ...part }; next.assembly = buildCustomPartAssembly(next); return next;
}
