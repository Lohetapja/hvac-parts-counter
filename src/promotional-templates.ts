import { syncCustomPartAssembly } from './custom-part-assembly';
import { realGeometryThumbnail } from './geometry-thumbnail';
import type { CustomPart, CustomPartType, PlenumPort } from './types';

export type PromotionalTemplateId = 'rectangular-transition' | 'rectangular-to-round' | 'round-reducer' | 'rectangular-elbow' | 'round-elbow' | 'round-saddle' | 't-piece' | 'plenum-four-outlet';
export type TemplateFamily = 'rectangular-loft' | 'mixed-loft' | 'round-loft' | 'elbow' | 'host-branch' | 'plenum';
export type HeroGroup = 'Transitions' | 'Bends' | 'Branches' | 'Boxes and equipment';
export interface TemplatePreset { id: string; name: string; defaults: Partial<CustomPart> }
export interface PromotionalTemplateDefinition {
  id: PromotionalTemplateId; name: string; description: string; group: HeroGroup; category: 'Rectangular' | 'Round' | 'Mixed profile' | 'Branches' | 'Plenums'; family: TemplateFamily;
  profilePath: string; portCount: number; tags: string[]; partType: CustomPartType; defaults: Partial<CustomPart>; presets: TemplatePreset[];
}

const port = (value: Partial<PlenumPort> & Pick<PlenumPort, 'id' | 'name' | 'face' | 'shape'>): PlenumPort => ({ widthMm: 200, heightMm: 160, diameterMm: 160, offsetHorizontalMm: 0, offsetVerticalMm: 0, projectionMm: 100, rotationDeg: 0, role: 'outlet', notes: '', ...value });
const preset = (id: string, name: string, defaults: Partial<CustomPart>): TemplatePreset => ({ id, name, defaults });

const rectTransitionPresets = [
  preset('centred-reducer', 'Centred reducer', { endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 300, endBHeightMm: 200, horizontalOffsetMm: 0, verticalOffsetMm: 0 }),
  preset('centred-enlargement', 'Centred enlargement', { endAWidthMm: 300, endAHeightMm: 200, endBWidthMm: 500, endBHeightMm: 300, horizontalOffsetMm: 0, verticalOffsetMm: 0 }),
  preset('horizontal-offset', 'Horizontal offset', { horizontalOffsetMm: 140, verticalOffsetMm: 0 }), preset('vertical-offset', 'Vertical offset', { horizontalOffsetMm: 0, verticalOffsetMm: 120 }),
  preset('double-offset', 'Double offset', { horizontalOffsetMm: 120, verticalOffsetMm: 80 }), preset('one-side-fixed', 'One side fixed', { horizontalOffsetMm: -100, verticalOffsetMm: 0 }),
  preset('two-sides-fixed', 'Two sides fixed', { horizontalOffsetMm: -100, verticalOffsetMm: -50 }), preset('four-sided-taper', 'Four-sided taper', { horizontalOffsetMm: 0, verticalOffsetMm: 0, endBWidthMm: 260, endBHeightMm: 160 }),
];
const roundPresets = [preset('concentric-reducer', 'Concentric reducer', { endADiameterMm: 315, endBDiameterMm: 200, horizontalOffsetMm: 0, verticalOffsetMm: 0 }), preset('concentric-enlargement', 'Concentric enlargement', { endADiameterMm: 200, endBDiameterMm: 315, horizontalOffsetMm: 0, verticalOffsetMm: 0 }), preset('eccentric-reducer', 'Eccentric reducer', { endADiameterMm: 315, endBDiameterMm: 200, horizontalOffsetMm: 58, verticalOffsetMm: 0 }), preset('eccentric-enlargement', 'Eccentric enlargement', { endADiameterMm: 200, endBDiameterMm: 315, horizontalOffsetMm: -58, verticalOffsetMm: 0 }), preset('short-reducer', 'Short reducer', { endADiameterMm: 315, endBDiameterMm: 200, horizontalOffsetMm: 0, verticalOffsetMm: 0, lengthMm: 220 }), preset('long-reducer', 'Long reducer', { endADiameterMm: 315, endBDiameterMm: 200, horizontalOffsetMm: 0, verticalOffsetMm: 0, lengthMm: 650 })];
const elbowPresets = (round: boolean) => [preset('radius-90', 'Radius 90°', { bendAngleDeg: 90, bendRadiusMm: round ? 320 : 450, segmentCount: 14 }), preset('radius-45', 'Radius 45°', { bendAngleDeg: 45, bendRadiusMm: round ? 300 : 420, segmentCount: 8 }), preset('segmented-90', 'Segmented 90°', { bendAngleDeg: 90, bendRadiusMm: round ? 280 : 380, segmentCount: 5 }), preset('long-radius', 'Long radius', { bendAngleDeg: 90, bendRadiusMm: round ? 450 : 650, segmentCount: 16 })];

const saddlePorts = [port({ id: 'P2', name: 'Main outlet P2', face: 'front', shape: 'rectangular', widthMm: 500, heightMm: 300, projectionMm: 80, role: 'outlet' }), port({ id: 'B1', name: 'Round saddle B1', face: 'top', shape: 'round', diameterMm: 180, offsetHorizontalMm: 80, projectionMm: 180, role: 'branch' })];
const teePorts = [port({ id: 'P2', name: 'Main outlet P2', face: 'front', shape: 'rectangular', widthMm: 500, heightMm: 300, projectionMm: 80, role: 'outlet' }), port({ id: 'B1', name: 'Branch B1', face: 'right', shape: 'rectangular', widthMm: 250, heightMm: 200, projectionMm: 260, branchAngleDeg: 90, role: 'branch' })];
const plenumPorts = [
  port({ id: 'B1', name: 'Round outlet B1', face: 'front', shape: 'round', diameterMm: 160, offsetHorizontalMm: -170, offsetVerticalMm: -90, projectionMm: 110 }),
  port({ id: 'B2', name: 'Round outlet B2', face: 'front', shape: 'round', diameterMm: 160, offsetHorizontalMm: 170, offsetVerticalMm: -90, projectionMm: 110 }),
  port({ id: 'B3', name: 'Round outlet B3', face: 'front', shape: 'round', diameterMm: 160, offsetHorizontalMm: -170, offsetVerticalMm: 90, projectionMm: 110 }),
  port({ id: 'B4', name: 'Round outlet B4', face: 'front', shape: 'round', diameterMm: 160, offsetHorizontalMm: 170, offsetVerticalMm: 90, projectionMm: 110 }),
];

export const PROMOTIONAL_TEMPLATES: PromotionalTemplateDefinition[] = [
  { id: 'rectangular-transition', name: 'Rectangular transition', description: 'Reducers, enlargements and offsets in one loft family.', group: 'Transitions', category: 'Rectangular', family: 'rectangular-loft', profilePath: 'Rectangle → Rectangle', portCount: 2, tags: ['transition', 'offset', 'reducer'], partType: 'rectangular-transition', defaults: { name: 'Rectangular double-offset transition', presetId: 'double-offset', endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 300, endBHeightMm: 200, lengthMm: 600, horizontalOffsetMm: 120, verticalOffsetMm: 80 }, presets: rectTransitionPresets },
  { id: 'rectangular-to-round', name: 'Rectangular → round', description: 'Mixed-profile equipment and duct connection.', group: 'Transitions', category: 'Mixed profile', family: 'mixed-loft', profilePath: 'Rectangle → Circle', portCount: 2, tags: ['transition', 'mixed', 'eccentric'], partType: 'rectangular-to-round-transition', defaults: { name: 'Eccentric rectangular to round', presetId: 'eccentric', endAWidthMm: 500, endAHeightMm: 300, endBDiameterMm: 250, lengthMm: 600, horizontalOffsetMm: 100, verticalOffsetMm: 50 }, presets: [preset('centred', 'Centred', { horizontalOffsetMm: 0, verticalOffsetMm: 0 }), preset('eccentric', 'Eccentric', { horizontalOffsetMm: 100, verticalOffsetMm: 50 })] },
  { id: 'round-reducer', name: 'Round reducer', description: 'Concentric and eccentric circular size changes.', group: 'Transitions', category: 'Round', family: 'round-loft', profilePath: 'Circle → Circle', portCount: 2, tags: ['round', 'reducer', 'eccentric'], partType: 'round-transition', defaults: { name: 'Eccentric round reducer Ø315 to Ø200', presetId: 'eccentric-reducer', endADiameterMm: 315, endBDiameterMm: 200, lengthMm: 450, horizontalOffsetMm: 58, verticalOffsetMm: 0 }, presets: roundPresets },
  { id: 'rectangular-elbow', name: 'Rectangular elbow', description: 'Swept rectangular bend with visible inner radius.', group: 'Bends', category: 'Rectangular', family: 'elbow', profilePath: 'Rectangle ↱ Rectangle', portCount: 2, tags: ['elbow', 'bend', 'radius'], partType: 'rectangular-elbow', defaults: { name: 'Rectangular 90° radius elbow', presetId: 'radius-90', endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 500, endBHeightMm: 300, bendRadiusMm: 450, bendAngleDeg: 90, inletExtensionMm: 140, outletExtensionMm: 140, segmentCount: 14, lengthMm: 450 }, presets: elbowPresets(false) },
  { id: 'round-elbow', name: 'Round elbow', description: 'Curved circular bend with configurable radius and angle.', group: 'Bends', category: 'Round', family: 'elbow', profilePath: 'Circle ↱ Circle', portCount: 2, tags: ['round', 'elbow', 'bend'], partType: 'round-elbow', defaults: { name: 'Round 90° elbow Ø250', presetId: 'radius-90', endADiameterMm: 250, endBDiameterMm: 250, bendRadiusMm: 320, bendAngleDeg: 90, inletExtensionMm: 120, outletExtensionMm: 120, segmentCount: 14, lengthMm: 320 }, presets: elbowPresets(true) },
  // Round saddle, rectangular saddle and the rectangular T-piece share one topology
  // (continuous host duct + attached branch port), so they are one family with presets
  // rather than three headline cards representing the same geometry.
  { id: 'round-saddle', name: 'Branch / saddle on duct', description: 'Continuous host duct with an attached round or rectangular branch takeoff.', group: 'Branches', category: 'Branches', family: 'host-branch', profilePath: 'Duct + branch', portCount: 3, tags: ['saddle', 'satula', 'branch', 'haara', 'tee', 'takeoff', 'lähtö'], partType: 'plenum-box', defaults: { name: 'Ø200 top saddle on 500 × 300 duct', presetId: 'top-saddle', bodyWidthMm: 500, bodyHeightMm: 300, bodyDepthMm: 700, endAWidthMm: 500, endAHeightMm: 300, plenumPorts: saddlePorts }, presets: [
    preset('top-saddle', 'Round saddle on top', { plenumPorts: saddlePorts }),
    preset('side-saddle', 'Round saddle on side', { plenumPorts: [saddlePorts[0], { ...saddlePorts[1], face: 'right' }] }),
    preset('rectangular-tee', 'Rectangular T-piece branch', { plenumPorts: teePorts }),
    preset('reduced-branch', 'Reduced rectangular branch', { plenumPorts: [teePorts[0], { ...teePorts[1], widthMm: 180, heightMm: 140 }] }),
  ] },
  { id: 'plenum-four-outlet', name: 'Four-outlet plenum', description: 'Distribution box with one inlet and four attached collars.', group: 'Boxes and equipment', category: 'Plenums', family: 'plenum', profilePath: 'Rectangle → 4 × Circle', portCount: 5, tags: ['plenum', 'four outlet', 'distribution'], partType: 'plenum-box', defaults: { name: '600×400 plenum with four Ø160 outlets', presetId: 'four-round', bodyWidthMm: 600, bodyHeightMm: 400, bodyDepthMm: 320, endAWidthMm: 400, endAHeightMm: 250, plenumPorts }, presets: [preset('four-round', 'Four round outlets', { plenumPorts }), preset('two-round', 'Two round outlets', { plenumPorts: [plenumPorts[0], plenumPorts[3]] }), preset('mixed', 'Mixed outlets', { plenumPorts: [plenumPorts[0], { ...plenumPorts[1], shape: 'rectangular', widthMm: 220, heightMm: 140 }] })] },
];

export const DEMO_TEMPLATE_IDS: PromotionalTemplateId[] = PROMOTIONAL_TEMPLATES.map((template) => template.id);
export function promotionalTemplateById(id?: string): PromotionalTemplateDefinition | undefined { return PROMOTIONAL_TEMPLATES.find((template) => template.id === id); }
export function promotionalTemplateForPart(part: CustomPart): PromotionalTemplateDefinition | undefined { return promotionalTemplateById(part.templateId); }
export function partForThumbnail(template: PromotionalTemplateDefinition): CustomPart {
  const now = 'thumbnail'; const base = { id: `thumb-${template.id}`, name: template.name, partType: template.partType, endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 300, endBHeightMm: 200, endADiameterMm: 250, endBDiameterMm: 200, lengthMm: 600, horizontalOffsetMm: 0, verticalOffsetMm: 0, outletHorizontalAngleDeg: 0, outletVerticalAngleDeg: 0, outletRotationDeg: 0, quantity: 1, system: 'Supply air', material: 'Galvanized steel', thicknessMm: .7, notes: '', createdAt: now, updatedAt: now, verificationStatus: 'suggested' as const } as CustomPart;
  return syncCustomPartAssembly({ ...base, ...structuredClone(template.defaults), templateId: template.id, partType: template.partType });
}
export function promotionalThumbnail(template: PromotionalTemplateDefinition): string { return realGeometryThumbnail(partForThumbnail(template)); }
