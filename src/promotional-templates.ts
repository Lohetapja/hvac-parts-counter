import type { CustomPart, CustomPartType, PlenumPort } from './types';

export type PromotionalTemplateId =
  | 'rectangular-straight'
  | 'round-straight'
  | 'rectangular-centred'
  | 'rectangular-horizontal-offset'
  | 'rectangular-vertical-offset'
  | 'rectangular-double-offset'
  | 'rectangular-to-round'
  | 'round-to-rectangular'
  | 'round-concentric-reducer'
  | 'round-eccentric-reducer'
  | 'plenum-multiple-round'
  | 'rectangular-saddle';

export type TemplateFamily = 'straight' | 'rectangular-loft' | 'mixed-loft' | 'round-loft' | 'plenum';

export interface PromotionalTemplateDefinition {
  id: PromotionalTemplateId;
  name: string;
  description: string;
  category: 'Rectangular' | 'Round' | 'Mixed profile' | 'Branches' | 'Plenums';
  family: TemplateFamily;
  profilePath: string;
  portCount: number | 'multiple';
  parameters: string;
  tags: string[];
  partType: CustomPartType;
  defaults: Partial<CustomPart>;
}

const port = (value: Partial<PlenumPort> & Pick<PlenumPort, 'id' | 'name' | 'face' | 'shape'>): PlenumPort => ({
  widthMm: 200, heightMm: 160, diameterMm: 160, offsetHorizontalMm: 0, offsetVerticalMm: 0,
  projectionMm: 90, rotationDeg: 0, role: 'outlet', notes: '', ...value,
});

export const PROMOTIONAL_TEMPLATES: PromotionalTemplateDefinition[] = [
  { id: 'rectangular-straight', name: 'Rectangular straight duct', description: 'Constant rectangular sleeve or extension.', category: 'Rectangular', family: 'straight', profilePath: 'Rectangle → Rectangle', portCount: 2, parameters: 'width, height, length', tags: ['straight', 'sleeve'], partType: 'rectangular-transition', defaults: { name: 'Rectangular straight duct 500×300', endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 500, endBHeightMm: 300, lengthMm: 800, horizontalOffsetMm: 0, verticalOffsetMm: 0 } },
  { id: 'round-straight', name: 'Round straight duct', description: 'Constant circular sleeve with two round ports.', category: 'Round', family: 'straight', profilePath: 'Circle → Circle', portCount: 2, parameters: 'diameter, length', tags: ['straight', 'spigot'], partType: 'round-transition', defaults: { name: 'Round straight duct Ø250', endADiameterMm: 250, endBDiameterMm: 250, lengthMm: 800, horizontalOffsetMm: 0, verticalOffsetMm: 0 } },
  { id: 'rectangular-centred', name: 'Rectangular centred transition', description: 'Four-sided centred reducer or enlargement.', category: 'Rectangular', family: 'rectangular-loft', profilePath: 'Rectangle → Rectangle', portCount: 2, parameters: 'both end sizes, length', tags: ['transition', 'centred', 'reducer'], partType: 'rectangular-transition', defaults: { name: 'Rectangular centred reducer 500×300 to 300×200', endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 300, endBHeightMm: 200, lengthMm: 600, horizontalOffsetMm: 0, verticalOffsetMm: 0 } },
  { id: 'rectangular-horizontal-offset', name: 'Horizontal-offset transition', description: 'End P2 moves sideways while its elevation stays fixed.', category: 'Rectangular', family: 'rectangular-loft', profilePath: 'Rectangle ⇢ Rectangle', portCount: 2, parameters: 'end sizes, length, X offset', tags: ['transition', 'horizontal', 'offset'], partType: 'rectangular-transition', defaults: { name: 'Horizontal offset transition', endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 300, endBHeightMm: 200, lengthMm: 600, horizontalOffsetMm: 140, verticalOffsetMm: 0 } },
  { id: 'rectangular-vertical-offset', name: 'Vertical-offset transition', description: 'End P2 changes elevation while staying centred horizontally.', category: 'Rectangular', family: 'rectangular-loft', profilePath: 'Rectangle ↗ Rectangle', portCount: 2, parameters: 'end sizes, length, Y offset', tags: ['transition', 'vertical', 'offset'], partType: 'rectangular-transition', defaults: { name: 'Vertical offset transition', endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 300, endBHeightMm: 200, lengthMm: 600, horizontalOffsetMm: 0, verticalOffsetMm: 120 } },
  { id: 'rectangular-double-offset', name: 'Double-offset transition', description: 'Combined horizontal and vertical movement through one loft.', category: 'Rectangular', family: 'rectangular-loft', profilePath: 'Rectangle ⇗ Rectangle', portCount: 2, parameters: 'end sizes, length, X/Y offsets', tags: ['transition', 'double', 'offset'], partType: 'rectangular-transition', defaults: { name: 'Double-offset transition 500×300 to 300×200', endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 300, endBHeightMm: 200, lengthMm: 600, horizontalOffsetMm: 120, verticalOffsetMm: 80 } },
  { id: 'rectangular-to-round', name: 'Rectangular → round transition', description: 'Real mixed-profile loft from rectangle to circle.', category: 'Mixed profile', family: 'mixed-loft', profilePath: 'Rectangle → Circle', portCount: 2, parameters: 'W×H, Ø, length, offsets, outlet angles', tags: ['transition', 'mixed', 'eccentric'], partType: 'rectangular-to-round-transition', defaults: { name: 'Eccentric rectangular to round 500×300 to Ø250', endAWidthMm: 500, endAHeightMm: 300, endBDiameterMm: 250, lengthMm: 600, horizontalOffsetMm: 100, verticalOffsetMm: 50 } },
  { id: 'round-to-rectangular', name: 'Round → rectangular transition', description: 'Reverse mixed-profile loft from circle to rectangle.', category: 'Mixed profile', family: 'mixed-loft', profilePath: 'Circle → Rectangle', portCount: 2, parameters: 'Ø, W×H, length, offsets, outlet angles', tags: ['transition', 'mixed', 'reverse'], partType: 'round-to-rectangular-transition', defaults: { name: 'Round to rectangular Ø250 to 400×250', endADiameterMm: 250, endBWidthMm: 400, endBHeightMm: 250, lengthMm: 550, horizontalOffsetMm: -70, verticalOffsetMm: 40 } },
  { id: 'round-concentric-reducer', name: 'Round concentric reducer', description: 'Circular reducer sharing one centre axis.', category: 'Round', family: 'round-loft', profilePath: 'Circle → Circle', portCount: 2, parameters: 'Ø1, Ø2, length', tags: ['reducer', 'concentric'], partType: 'round-transition', defaults: { name: 'Round concentric reducer Ø315 to Ø200', endADiameterMm: 315, endBDiameterMm: 200, lengthMm: 450, horizontalOffsetMm: 0, verticalOffsetMm: 0 } },
  { id: 'round-eccentric-reducer', name: 'Round eccentric reducer', description: 'Circular reducer with a controlled transverse offset.', category: 'Round', family: 'round-loft', profilePath: 'Circle ⇢ Circle', portCount: 2, parameters: 'Ø1, Ø2, length, offset', tags: ['reducer', 'eccentric', 'offset'], partType: 'round-transition', defaults: { name: 'Round eccentric reducer Ø315 to Ø200', endADiameterMm: 315, endBDiameterMm: 200, lengthMm: 450, horizontalOffsetMm: 58, verticalOffsetMm: 0 } },
  { id: 'plenum-multiple-round', name: 'Plenum with four round outlets', description: 'Distribution box with a rectangular inlet and four positioned Ø160 outlets.', category: 'Plenums', family: 'plenum', profilePath: 'Rectangle → 4 × Circle', portCount: 'multiple', parameters: 'body W×H×D, inlet, outlet sizes and positions', tags: ['plenum', 'manifold', 'multiple outlets'], partType: 'plenum-box', defaults: { name: '600×400 plenum with four Ø160 outlets', bodyWidthMm: 600, bodyHeightMm: 400, bodyDepthMm: 320, endAWidthMm: 400, endAHeightMm: 250, plenumPorts: [port({ id: 'B1', name: 'Outlet B1', face: 'front', shape: 'round', offsetHorizontalMm: -170, offsetVerticalMm: 90 }), port({ id: 'B2', name: 'Outlet B2', face: 'front', shape: 'round', offsetHorizontalMm: 170, offsetVerticalMm: 90 }), port({ id: 'B3', name: 'Outlet B3', face: 'front', shape: 'round', offsetHorizontalMm: -170, offsetVerticalMm: -90 }), port({ id: 'B4', name: 'Outlet B4', face: 'front', shape: 'round', offsetHorizontalMm: 170, offsetVerticalMm: -90 })] } },
  { id: 'rectangular-saddle', name: 'Rectangular top saddle', description: 'Rectangular takeoff on a grounded rectangular host body.', category: 'Branches', family: 'plenum', profilePath: 'Rectangle body + Rectangle', portCount: 2, parameters: 'host body, branch W×H, face position, projection', tags: ['saddle', 'branch', 'top'], partType: 'plenum-box', defaults: { name: 'Rectangular top saddle 250×180', bodyWidthMm: 700, bodyHeightMm: 400, bodyDepthMm: 350, endAWidthMm: 500, endAHeightMm: 300, plenumPorts: [port({ id: 'B1', name: 'Top saddle B1', face: 'top', shape: 'rectangular', widthMm: 250, heightMm: 180, offsetHorizontalMm: 100, projectionMm: 140, role: 'branch' })] } },
];

export const DEMO_TEMPLATE_IDS: PromotionalTemplateId[] = ['rectangular-double-offset', 'rectangular-to-round', 'round-eccentric-reducer', 'round-concentric-reducer', 'rectangular-horizontal-offset', 'round-straight', 'rectangular-saddle', 'plenum-multiple-round'];

export function promotionalTemplateById(id?: string): PromotionalTemplateDefinition | undefined { return PROMOTIONAL_TEMPLATES.find((template) => template.id === id); }
export function promotionalTemplateForPart(part: CustomPart): PromotionalTemplateDefinition | undefined { return promotionalTemplateById(part.templateId); }

export function promotionalThumbnail(template: PromotionalTemplateDefinition): string {
  const roundA = template.partType === 'round-transition' || template.partType === 'round-to-rectangular-transition';
  const roundB = template.partType === 'round-transition' || template.partType === 'rectangular-to-round-transition';
  if (template.family === 'plenum') {
    const outlets = template.defaults.plenumPorts ?? []; const shapes = outlets.map((p, index) => p.shape === 'round' ? `<circle cx="${42 + index % 2 * 22}" cy="${24 + Math.floor(index / 2) * 18}" r="5"/>` : `<rect x="${36 + index % 2 * 24}" y="${18 + Math.floor(index / 2) * 20}" width="13" height="9"/>`).join('');
    return `<svg viewBox="0 0 96 64" class="tpl-thumb-svg" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 18h58v38H18zM18 18l12-9h58v38l-12 9M76 18l12-9M76 56l12-9" fill="currentColor" fill-opacity=".08"/>${shapes}<path d="M5 28h13v18H5z"/></svg>`;
  }
  const ax = 13; const ay = 15; const bx = 76 + Math.sign(template.defaults.horizontalOffsetMm ?? 0) * 4; const by = 23 - Math.sign(template.defaults.verticalOffsetMm ?? 0) * 7;
  const a = roundA ? `<ellipse cx="${ax + 5}" cy="32" rx="6" ry="14"/>` : `<rect x="${ax}" y="${ay}" width="11" height="34"/>`;
  const b = roundB ? `<ellipse cx="${bx + 5}" cy="${by + 9}" rx="6" ry="10"/>` : `<rect x="${bx}" y="${by}" width="11" height="20"/>`;
  return `<svg viewBox="0 0 100 64" class="tpl-thumb-svg" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${a}${b}<path d="M24 15L${bx} ${by}M24 49L${bx} ${by + 20}"/><path d="M24 15L${bx} ${by}L${bx} ${by + 20}L24 49Z" fill="currentColor" fill-opacity=".1"/></svg>`;
}
