import type { CustomPart, CustomPartType, PlenumPort } from './types';

// Typed parametric template registry. Every fitting family declares its editable
// parameters here so the builder renders controls from data instead of duplicating
// a bespoke form per family. Level 2 (assemblies) and Level 3 (profile lofts) are
// declared as "coming-later" so the architecture is visible without faking editors.

export type PartTemplateId =
  | 'rectangular-transition'
  | 'rectangular-to-round'
  | 'round-to-rectangular'
  | 'plenum-box'
  | 'custom-assembly'
  | 'profile-loft';

export type ParameterType = 'length' | 'angle' | 'integer' | 'text' | 'select' | 'boolean';

export interface TemplateParameterDefinition {
  key: string;
  label: string;
  group: string;
  type: ParameterType;
  unit?: 'mm' | 'deg';
  defaultValue: number | string | boolean;
  minimum?: number;
  maximum?: number;
  step?: number;
  required: boolean;
  helpText?: string;
}

export type TemplateStatus = 'available' | 'coming-later';

export interface PartTemplateDefinition {
  id: PartTemplateId;
  name: string;
  description: string;
  category: 'Transitions' | 'Branches' | 'Equipment connections' | 'Assemblies';
  tags: string[];
  inletProfile: 'rectangular' | 'round' | 'either';
  outletProfile: 'rectangular' | 'round' | 'either' | 'multiple';
  status: TemplateStatus;
  /** Underlying CustomPart discriminator, when the family is implemented. */
  partType?: CustomPartType;
  parameterDefinitions: TemplateParameterDefinition[];
  parameterSummary: string;
}

const MM = 'mm' as const;
const DEG = 'deg' as const;

function lengthParam(key: string, label: string, group: string, defaultValue: number, helpText?: string): TemplateParameterDefinition {
  return { key, label, group, type: 'length', unit: MM, defaultValue, minimum: 1, maximum: 20000, step: 1, required: true, helpText };
}
function offsetParam(key: string, label: string, group: string, helpText: string): TemplateParameterDefinition {
  return { key, label, group, type: 'length', unit: MM, defaultValue: 0, minimum: -20000, maximum: 20000, step: 10, required: false, helpText };
}
function angleParam(key: string, label: string, group: string, limit = 85): TemplateParameterDefinition {
  return { key, label, group, type: 'angle', unit: DEG, defaultValue: 0, minimum: -limit, maximum: limit, step: 1, required: false };
}

const SHARED_BODY: TemplateParameterDefinition[] = [
  lengthParam('lengthMm', 'Body length', 'Body', 600),
  offsetParam('horizontalOffsetMm', 'Horizontal offset X', 'Offsets', '+X moves the outlet right, −X left.'),
  offsetParam('verticalOffsetMm', 'Vertical offset Y', 'Offsets', '+Y moves the outlet up, −Y down.'),
  angleParam('outletHorizontalAngleDeg', 'Outlet horizontal angle', 'Outlet direction'),
  angleParam('outletVerticalAngleDeg', 'Outlet vertical angle', 'Outlet direction'),
  angleParam('outletRotationDeg', 'Outlet rotation', 'Outlet direction', 180),
];
const MATERIAL_PARAMS: TemplateParameterDefinition[] = [
  { key: 'thicknessMm', label: 'Thickness', group: 'Material', type: 'length', unit: MM, defaultValue: 0.7, minimum: 0.1, maximum: 20, step: 0.1, required: true },
  { key: 'quantity', label: 'Quantity', group: 'Quantity', type: 'integer', defaultValue: 1, minimum: 1, maximum: 10000, step: 1, required: true },
];

const RECT_A: TemplateParameterDefinition[] = [
  lengthParam('endAWidthMm', 'End A width', 'Port P1', 500),
  lengthParam('endAHeightMm', 'End A height', 'Port P1', 300),
];
const RECT_B: TemplateParameterDefinition[] = [
  lengthParam('endBWidthMm', 'End B width', 'Port P2', 300),
  lengthParam('endBHeightMm', 'End B height', 'Port P2', 200),
];
const ROUND_A: TemplateParameterDefinition[] = [lengthParam('endADiameterMm', 'End A diameter', 'Port P1', 250)];
const ROUND_B: TemplateParameterDefinition[] = [lengthParam('endBDiameterMm', 'End B diameter', 'Port P2', 250)];

export const PART_TEMPLATES: PartTemplateDefinition[] = [
  {
    id: 'rectangular-transition', name: 'Rectangular → rectangular transition',
    description: 'Reducer, enlargement or same-size offset between two rectangular ports.',
    category: 'Transitions', tags: ['rectangular', 'transition', 'reducer', 'offset'],
    inletProfile: 'rectangular', outletProfile: 'rectangular', status: 'available', partType: 'rectangular-transition',
    parameterDefinitions: [...RECT_A, ...RECT_B, ...SHARED_BODY, ...MATERIAL_PARAMS],
    parameterSummary: 'W×H both ends, length, X/Y offsets, outlet angles',
  },
  {
    id: 'rectangular-to-round', name: 'Rectangular → round transition',
    description: 'Lofted transition from a rectangular port to a circular port.',
    category: 'Transitions', tags: ['mixed', 'transition', 'round', 'rectangular'],
    inletProfile: 'rectangular', outletProfile: 'round', status: 'available', partType: 'rectangular-to-round-transition',
    parameterDefinitions: [...RECT_A, ...ROUND_B, ...SHARED_BODY, ...MATERIAL_PARAMS],
    parameterSummary: 'Rect W×H, round Ø, length, X/Y offsets, outlet angles',
  },
  {
    id: 'round-to-rectangular', name: 'Round → rectangular transition',
    description: 'The same loft reversed: circular inlet to rectangular outlet.',
    category: 'Transitions', tags: ['mixed', 'transition', 'round', 'rectangular'],
    inletProfile: 'round', outletProfile: 'rectangular', status: 'available', partType: 'round-to-rectangular-transition',
    parameterDefinitions: [...ROUND_A, ...RECT_B, ...SHARED_BODY, ...MATERIAL_PARAMS],
    parameterSummary: 'Round Ø, rect W×H, length, X/Y offsets, outlet angles',
  },
  {
    id: 'plenum-box', name: 'Plenum box with outlets',
    description: 'Rectangular plenum body with one inlet and any number of round or rectangular outlet ports.',
    category: 'Equipment connections', tags: ['plenum', 'box', 'branches', 'equipment', 'multiple outlets'],
    inletProfile: 'either', outletProfile: 'multiple', status: 'available', partType: 'plenum-box',
    parameterDefinitions: [
      lengthParam('bodyWidthMm', 'Body width', 'Body', 600),
      lengthParam('bodyHeightMm', 'Body height', 'Body', 400),
      lengthParam('bodyDepthMm', 'Body depth', 'Body', 300),
      lengthParam('endAWidthMm', 'Inlet width', 'Inlet', 400),
      lengthParam('endAHeightMm', 'Inlet height', 'Inlet', 200),
      ...MATERIAL_PARAMS,
    ],
    parameterSummary: 'Body W×H×D, inlet size, N outlet ports per face',
  },
  {
    id: 'custom-assembly', name: 'Custom assembly', description: 'Combine several body segments and connection ports into one fabricated assembly.',
    category: 'Assemblies', tags: ['assembly', 'multi-segment'], inletProfile: 'either', outletProfile: 'multiple',
    status: 'coming-later', parameterDefinitions: [], parameterSummary: 'Level 2 — segment graph and port connections',
  },
  {
    id: 'profile-loft', name: 'Build from profiles', description: 'Define several cross-sections and loft a body between them.',
    category: 'Assemblies', tags: ['loft', 'profiles'], inletProfile: 'either', outletProfile: 'either',
    status: 'coming-later', parameterDefinitions: [], parameterSummary: 'Level 3 — multi-section profile loft',
  },
];

export function templateById(id: string): PartTemplateDefinition | undefined {
  return PART_TEMPLATES.find((template) => template.id === id);
}
export function templateForPart(part: CustomPart): PartTemplateDefinition | undefined {
  if (part.templateId) { const byId = templateById(part.templateId); if (byId) return byId; }
  return PART_TEMPLATES.find((template) => template.partType === part.partType);
}

export function defaultPlenumPorts(): PlenumPort[] {
  return [
    { id: 'B1', name: 'Outlet B1', face: 'front', shape: 'round', widthMm: 200, heightMm: 200, diameterMm: 160, offsetHorizontalMm: -150, offsetVerticalMm: 0, projectionMm: 80, rotationDeg: 0, role: 'outlet', notes: '' },
    { id: 'B2', name: 'Outlet B2', face: 'front', shape: 'round', widthMm: 200, heightMm: 200, diameterMm: 160, offsetHorizontalMm: 150, offsetVerticalMm: 0, projectionMm: 80, rotationDeg: 0, role: 'outlet', notes: '' },
  ];
}

// --- Generic SVG thumbnails (self-drawn, no commercial imagery) -------------
function wrap(inner: string): string {
  return `<svg viewBox="0 0 96 60" xmlns="http://www.w3.org/2000/svg" class="tpl-thumb-svg" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
export function templateThumbnail(id: PartTemplateId): string {
  switch (id) {
    case 'rectangular-transition':
      return wrap('<rect x="10" y="12" width="12" height="36"/><rect x="74" y="22" width="12" height="16"/><path d="M22 12 L74 22 M22 48 L74 38" stroke-dasharray="0"/><path d="M22 12 L74 22 L74 38 L22 48 Z" fill="currentColor" fill-opacity=".12"/>');
    case 'rectangular-to-round':
      return wrap('<rect x="10" y="12" width="10" height="36"/><ellipse cx="80" cy="30" rx="6" ry="12"/><path d="M20 12 L76 18 M20 48 L76 42" /><path d="M20 12 L76 18 L76 42 L20 48 Z" fill="currentColor" fill-opacity=".12"/>');
    case 'round-to-rectangular':
      return wrap('<ellipse cx="16" cy="30" rx="6" ry="12"/><rect x="76" y="12" width="10" height="36"/><path d="M20 18 L76 12 M20 42 L76 48" /><path d="M20 18 L76 12 L76 48 L20 42 Z" fill="currentColor" fill-opacity=".12"/>');
    case 'plenum-box':
      return wrap('<rect x="18" y="14" width="52" height="34" fill="currentColor" fill-opacity=".12"/><path d="M70 14 L82 8 L82 42 L70 48"/><path d="M18 14 L30 8 L82 8"/><circle cx="34" cy="31" r="6"/><circle cx="54" cy="31" r="6"/><rect x="4" y="24" width="14" height="12"/>');
    case 'custom-assembly':
      return wrap('<rect x="8" y="20" width="26" height="20" stroke-dasharray="4 3"/><rect x="42" y="14" width="22" height="32" stroke-dasharray="4 3"/><rect x="72" y="22" width="18" height="16" stroke-dasharray="4 3"/><path d="M34 30 L42 30 M64 30 L72 30"/>');
    default:
      return wrap('<path d="M14 16 L30 10 L30 46 L14 52 Z" stroke-dasharray="4 3"/><path d="M46 14 L62 9 L62 47 L46 52 Z" stroke-dasharray="4 3"/><path d="M78 18 L90 14 L90 44 L78 48 Z" stroke-dasharray="4 3"/>');
  }
}
