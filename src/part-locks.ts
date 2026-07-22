import { emptyLockState } from './types';
import type { CustomPart, ElementLockState, LockLevel, PlenumPort } from './types';
import { plenumBody } from './plenum-geometry';

// Lock and grounding rules. This is deliberately NOT a general constraint solver:
// one element acts as the anchor (root) and the remaining geometry is regenerated
// outward from it. Conflicting edits are rejected rather than solved iteratively.

export type LockTarget = 'body' | 'portA' | 'portB';

export function lockStateFor(part: CustomPart, target: LockTarget): ElementLockState {
  const existing = target === 'body' ? part.bodyLocks : target === 'portA' ? part.portALocks : part.portBLocks;
  return existing ?? emptyLockState();
}

export function withLockState(part: CustomPart, target: LockTarget, locks: ElementLockState): CustomPart {
  if (target === 'body') return { ...part, bodyLocks: locks };
  if (target === 'portA') return { ...part, portALocks: locks };
  return { ...part, portBLocks: locks };
}

export function positionFullyLocked(locks: ElementLockState): boolean {
  return locks.grounded || (locks.position.x && locks.position.y && locks.position.z);
}
function anyPositionLocked(locks: ElementLockState): boolean {
  return locks.grounded || locks.position.x || locks.position.y || locks.position.z;
}

export function lockLevel(locks: ElementLockState, overConstrained = false): LockLevel {
  if (overConstrained) return 'over-constrained';
  const dimensionLocks = Object.values(locks.dimensions).filter(Boolean).length;
  const all = positionFullyLocked(locks) && locks.rotation.x && locks.rotation.y && locks.rotation.z && locks.profileLocked;
  if (all) return 'locked';
  if (anyPositionLocked(locks) || locks.rotation.x || locks.rotation.y || locks.rotation.z || locks.profileLocked || locks.connectionLocked || locks.hostFaceLocked || dimensionLocks) return 'partial';
  return 'unlocked';
}

/**
 * Which end stays fixed while the body regenerates. P1 is the natural model origin;
 * when only P2 is position-locked the geometry is shifted so P2 appears fixed and
 * P1 moves in the opposite direction instead.
 */
export type Anchor = 'P1' | 'P2';
export function resolveAnchor(part: CustomPart): Anchor {
  const a = lockStateFor(part, 'portA'); const b = lockStateFor(part, 'portB');
  if (positionFullyLocked(b) && !positionFullyLocked(a)) return 'P2';
  return 'P1';
}

/** Origin shift applied to generated geometry so the anchored port stays put. */
export function anchorOffset(part: CustomPart): { x: number; y: number; z: number } {
  if (resolveAnchor(part) !== 'P2') return { x: 0, y: 0, z: 0 };
  return { x: -part.horizontalOffsetMm, y: -part.verticalOffsetMm, z: -part.lengthMm };
}

export interface LockConflict {
  message: string;
  involved: string[];
  unlockTarget?: { target: LockTarget; property: string };
}

/** True when both end ports are position-locked: length/offsets become derived. */
export function isOverConstrained(part: CustomPart): boolean {
  return positionFullyLocked(lockStateFor(part, 'portA')) && positionFullyLocked(lockStateFor(part, 'portB'));
}

/** Length implied by the two locked port positions. */
export function derivedLengthMm(part: CustomPart): number {
  return Math.hypot(part.lengthMm, part.horizontalOffsetMm, part.verticalOffsetMm);
}

const GEOMETRY_KEYS = ['lengthMm', 'horizontalOffsetMm', 'verticalOffsetMm'];

/**
 * Guards a single parameter edit against the current locks. Returns a conflict when
 * the edit must be rejected so the previous valid geometry is preserved.
 */
export function checkEdit(part: CustomPart, key: string, nextValue: number): LockConflict | null {
  const bodyLocks = lockStateFor(part, 'body');
  const portA = lockStateFor(part, 'portA');
  const portB = lockStateFor(part, 'portB');

  if (isOverConstrained(part) && GEOMETRY_KEYS.includes(key)) {
    return {
      message: `Over-constrained: P1 and P2 are both position-locked, so ${key === 'lengthMm' ? 'body length' : 'the offset'} is derived from their separation (${derivedLengthMm(part).toFixed(1)} mm).`,
      involved: ['P1 position lock', 'P2 position lock'],
      unlockTarget: { target: 'portB', property: 'position' },
    };
  }
  if (bodyLocks.dimensions[key] || portA.dimensions[key] || portB.dimensions[key]) {
    const owner: LockTarget = bodyLocks.dimensions[key] ? 'body' : portA.dimensions[key] ? 'portA' : 'portB';
    return {
      message: `${key} is locked. Unlock it before changing the value.`,
      involved: [`${owner} dimension lock: ${key}`],
      unlockTarget: { target: owner, property: key },
    };
  }
  const profileKeysA = ['endAWidthMm', 'endAHeightMm', 'endADiameterMm'];
  const profileKeysB = ['endBWidthMm', 'endBHeightMm', 'endBDiameterMm'];
  if (portA.profileLocked && profileKeysA.includes(key)) {
    return { message: 'P1 profile size is locked.', involved: ['P1 profile lock'], unlockTarget: { target: 'portA', property: 'profile' } };
  }
  if (portB.profileLocked && profileKeysB.includes(key)) {
    return { message: 'P2 profile size is locked.', involved: ['P2 profile lock'], unlockTarget: { target: 'portB', property: 'profile' } };
  }
  if (bodyLocks.grounded && ['bodyWidthMm', 'bodyHeightMm', 'bodyDepthMm'].includes(key) && bodyLocks.dimensions[key]) {
    return { message: 'The grounded body has this dimension locked.', involved: ['body ground'], unlockTarget: { target: 'body', property: key } };
  }
  void nextValue;
  return null;
}

/**
 * After a plenum body resize, locked ports keep their offsets. Reports any locked
 * port that would now sit outside its host face so the user can resolve it.
 */
export function plenumLockWarnings(part: CustomPart): string[] {
  if (part.partType !== 'plenum-box') return [];
  const { width, height, depth } = plenumBody(part);
  const halfFor = (port: PlenumPort): { u: number; v: number } => {
    switch (port.face) {
      case 'left': case 'right': return { u: depth / 2, v: height / 2 };
      case 'top': case 'bottom': return { u: width / 2, v: depth / 2 };
      default: return { u: width / 2, v: height / 2 };
    }
  };
  const warnings: string[] = [];
  (part.plenumPorts ?? []).forEach((port) => {
    if (!port.locks || lockLevel(port.locks) === 'unlocked') return;
    const half = halfFor(port);
    const extent = port.shape === 'round'
      ? { u: port.diameterMm / 2, v: port.diameterMm / 2 }
      : { u: port.widthMm / 2, v: port.heightMm / 2 };
    if (Math.abs(port.offsetHorizontalMm) + extent.u > half.u + 0.001 || Math.abs(port.offsetVerticalMm) + extent.v > half.v + 0.001) {
      warnings.push(`Locked port ${port.id} no longer fits the resized ${port.face} face — unlock it or enlarge the body.`);
    }
  });
  return warnings;
}

/** Applies defaults so older saved parts load with every lock open. */
export function ensureLocks(part: CustomPart): CustomPart {
  const next = { ...part };
  next.bodyLocks ??= emptyLockState();
  next.portALocks ??= emptyLockState();
  next.portBLocks ??= emptyLockState();
  if (next.plenumPorts) next.plenumPorts = next.plenumPorts.map((port) => ({ ...port, locks: port.locks ?? emptyLockState() }));
  return next;
}

export function quickAction(locks: ElementLockState, action: 'lock-all' | 'unlock-all' | 'position-only' | 'dimensions-only'): ElementLockState {
  const on = { x: true, y: true, z: true }; const off = { x: false, y: false, z: false };
  switch (action) {
    case 'lock-all': return { ...locks, grounded: true, position: { ...on }, rotation: { ...on }, profileLocked: true, connectionLocked: true, hostFaceLocked: true };
    case 'unlock-all': return { grounded: false, position: { ...off }, rotation: { ...off }, dimensions: {}, profileLocked: false, hostFaceLocked: false, connectionLocked: false };
    case 'position-only': return { ...locks, position: { ...on }, rotation: { ...off }, profileLocked: false };
    default: return { ...locks, position: { ...off }, rotation: { ...off }, profileLocked: true };
  }
}
