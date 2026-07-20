import type { Point } from './types';
import type { ContractBoundary, DuctLabelAssociation, DuctNetwork, DuctNode, DuctProfile, DuctSegment } from './duct-network-types';
import { uid } from './duct-network';

// Synthetic acceptance-test fixture. Represents the real drawing sequence:
//   600×400 YLÖS · 500×400 ALAS · 500×200 duct · two 90° bends ·
//   500×200 → 300×200 transition · 300×200 continuation · three Ø160 branches.
// Lengths are authored so the 500×200 and 300×200 runs stay separate and the
// transition adds no straight-duct length. Vertical length is intentionally absent.

const RECT_500_200: DuctProfile = { shape: 'rectangular', widthMm: 500, heightMm: 200 };
const RECT_300_200: DuctProfile = { shape: 'rectangular', widthMm: 300, heightMm: 200 };
const RECT_600_400: DuctProfile = { shape: 'rectangular', widthMm: 600, heightMm: 400 };
const RECT_500_400: DuctProfile = { shape: 'rectangular', widthMm: 500, heightMm: 400 };
const ROUND_160: DuctProfile = { shape: 'round', diameterMm: 160 };

export interface DuctFixture { network: DuctNetwork; segments: DuctSegment[]; nodes: DuctNode[]; labels: DuctLabelAssociation[]; boundaries: ContractBoundary[]; }

export function createDemoDuctNetwork(pageNumber: number): DuctFixture {
  const timestamp = new Date().toISOString();
  const network: DuctNetwork = {
    id: uid('dnet'), pageNumber, name: 'TK-01 demo (Tulo)', systemType: 'supply', segmentIds: [], nodeIds: [],
    verificationStatus: 'suggested', source: 'manual', notes: 'Synthetic acceptance-test system.', createdAt: timestamp, updatedAt: timestamp,
  };

  const segments: DuctSegment[] = [];
  const nodes: DuctNode[] = [];
  const labels: DuctLabelAssociation[] = [];
  const boundaries: ContractBoundary[] = [];

  const seg = (points: Point[], profile: DuctProfile, lengthMm: number): DuctSegment => {
    const segment: DuctSegment = { id: uid('dseg'), pageNumber, networkId: network.id, profile, centrelinePoints: points, lengthMm, source: 'manual', verificationStatus: 'suggested', relatedLabelIds: [] };
    segments.push(segment); network.segmentIds.push(segment.id); return segment;
  };
  const node = (partial: Omit<DuctNode, 'id' | 'pageNumber' | 'networkId' | 'relatedLabelIds' | 'verificationStatus'> & Partial<Pick<DuctNode, 'verificationStatus'>>): DuctNode => {
    const created: DuctNode = { id: uid('dnode'), pageNumber, networkId: network.id, relatedLabelIds: [], verificationStatus: partial.verificationStatus ?? 'suggested', ...partial };
    nodes.push(created); network.nodeIds.push(created.id); return created;
  };
  const label = (point: Point, raw: string, kind: DuctLabelAssociation['kind'], profile: DuctProfile | undefined, target: { segmentId?: string; nodeId?: string }): void => {
    labels.push({ id: uid('dlabel'), pageNumber, raw, normalized: raw, kind, profile, classes: raw.includes('A25') ? ['A25'] : [], point, verificationStatus: 'suggested', ...target });
  };

  // Straight runs. 500×200 total = 8.4 m (3.4 + 1.6 + 3.4); 300×200 = 12.6 m.
  const sA = seg([{ x: 180, y: 180 }, { x: 430, y: 180 }], RECT_500_200, 3400);
  const sB = seg([{ x: 455, y: 180 }, { x: 455, y: 255 }], RECT_500_200, 1600);
  const sC = seg([{ x: 455, y: 300 }, { x: 600, y: 300 }], RECT_500_200, 3400);
  const sD = seg([{ x: 640, y: 300 }, { x: 900, y: 300 }], RECT_300_200, 12600);
  // Out-of-scope incoming stub before the contract boundary (600×400, 2.0 m). Excluded once a project side is chosen.
  const sStub = seg([{ x: 80, y: 180 }, { x: 175, y: 180 }], RECT_600_400, 2000);

  // Vertical continuations — no invented vertical length.
  const ylos = node({ point: { x: 150, y: 150 }, type: 'continuation', direction: 'up', incomingProfile: RECT_600_400, outgoingProfile: RECT_600_400, notes: 'YLÖS riser' });
  const alas = node({ point: { x: 150, y: 220 }, type: 'continuation', direction: 'down', incomingProfile: RECT_500_400, outgoingProfile: RECT_500_400, notes: 'ALAS drop' });

  node({ point: { x: 455, y: 180 }, type: 'bend', angleDeg: 90, incomingProfile: RECT_500_200, outgoingProfile: RECT_500_200 });
  node({ point: { x: 455, y: 278 }, type: 'bend', angleDeg: 90, incomingProfile: RECT_500_200, outgoingProfile: RECT_500_200 });
  const transition = node({ point: { x: 620, y: 300 }, type: 'transition', incomingProfile: RECT_500_200, outgoingProfile: RECT_300_200, transitionOffset: 'centred' });

  ([700, 780, 860]).forEach((x, index) => {
    node({ point: { x, y: 300 }, type: 'branch', incomingProfile: RECT_300_200, outgoingProfile: ROUND_160 });
    node({ point: { x, y: 345 }, type: 'terminal', incomingProfile: ROUND_160, notes: `Ø160 terminal ${index + 1}` });
  });

  label({ x: 150, y: 140 }, 'YLÖS', 'ylos', undefined, { nodeId: ylos.id });
  label({ x: 150, y: 235 }, 'ALAS', 'alas', undefined, { nodeId: alas.id });
  label({ x: 150, y: 128 }, '600x400 (E)', 'rectangular', RECT_600_400, { nodeId: ylos.id });
  label({ x: 150, y: 248 }, '500x400 (E)', 'rectangular', RECT_500_400, { nodeId: alas.id });
  label({ x: 300, y: 168 }, '500x200 A25(E)', 'rectangular', RECT_500_200, { segmentId: sA.id });
  label({ x: 770, y: 288 }, '300x200 A25(E)', 'rectangular', RECT_300_200, { segmentId: sD.id });
  label({ x: 700, y: 360 }, 'Ø160', 'round', ROUND_160, { nodeId: transition.id });
  label({ x: 130, y: 168 }, 'UR', 'unknown', undefined, {});
  void sB; void sC;

  // Two UR contract boundaries. The first gates the out-of-scope incoming stub.
  boundaries.push({ id: uid('dur'), pageNumber, point: { x: 176, y: 180 }, relatedNetworkId: network.id, relatedSegmentId: sStub.id, scopeSide: 'unknown', verificationStatus: 'suggested', notes: 'Incoming contract boundary' });
  boundaries.push({ id: uid('dur'), pageNumber, point: { x: 905, y: 300 }, relatedNetworkId: network.id, relatedSegmentId: sD.id, scopeSide: 'both', verificationStatus: 'suggested', notes: 'Downstream contract boundary' });

  return { network, segments, nodes, labels, boundaries };
}
