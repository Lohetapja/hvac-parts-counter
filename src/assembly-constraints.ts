import type { Vector3 } from './types';

// Simple, non-iterative port-based constraint model.
//
// One component is grounded (the assembly root). Every other component is placed by
// walking the constraint graph outward from that root and applying a single closed-form
// transform per constraint. There is deliberately no general solver: a constraint that
// cannot be satisfied in one pass is reported as a conflict instead of being relaxed.

export type ConstraintId = string;

export interface ConstraintPortRef {
  componentId: string;
  portId: string;
}

export interface FixedConstraint { kind: 'fixed'; id: ConstraintId; componentId: string }
export interface PortMateConstraint {
  kind: 'port-mate'; id: ConstraintId;
  a: ConstraintPortRef; b: ConstraintPortRef;
  /** Rotation of B about the shared port axis, in degrees. */
  rollDeg: number;
  /** Optional gap along the shared axis (e.g. a connector allowance). */
  offsetMm: number;
}
export interface AxisAlignmentConstraint { kind: 'axis-alignment'; id: ConstraintId; a: ConstraintPortRef; b: ConstraintPortRef }
export interface FlushConstraint { kind: 'flush'; id: ConstraintId; a: ConstraintPortRef; b: ConstraintPortRef; axis: 'x' | 'y' | 'z' }
export interface ConcentricConstraint { kind: 'concentric'; id: ConstraintId; a: ConstraintPortRef; b: ConstraintPortRef }
export interface OffsetConstraint { kind: 'offset'; id: ConstraintId; a: ConstraintPortRef; b: ConstraintPortRef; offsetMm: number; axis: 'x' | 'y' | 'z' }
export interface AngleConstraint { kind: 'angle'; id: ConstraintId; a: ConstraintPortRef; b: ConstraintPortRef; angleDeg: number }
export interface RotationConstraint { kind: 'rotation'; id: ConstraintId; a: ConstraintPortRef; b: ConstraintPortRef; rollDeg: number }

export type AssemblyConstraint =
  | FixedConstraint | PortMateConstraint | AxisAlignmentConstraint | FlushConstraint
  | ConcentricConstraint | OffsetConstraint | AngleConstraint | RotationConstraint;

/** A port expressed in its own component's local frame. */
export interface ComponentPort {
  id: string;
  position: Vector3;
  /** Outward direction (unit vector) the connection faces. */
  direction: Vector3;
  shape: 'round' | 'rectangular';
  widthMm?: number;
  heightMm?: number;
  diameterMm?: number;
}

export interface AssemblyComponent {
  id: string;
  name: string;
  ports: ComponentPort[];
  grounded?: boolean;
}

/** Rigid placement: rotation matrix (row-major 3x3) plus translation. */
export interface Placement { rotation: number[]; translation: Vector3 }

export interface ConstraintConflict {
  constraintId: ConstraintId;
  message: string;
  involved: string[];
}

export interface AssemblyResult {
  placements: Record<string, Placement>;
  conflicts: ConstraintConflict[];
  rootId: string | null;
  order: string[];
}

// --- vector / matrix helpers ------------------------------------------------
const add = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a: Vector3, k: number): Vector3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vector3, b: Vector3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vector3, b: Vector3): Vector3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const length = (a: Vector3): number => Math.hypot(a.x, a.y, a.z);
export const normalize = (a: Vector3): Vector3 => { const l = length(a) || 1; return mul(a, 1 / l); };

export const IDENTITY: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function applyMatrix(m: number[], v: Vector3): Vector3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}
export function multiplyMatrix(a: number[], b: number[]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) {
    out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return out;
}
/** Rotation taking unit vector `from` onto unit vector `to` (Rodrigues, closed form). */
export function rotationBetween(from: Vector3, to: Vector3): number[] {
  const f = normalize(from); const t = normalize(to);
  const c = Math.max(-1, Math.min(1, dot(f, t)));
  if (c > 0.999999) return [...IDENTITY];
  if (c < -0.999999) {
    // Opposite vectors: rotate 180° about any axis perpendicular to f.
    const seed: Vector3 = Math.abs(f.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const axis = normalize(cross(f, seed));
    return rotationAboutAxis(axis, Math.PI);
  }
  const axis = normalize(cross(f, t));
  return rotationAboutAxis(axis, Math.acos(c));
}
export function rotationAboutAxis(axis: Vector3, angleRad: number): number[] {
  const a = normalize(axis); const s = Math.sin(angleRad); const c = Math.cos(angleRad); const t = 1 - c;
  return [
    t * a.x * a.x + c, t * a.x * a.y - s * a.z, t * a.x * a.z + s * a.y,
    t * a.x * a.y + s * a.z, t * a.y * a.y + c, t * a.y * a.z - s * a.x,
    t * a.x * a.z - s * a.y, t * a.y * a.z + s * a.x, t * a.z * a.z + c,
  ];
}

function portOf(component: AssemblyComponent, portId: string): ComponentPort | undefined {
  return component.ports.find((p) => p.id === portId);
}
function profilesMatch(a: ComponentPort, b: ComponentPort, toleranceMm = 1): boolean {
  if (a.shape !== b.shape) return false;
  if (a.shape === 'round') return Math.abs((a.diameterMm ?? 0) - (b.diameterMm ?? 0)) <= toleranceMm;
  return Math.abs((a.widthMm ?? 0) - (b.widthMm ?? 0)) <= toleranceMm && Math.abs((a.heightMm ?? 0) - (b.heightMm ?? 0)) <= toleranceMm;
}

/**
 * Closed-form port mate: rotate B so its port faces exactly opposite A's port,
 * apply the requested roll about the shared axis, then translate so the port
 * centres coincide (plus an optional axial offset).
 */
export function solvePortMate(
  parentPlacement: Placement, parentPort: ComponentPort,
  childPort: ComponentPort, rollDeg: number, offsetMm: number,
): Placement {
  const parentDirWorld = normalize(applyMatrix(parentPlacement.rotation, parentPort.direction));
  const parentPosWorld = add(applyMatrix(parentPlacement.rotation, parentPort.position), parentPlacement.translation);
  // Child port must face opposite the parent port.
  const target = mul(parentDirWorld, -1);
  let rotation = rotationBetween(childPort.direction, target);
  if (rollDeg) rotation = multiplyMatrix(rotationAboutAxis(target, rollDeg * Math.PI / 180), rotation);
  const childPosRotated = applyMatrix(rotation, childPort.position);
  // Optional gap measured along the parent's outward direction.
  const seat = add(parentPosWorld, mul(parentDirWorld, offsetMm));
  return { rotation, translation: sub(seat, childPosRotated) };
}

/**
 * Places every component by walking outward from the grounded root. Each component is
 * visited once; a constraint that would move an already-placed component is reported as
 * a conflict rather than solved iteratively.
 */
export function solveAssembly(components: AssemblyComponent[], constraints: AssemblyConstraint[]): AssemblyResult {
  const byId = new Map(components.map((c) => [c.id, c]));
  const conflicts: ConstraintConflict[] = [];
  const placements: Record<string, Placement> = {};
  const order: string[] = [];

  const fixed = constraints.find((c): c is FixedConstraint => c.kind === 'fixed');
  const rootId = fixed?.componentId ?? components.find((c) => c.grounded)?.id ?? components[0]?.id ?? null;
  if (!rootId || !byId.has(rootId)) return { placements, conflicts, rootId: null, order };

  placements[rootId] = { rotation: [...IDENTITY], translation: { x: 0, y: 0, z: 0 } };
  order.push(rootId);

  // Adjacency of mate-style constraints (the ones that actually place components).
  type Edge = { other: string; constraint: AssemblyConstraint; fromPort: string; toPort: string };
  const edges = new Map<string, Edge[]>();
  constraints.forEach((constraint) => {
    if (constraint.kind === 'fixed') return;
    const { a, b } = constraint as { a: ConstraintPortRef; b: ConstraintPortRef };
    if (!a || !b) return;
    const push = (from: string, to: string, fromPort: string, toPort: string): void => {
      const list = edges.get(from) ?? []; list.push({ other: to, constraint, fromPort, toPort }); edges.set(from, list);
    };
    push(a.componentId, b.componentId, a.portId, b.portId);
    push(b.componentId, a.componentId, b.portId, a.portId);
  });

  const queue = [rootId];
  const visited = new Set<string>([rootId]);
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId) break;
    const current = byId.get(currentId);
    const currentPlacement = placements[currentId];
    if (!current || !currentPlacement) continue;

    for (const edge of edges.get(currentId) ?? []) {
      const child = byId.get(edge.other);
      if (!child) continue;
      const parentPort = portOf(current, edge.fromPort);
      const childPort = portOf(child, edge.toPort);
      if (!parentPort || !childPort) {
        conflicts.push({ constraintId: edge.constraint.id, message: `Constraint references a missing port (${edge.fromPort} / ${edge.toPort}).`, involved: [currentId, edge.other] });
        continue;
      }
      if (visited.has(edge.other)) {
        // Already positioned from another branch: this is a loop closure we do not solve.
        continue;
      }
      const constraint = edge.constraint;
      let roll = 0; let offset = 0;
      if (constraint.kind === 'port-mate') { roll = constraint.rollDeg; offset = constraint.offsetMm; }
      else if (constraint.kind === 'rotation') roll = constraint.rollDeg;
      else if (constraint.kind === 'offset') offset = constraint.offsetMm;

      if (constraint.kind === 'port-mate' || constraint.kind === 'concentric') {
        if (!profilesMatch(parentPort, childPort)) {
          conflicts.push({
            constraintId: constraint.id,
            message: `Port profiles do not match: ${parentPort.shape} ${parentPort.diameterMm ?? `${parentPort.widthMm}×${parentPort.heightMm}`} vs ${childPort.shape} ${childPort.diameterMm ?? `${childPort.widthMm}×${childPort.heightMm}`}.`,
            involved: [`${currentId}.${parentPort.id}`, `${edge.other}.${childPort.id}`],
          });
          continue;
        }
      }
      placements[edge.other] = solvePortMate(currentPlacement, parentPort, childPort, roll, offset);
      visited.add(edge.other); order.push(edge.other); queue.push(edge.other);
    }
  }

  components.forEach((c) => {
    if (!placements[c.id]) conflicts.push({ constraintId: '', message: `${c.name} is not connected to the grounded root and was not placed.`, involved: [c.id] });
  });
  return { placements, conflicts, rootId, order };
}

/** World position/direction of a port after assembly placement. */
export function worldPort(placement: Placement, port: ComponentPort): { position: Vector3; direction: Vector3 } {
  return {
    position: add(applyMatrix(placement.rotation, port.position), placement.translation),
    direction: normalize(applyMatrix(placement.rotation, port.direction)),
  };
}
