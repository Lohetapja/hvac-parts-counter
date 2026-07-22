import type { CustomPart, PlenumFace, PlenumPort, Vector3 } from './types';

// Parametric rectangular plenum with any number of connection ports.
// Ports are placed on a face using that face's local axes and projected outward by
// their connector length. No boolean cutting is attempted: port footprints are drawn
// as outlines on the host face and overlaps are reported as warnings.

export interface PlenumPortGeometry {
  port: PlenumPort;
  /** Footprint outline on the host face, in body coordinates. */
  outline: Vector3[];
  /** Outer ring of the projected connector. */
  outerRing: Vector3[];
  centre: Vector3;
  normal: Vector3;
  tip: Vector3;
}

export interface PlenumGeometry {
  corners: Vector3[];               // 8 body corners
  boxFaces: Array<[number, number, number, number]>;
  ports: PlenumPortGeometry[];
  inlet: PlenumPortGeometry | null;
  bounds: { min: Vector3; max: Vector3 };
  volumeM3: number;
  surfaceAreaM2: number;
  warnings: string[];
}

export function plenumBody(part: CustomPart): { width: number; height: number; depth: number } {
  return {
    width: Math.max(1, part.bodyWidthMm ?? 600),
    height: Math.max(1, part.bodyHeightMm ?? 400),
    depth: Math.max(1, part.bodyDepthMm ?? 300),
  };
}

// Face local frame: origin at face centre, u = local horizontal, v = local vertical,
// n = outward normal. Body is centred on the origin with depth along +Z.
function faceFrame(face: PlenumFace, w: number, h: number, d: number): { origin: Vector3; u: Vector3; v: Vector3; n: Vector3; halfU: number; halfV: number } {
  const hx = w / 2; const hy = h / 2; const hz = d / 2;
  switch (face) {
    case 'front': return { origin: { x: 0, y: 0, z: hz }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, n: { x: 0, y: 0, z: 1 }, halfU: hx, halfV: hy };
    case 'back': return { origin: { x: 0, y: 0, z: -hz }, u: { x: -1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, n: { x: 0, y: 0, z: -1 }, halfU: hx, halfV: hy };
    case 'left': return { origin: { x: -hx, y: 0, z: 0 }, u: { x: 0, y: 0, z: 1 }, v: { x: 0, y: 1, z: 0 }, n: { x: -1, y: 0, z: 0 }, halfU: hz, halfV: hy };
    case 'right': return { origin: { x: hx, y: 0, z: 0 }, u: { x: 0, y: 0, z: -1 }, v: { x: 0, y: 1, z: 0 }, n: { x: 1, y: 0, z: 0 }, halfU: hz, halfV: hy };
    case 'top': return { origin: { x: 0, y: hy, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: -1 }, n: { x: 0, y: 1, z: 0 }, halfU: hx, halfV: hz };
    default: return { origin: { x: 0, y: -hy, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 }, n: { x: 0, y: -1, z: 0 }, halfU: hx, halfV: hz };
  }
}

const add = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vector3, k: number): Vector3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const normalize = (value: Vector3): Vector3 => { const length = Math.hypot(value.x, value.y, value.z) || 1; return scale(value, 1 / length); };

function portOutline(port: PlenumPort, points = 24): Array<{ u: number; v: number }> {
  const rotation = (port.rotationDeg ?? 0) * Math.PI / 180;
  const spin = (p: { u: number; v: number }): { u: number; v: number } => ({
    u: p.u * Math.cos(rotation) - p.v * Math.sin(rotation),
    v: p.u * Math.sin(rotation) + p.v * Math.cos(rotation),
  });
  if (port.shape === 'round') {
    const r = Math.max(1, port.diameterMm) / 2;
    return Array.from({ length: points }, (_, i) => spin({ u: Math.cos(i / points * Math.PI * 2) * r, v: Math.sin(i / points * Math.PI * 2) * r }));
  }
  const hw = Math.max(1, port.widthMm) / 2; const hh = Math.max(1, port.heightMm) / 2;
  return [{ u: -hw, v: -hh }, { u: hw, v: -hh }, { u: hw, v: hh }, { u: -hw, v: hh }].map(spin);
}

function portExtent(port: PlenumPort): { halfU: number; halfV: number } {
  if (port.shape === 'round') { const r = Math.max(1, port.diameterMm) / 2; return { halfU: r, halfV: r }; }
  return { halfU: Math.max(1, port.widthMm) / 2, halfV: Math.max(1, port.heightMm) / 2 };
}

export function buildPlenumGeometry(part: CustomPart): PlenumGeometry {
  const { width, height, depth } = plenumBody(part);
  const hx = width / 2; const hy = height / 2; const hz = depth / 2;
  const corners: Vector3[] = [
    { x: -hx, y: -hy, z: hz }, { x: hx, y: -hy, z: hz }, { x: hx, y: hy, z: hz }, { x: -hx, y: hy, z: hz },
    { x: -hx, y: -hy, z: -hz }, { x: hx, y: -hy, z: -hz }, { x: hx, y: hy, z: -hz }, { x: -hx, y: hy, z: -hz },
  ];
  const boxFaces: Array<[number, number, number, number]> = [
    [0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0],
  ];

  const warnings: string[] = [];
  const ports = (part.plenumPorts ?? []).map((port) => buildPort(port, width, height, depth, warnings));

  // Inlet is modelled as a port on the back face from the shared endA parameters.
  const inletPort: PlenumPort = {
    id: 'P1', name: 'Inlet P1', face: 'back', shape: 'rectangular',
    widthMm: part.endAWidthMm, heightMm: part.endAHeightMm, diameterMm: part.endADiameterMm,
    offsetHorizontalMm: 0, offsetVerticalMm: 0, projectionMm: 80, rotationDeg: 0, role: 'inlet', notes: '',
  };
  const inlet = buildPort(inletPort, width, height, depth, warnings);

  // Overlap warnings between ports sharing a face (no boolean cuts are attempted).
  const byFace = new Map<PlenumFace, PlenumPortGeometry[]>();
  ports.forEach((p) => { const list = byFace.get(p.port.face) ?? []; list.push(p); byFace.set(p.port.face, list); });
  byFace.forEach((list) => {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i].port; const b = list[j].port;
        const ea = portExtent(a); const eb = portExtent(b);
        const du = Math.abs(a.offsetHorizontalMm - b.offsetHorizontalMm);
        const dv = Math.abs(a.offsetVerticalMm - b.offsetVerticalMm);
        if (du < ea.halfU + eb.halfU && dv < ea.halfV + eb.halfV) {
          warnings.push(`${a.id} and ${b.id} overlap on the ${a.face} face.`);
        }
      }
    }
  });

  const volumeM3 = (width * height * depth) / 1_000_000_000;
  const surfaceAreaM2 = 2 * (width * height + width * depth + height * depth) / 1_000_000;
  const all = [...ports.map((p) => p.tip), ...corners];
  const bounds = {
    min: { x: Math.min(...all.map((p) => p.x)), y: Math.min(...all.map((p) => p.y)), z: Math.min(...all.map((p) => p.z)) },
    max: { x: Math.max(...all.map((p) => p.x)), y: Math.max(...all.map((p) => p.y)), z: Math.max(...all.map((p) => p.z)) },
  };
  return { corners, boxFaces, ports, inlet, bounds, volumeM3, surfaceAreaM2, warnings };
}

function buildPort(port: PlenumPort, width: number, height: number, depth: number, warnings: string[]): PlenumPortGeometry {
  const frame = faceFrame(port.face, width, height, depth);
  const extent = portExtent(port);
  if (Math.abs(port.offsetHorizontalMm) + extent.halfU > frame.halfU + 0.001
    || Math.abs(port.offsetVerticalMm) + extent.halfV > frame.halfV + 0.001) {
    warnings.push(`${port.id} extends beyond the ${port.face} face.`);
  }
  const centre = add(frame.origin, add(scale(frame.u, port.offsetHorizontalMm), scale(frame.v, port.offsetVerticalMm)));
  const outline = portOutline(port).map((p) => add(centre, add(scale(frame.u, p.u), scale(frame.v, p.v))));
  const tilt = (90 - Math.min(135, Math.max(45, port.branchAngleDeg ?? 90))) * Math.PI / 180;
  const direction = normalize(add(scale(frame.n, Math.cos(tilt)), scale(frame.u, Math.sin(tilt))));
  const tipCentre = add(centre, scale(direction, Math.max(0, port.projectionMm)));
  const outerRing = portOutline(port).map((p) => add(tipCentre, add(scale(frame.u, p.u), scale(frame.v, p.v))));
  return { port, outline, outerRing, centre, normal: direction, tip: tipCentre };
}

export function nextPortId(ports: PlenumPort[]): string {
  let n = 1;
  const used = new Set(ports.map((p) => p.id));
  while (used.has(`B${n}`)) n += 1;
  return `B${n}`;
}

export function portSizeLabel(port: PlenumPort): string {
  return port.shape === 'round' ? `Ø${port.diameterMm}` : `${port.widthMm}×${port.heightMm}`;
}
