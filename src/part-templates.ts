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
/** Catalogue implementation status. Only ready/beta may be opened. */
export type CatalogueStatus = 'ready' | 'beta' | 'planned' | 'assembly-only';

export interface CatalogueEntry {
  id: string;
  name: string;
  nameFi?: string;
  description: string;
  category: string;
  subcategory: string;
  tags: string[];
  inletProfiles: string[];
  outletProfiles: string[];
  portCount: string;
  status: CatalogueStatus;
  parameterSummary: string;
  /** Set only when a real geometry generator backs this entry. */
  geometryGeneratorId?: PartTemplateId;
  thumbnailId: PartTemplateId;
}

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

// --- Full HVAC fitting catalogue -------------------------------------------
// Entries with a geometryGeneratorId are backed by a real generator (ready/beta).
// Everything else is a structured "planned" entry — no fake geometry is produced.
function entry(
  id: string, name: string, nameFi: string, category: string, subcategory: string,
  inlet: string[], outlet: string[], portCount: string, status: CatalogueStatus,
  parameterSummary: string, thumbnailId: PartTemplateId, generator?: PartTemplateId, tags: string[] = [],
): CatalogueEntry {
  return { id, name, nameFi, description: `${name} (${nameFi})`, category, subcategory, tags: [category.toLowerCase(), subcategory.toLowerCase(), ...tags], inletProfiles: inlet, outletProfiles: outlet, portCount, status, parameterSummary, geometryGeneratorId: generator, thumbnailId };
}
const R = ['rectangular']; const O = ['round']; const FO = ['flat-oval']; const ANY = ['rectangular', 'round'];

export const PART_CATALOGUE: CatalogueEntry[] = [
  // BASIC BODIES
  entry('rect-straight', 'Rectangular straight', 'Suorakaidekanava', 'Basic bodies', 'Straight', R, R, '2', 'beta', 'W×H, length', 'rectangular-transition', 'rectangular-transition'),
  entry('round-straight', 'Round straight', 'Kierresaumakanava', 'Basic bodies', 'Straight', O, O, '2', 'planned', 'Ø, length', 'rectangular-to-round'),
  entry('flat-oval-straight', 'Flat-oval straight', 'Litteä ovaali', 'Basic bodies', 'Straight', FO, FO, '2', 'planned', 'W×H, length', 'rectangular-transition'),
  entry('plenum', 'Plenum', 'Jakolaatikko', 'Basic bodies', 'Boxes', ANY, ANY, '1 + N', 'ready', 'Body W×H×D, inlet, N outlets', 'plenum-box', 'plenum-box'),
  entry('tapered-plenum', 'Tapered plenum', 'Kartiolaatikko', 'Basic bodies', 'Boxes', ANY, ANY, '1 + N', 'planned', 'Tapered body, N outlets', 'plenum-box'),
  entry('equipment-box', 'Equipment box', 'Laitekotelo', 'Basic bodies', 'Boxes', ANY, ANY, '1 + N', 'planned', 'Body, equipment ports', 'plenum-box'),
  entry('grille-box', 'Grille box', 'Säleikkölaatikko', 'Basic bodies', 'Boxes', ANY, ANY, '1 + 1', 'planned', 'Body, grille face', 'plenum-box'),
  entry('multi-outlet-manifold', 'Multi-outlet manifold', 'Jakotukki', 'Basic bodies', 'Boxes', ANY, ANY, '1 + N', 'planned', 'Manifold body, N outlets', 'plenum-box'),
  // TRANSITIONS
  entry('rect-centred-transition', 'Rectangular centred transition', 'Keskitetty muunto', 'Transitions', 'Rectangular', R, R, '2', 'ready', 'W×H both ends, length', 'rectangular-transition', 'rectangular-transition'),
  entry('rect-one-side-flat', 'Rectangular one-side-flat transition', 'Toispuoleinen muunto', 'Transitions', 'Rectangular', R, R, '2', 'ready', 'W×H, single-side offset', 'rectangular-transition', 'rectangular-transition'),
  entry('rect-double-offset', 'Rectangular double-offset transition', 'Kaksoissiirtymä', 'Transitions', 'Rectangular', R, R, '2', 'ready', 'W×H, X and Y offsets', 'rectangular-transition', 'rectangular-transition'),
  entry('rect-to-round', 'Rectangular to round', 'Suorakaide–pyöreä muunto', 'Transitions', 'Mixed', R, O, '2', 'ready', 'W×H, Ø, length, offsets, angles', 'rectangular-to-round', 'rectangular-to-round'),
  entry('round-to-rect', 'Round to rectangular', 'Pyöreä–suorakaide muunto', 'Transitions', 'Mixed', O, R, '2', 'ready', 'Ø, W×H, length, offsets, angles', 'round-to-rectangular', 'round-to-rectangular'),
  entry('round-concentric-reducer', 'Round concentric reducer', 'Keskeinen supistus', 'Transitions', 'Round', O, O, '2', 'beta', 'Ø1, Ø2, length', 'rectangular-to-round', 'rectangular-to-round'),
  entry('round-eccentric-reducer', 'Round eccentric reducer', 'Epäkeskeinen supistus', 'Transitions', 'Round', O, O, '2', 'beta', 'Ø1, Ø2, length, offset', 'rectangular-to-round', 'rectangular-to-round'),
  entry('rect-to-flat-oval', 'Rectangular to flat-oval', 'Suorakaide–ovaali', 'Transitions', 'Mixed', R, FO, '2', 'planned', 'W×H, oval size, length', 'rectangular-transition'),
  entry('flat-oval-to-round', 'Flat-oval to round', 'Ovaali–pyöreä', 'Transitions', 'Mixed', FO, O, '2', 'planned', 'Oval size, Ø, length', 'rectangular-to-round'),
  entry('twisted-transition', 'Twisted transition', 'Kierretty muunto', 'Transitions', 'Special', R, R, '2', 'planned', 'W×H, twist angle', 'rectangular-transition'),
  entry('multi-stage-transition', 'Multi-stage transition', 'Monivaiheinen muunto', 'Transitions', 'Special', ANY, ANY, '2+', 'planned', 'Several profile stages', 'profile-loft'),
  // BENDS AND OFFSETS
  entry('rect-radius-elbow', 'Rectangular radius elbow', 'Suorakaidekaari', 'Bends and offsets', 'Elbows', R, R, '2', 'beta', 'W×H, angle, radius', 'rectangular-transition', 'rectangular-transition'),
  entry('rect-mitred-elbow', 'Rectangular mitred elbow', 'Jiirikulma', 'Bends and offsets', 'Elbows', R, R, '2', 'beta', 'W×H, angle', 'rectangular-transition', 'rectangular-transition'),
  entry('round-pressed-elbow', 'Round pressed elbow', 'Puristettu kulma', 'Bends and offsets', 'Elbows', O, O, '2', 'beta', 'Ø, angle', 'rectangular-to-round', 'rectangular-to-round'),
  entry('round-segmented-elbow', 'Round segmented elbow', 'Lohkokulma', 'Bends and offsets', 'Elbows', O, O, '2', 'planned', 'Ø, angle, segments', 'rectangular-to-round'),
  entry('reducing-elbow', 'Reducing elbow', 'Supistava kulma', 'Bends and offsets', 'Elbows', ANY, ANY, '2', 'planned', 'Two sizes, angle', 'rectangular-to-round'),
  entry('s-bend', 'S-bend', 'S-mutka', 'Bends and offsets', 'Offsets', ANY, ANY, '2', 'planned', 'Offset, length', 'rectangular-transition'),
  entry('z-offset', 'Z-offset', 'Z-siirtymä', 'Bends and offsets', 'Offsets', R, R, '2', 'ready', 'X/Y offsets, length', 'rectangular-transition', 'rectangular-transition'),
  entry('radius-offset', 'Radius offset', 'Kaarisiirtymä', 'Bends and offsets', 'Offsets', ANY, ANY, '2', 'planned', 'Offset, radius', 'rectangular-transition'),
  entry('three-d-offset', 'Three-dimensional offset', 'Kolmiulotteinen siirtymä', 'Bends and offsets', 'Offsets', R, R, '2', 'ready', 'X and Y offsets, angles', 'rectangular-transition', 'rectangular-transition'),
  entry('drop-cheek-bend', 'Drop-cheek bend', 'Poskikulma', 'Bends and offsets', 'Elbows', R, R, '2', 'planned', 'W×H, angle, cheek drop', 'rectangular-transition'),
  // BRANCHES
  entry('equal-tee', 'Equal tee', 'Tasahaara', 'Branches', 'Tees', ANY, ANY, '3', 'planned', 'Main Ø/W×H, branch size', 'plenum-box'),
  entry('reducing-tee', 'Reducing tee', 'Supistava haara', 'Branches', 'Tees', ANY, ANY, '3', 'planned', 'Main, branch sizes', 'plenum-box'),
  entry('y-piece', 'Y-piece', 'Y-haara', 'Branches', 'Y', ANY, ANY, '3', 'planned', 'Sizes, split angle', 'plenum-box'),
  entry('lateral-branch', 'Lateral branch', 'Vinohaara', 'Branches', 'Lateral', ANY, ANY, '3', 'planned', 'Sizes, branch angle', 'plenum-box'),
  entry('trousers-splitter', 'Trousers / splitter', 'Housuhaara', 'Branches', 'Splitters', ANY, ANY, '3', 'planned', 'Two outlets, split angle', 'plenum-box'),
  entry('x-piece', 'X-piece', 'Ristihaara', 'Branches', 'Crosses', ANY, ANY, '4', 'planned', 'Main, two branches', 'plenum-box'),
  entry('straight-with-branch', 'Straight with branch', 'Suora haaralla', 'Branches', 'Taps', ANY, ANY, '3', 'planned', 'Main length, branch position', 'plenum-box'),
  entry('bend-with-branch', 'Bend with branch', 'Kulma haaralla', 'Branches', 'Taps', ANY, ANY, '3', 'planned', 'Angle, branch position', 'plenum-box'),
  entry('angled-round-branch', 'Angled round branch', 'Vino pyöreä haara', 'Branches', 'Taps', O, O, '2', 'ready', 'Ø, branch angle, offsets', 'rectangular-to-round', 'rectangular-to-round'),
  entry('angled-rect-branch', 'Angled rectangular branch', 'Vino suorakaidehaara', 'Branches', 'Taps', R, R, '2', 'ready', 'W×H, branch angle, offsets', 'rectangular-transition', 'rectangular-transition'),
  entry('side-branch', 'Side branch', 'Sivuhaara', 'Branches', 'Taps', ANY, ANY, '1 + N', 'ready', 'Host face, position, size', 'plenum-box', 'plenum-box'),
  entry('top-branch', 'Top branch', 'Ylähaara', 'Branches', 'Taps', ANY, ANY, '1 + N', 'ready', 'Host face, position, size', 'plenum-box', 'plenum-box'),
  entry('bottom-branch', 'Bottom branch', 'Alahaara', 'Branches', 'Taps', ANY, ANY, '1 + N', 'ready', 'Host face, position, size', 'plenum-box', 'plenum-box'),
  entry('corner-branch', 'Corner branch', 'Kulmahaara', 'Branches', 'Taps', ANY, ANY, '1 + N', 'planned', 'Corner position, size', 'plenum-box'),
  entry('multi-branch-manifold', 'Multi-branch manifold', 'Monihaarainen jakotukki', 'Branches', 'Manifolds', ANY, ANY, '1 + N', 'ready', 'Body, N branch ports', 'plenum-box', 'plenum-box'),
  // SADDLES AND TAKEOFFS
  entry('round-saddle', 'Round saddle', 'Satulahaara', 'Saddles and takeoffs', 'Saddles', O, O, '1 + N', 'ready', 'Host face, Ø, position', 'plenum-box', 'plenum-box'),
  entry('rect-saddle', 'Rectangular saddle', 'Suorakaidesatula', 'Saddles and takeoffs', 'Saddles', R, R, '1 + N', 'ready', 'Host face, W×H, position', 'plenum-box', 'plenum-box'),
  entry('collar-saddle', 'Collar saddle', 'Kaulussatula', 'Saddles and takeoffs', 'Saddles', O, O, '1 + N', 'beta', 'Ø, collar length', 'plenum-box', 'plenum-box'),
  entry('shoe-tap', 'Shoe tap', 'Kenkähaara', 'Saddles and takeoffs', 'Takeoffs', ANY, ANY, '1 + N', 'planned', 'Shoe profile, position', 'plenum-box'),
  entry('conical-takeoff', 'Conical takeoff', 'Kartiohaara', 'Saddles and takeoffs', 'Takeoffs', O, O, '1 + N', 'planned', 'Ø, cone length', 'plenum-box'),
  entry('angled-takeoff', 'Angled takeoff', 'Vinohaara', 'Saddles and takeoffs', 'Takeoffs', ANY, ANY, '1 + N', 'beta', 'Angle, position, size', 'plenum-box', 'plenum-box'),
  entry('corner-takeoff', 'Corner takeoff', 'Kulmahaara', 'Saddles and takeoffs', 'Takeoffs', ANY, ANY, '1 + N', 'planned', 'Corner, size', 'plenum-box'),
  entry('edge-takeoff', 'Edge takeoff', 'Reunahaara', 'Saddles and takeoffs', 'Takeoffs', ANY, ANY, '1 + N', 'planned', 'Edge, size', 'plenum-box'),
  // CONNECTIONS AND ENDS
  entry('male-connector', 'Male connector', 'Urosliitin', 'Connections and ends', 'Connectors', ANY, ANY, '2', 'beta', 'Size, connector length', 'rectangular-transition', 'rectangular-transition'),
  entry('female-connector', 'Female connector', 'Naarasliitin', 'Connections and ends', 'Connectors', ANY, ANY, '2', 'beta', 'Size, connector length', 'rectangular-transition', 'rectangular-transition'),
  entry('inner-coupling', 'Inner coupling', 'Sisäliitin', 'Connections and ends', 'Connectors', O, O, '2', 'beta', 'Ø, length', 'rectangular-to-round', 'rectangular-to-round'),
  entry('outer-coupling', 'Outer coupling', 'Ulkoliitin', 'Connections and ends', 'Connectors', O, O, '2', 'beta', 'Ø, length', 'rectangular-to-round', 'rectangular-to-round'),
  entry('flange', 'Flange', 'Laippa', 'Connections and ends', 'Flanges', ANY, ANY, '1', 'planned', 'Size, flange type', 'rectangular-transition'),
  entry('collar', 'Collar', 'Kaulus', 'Connections and ends', 'Connectors', O, O, '1', 'planned', 'Ø, collar length', 'rectangular-to-round'),
  entry('spigot', 'Spigot', 'Yhde', 'Connections and ends', 'Connectors', O, O, '1', 'planned', 'Ø, projection', 'rectangular-to-round'),
  entry('end-cap', 'End cap', 'Päätytulppa', 'Connections and ends', 'Ends', ANY, ANY, '1', 'ready', 'Size (zero-length body)', 'rectangular-transition', 'rectangular-transition'),
  entry('end-cover', 'End cover', 'Päätykansi', 'Connections and ends', 'Ends', ANY, ANY, '1', 'beta', 'Size, cover depth', 'rectangular-transition', 'rectangular-transition'),
  entry('flexible-connector', 'Flexible connector', 'Joustoliitin', 'Connections and ends', 'Connectors', ANY, ANY, '2', 'planned', 'Size, free length', 'rectangular-transition'),
  entry('equipment-flange', 'Equipment flange', 'Laitelaippa', 'Connections and ends', 'Flanges', ANY, ANY, '1', 'planned', 'Size, bolt pattern', 'plenum-box'),
  entry('telescopic-section', 'Telescopic section', 'Teleskooppiosa', 'Connections and ends', 'Connectors', ANY, ANY, '2', 'planned', 'Size, min/max length', 'rectangular-transition'),
  // EQUIPMENT AND SERVICE PARTS
  entry('damper-housing', 'Damper housing', 'Peltikotelo', 'Equipment and service', 'Dampers', ANY, ANY, '2', 'beta', 'Size, housing length', 'rectangular-transition', 'rectangular-transition'),
  entry('fire-damper-sleeve', 'Fire-damper sleeve', 'Palopeltiholkki', 'Equipment and service', 'Dampers', ANY, ANY, '2', 'planned', 'Size, sleeve length, fire class', 'rectangular-transition'),
  entry('iris-pra-housing', 'IRIS / PRA housing', 'IRIS/PRA-kotelo', 'Equipment and service', 'Dampers', O, O, '2', 'planned', 'Ø, housing length', 'rectangular-to-round'),
  entry('filter-box', 'Filter box', 'Suodatinkotelo', 'Equipment and service', 'Boxes', ANY, ANY, '2', 'beta', 'Body, filter size', 'plenum-box', 'plenum-box'),
  entry('heater-box', 'Heater box', 'Lämmityspatterikotelo', 'Equipment and service', 'Boxes', ANY, ANY, '2', 'planned', 'Body, coil size', 'plenum-box'),
  entry('coil-casing', 'Coil casing', 'Patterikotelo', 'Equipment and service', 'Boxes', ANY, ANY, '2', 'planned', 'Body, coil size', 'plenum-box'),
  entry('fan-adapter', 'Fan adapter', 'Puhallinsovite', 'Equipment and service', 'Adapters', ANY, ANY, '2', 'beta', 'Duct size, fan flange', 'rectangular-to-round', 'rectangular-to-round'),
  entry('ahu-adapter', 'AHU adapter', 'IV-koneen sovite', 'Equipment and service', 'Adapters', ANY, ANY, '2', 'beta', 'Duct size, unit flange', 'rectangular-transition', 'rectangular-transition'),
  entry('silencer-casing', 'Silencer casing', 'Äänenvaimenninkotelo', 'Equipment and service', 'Silencers', ANY, ANY, '2', 'planned', 'Size, length', 'rectangular-transition'),
  entry('splitter-silencer', 'Splitter silencer', 'Levyvaimennin', 'Equipment and service', 'Silencers', R, R, '2', 'planned', 'Size, splitter count', 'plenum-box'),
  entry('cleaning-hatch-section', 'Cleaning hatch section', 'Puhdistusluukkuosa', 'Equipment and service', 'Access', ANY, ANY, '2 + 1', 'ready', 'Size, hatch position', 'plenum-box', 'plenum-box'),
  entry('access-door-section', 'Access-door section', 'Huoltoluukkuosa', 'Equipment and service', 'Access', ANY, ANY, '2 + 1', 'beta', 'Size, door position', 'plenum-box', 'plenum-box'),
  entry('measurement-station', 'Measurement station', 'Mittausosa', 'Equipment and service', 'Measurement', ANY, ANY, '2 + N', 'planned', 'Size, tapping positions', 'rectangular-transition'),
  entry('terminal-box', 'Terminal box', 'Päätelaatikko', 'Equipment and service', 'Boxes', ANY, ANY, '1 + N', 'ready', 'Body, inlet, N outlets', 'plenum-box', 'plenum-box'),
  // SPECIAL PARTS
  entry('extraction-hood', 'Extraction hood', 'Huuva', 'Special parts', 'Hoods', ANY, ANY, '1 + N', 'planned', 'Hood size, collar', 'plenum-box'),
  entry('exhaust-hood', 'Exhaust hood', 'Poistohuuva', 'Special parts', 'Hoods', ANY, ANY, '1 + N', 'planned', 'Hood size, collar', 'plenum-box'),
  entry('rain-hood', 'Rain hood', 'Sadehattu', 'Special parts', 'Hoods', ANY, ANY, '1', 'planned', 'Size, overhang', 'plenum-box'),
  entry('machine-adapter', 'Machine adapter', 'Konesovite', 'Special parts', 'Adapters', ANY, ANY, '2', 'beta', 'Duct size, machine flange', 'rectangular-transition', 'rectangular-transition'),
  entry('kitchen-hood-transition', 'Kitchen hood transition', 'Keittiöhuuvan muunto', 'Special parts', 'Adapters', R, ANY, '2', 'beta', 'Hood size, duct size', 'rectangular-to-round', 'rectangular-to-round'),
  entry('waste-extraction-branch', 'Waste extraction branch', 'Jätteenpoistohaara', 'Special parts', 'Branches', O, O, '1 + N', 'planned', 'Ø, branch positions', 'plenum-box'),
  entry('nozzle-manifold', 'Nozzle manifold', 'Suutinjakotukki', 'Special parts', 'Manifolds', ANY, O, '1 + N', 'planned', 'Body, nozzle count', 'plenum-box'),
  entry('custom-multi-port-box', 'Custom multi-port box', 'Mukautettu monipistelaatikko', 'Special parts', 'Boxes', ANY, ANY, '1 + N', 'ready', 'Body, arbitrary ports', 'plenum-box', 'plenum-box'),
  // ASSEMBLY-ONLY
  entry('custom-assembly-entry', 'Custom assembly', 'Mukautettu kokoonpano', 'Assemblies', 'Multi-segment', ANY, ANY, 'N', 'assembly-only', 'Level 2 — segment graph', 'custom-assembly'),
  entry('profile-loft-entry', 'Build from profiles', 'Profiililoftaus', 'Assemblies', 'Loft', ANY, ANY, 'N', 'assembly-only', 'Level 3 — multi-section loft', 'profile-loft'),
];

export const CATALOGUE_CATEGORIES = [...new Set(PART_CATALOGUE.map((e) => e.category))];

/** Addable elements. Only stable ones expose geometry; the rest stay structured. */
export const ADDABLE_ELEMENTS = {
  ports: [
    { id: 'port-round', name: 'Round port', status: 'ready' as CatalogueStatus },
    { id: 'port-rectangular', name: 'Rectangular port', status: 'ready' as CatalogueStatus },
    { id: 'port-flat-oval', name: 'Flat-oval port', status: 'planned' as CatalogueStatus },
    { id: 'port-custom', name: 'Custom profile port', status: 'planned' as CatalogueStatus },
  ],
  attachments: ['saddle', 'branch', 'collar', 'flange', 'spigot', 'access panel', 'cleaning hatch', 'sensor port', 'measurement port', 'drain connection']
    .map((name) => ({ id: `attach-${name.replace(/\s+/g, '-')}`, name, status: (name === 'saddle' || name === 'branch' ? 'beta' : 'planned') as CatalogueStatus })),
  internals: ['splitter', 'baffle', 'turning vane', 'damper blade', 'perforated plate', 'filter rack', 'silencer splitter', 'internal divider']
    .map((name) => ({ id: `internal-${name.replace(/\s+/g, '-')}`, name, status: 'planned' as CatalogueStatus })),
  detailMetadata: ['material', 'thickness', 'insulation', 'connector type', 'flange type', 'seam position', 'reinforcement', 'notes'],
};

export function catalogueOpenable(entry: CatalogueEntry): boolean {
  return (entry.status === 'ready' || entry.status === 'beta') && Boolean(entry.geometryGeneratorId);
}

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
