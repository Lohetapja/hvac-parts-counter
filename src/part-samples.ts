import type { CustomPart, PlenumPort } from './types';
import type { PromotionalTemplateId } from './promotional-templates';

// Curated real-world sample library.
//
// Each sample is a fitting an installer could actually order or fabricate, expressed
// as parameter overrides on a working geometry family. Nothing here is invented to
// look visually different: every entry has a stated practical use and plausible
// millimetre dimensions. Samples whose geometry family does not genuinely exist are
// deliberately absent (see REJECTED_SAMPLES).

export interface PartSample {
  id: string;
  templateId: PromotionalTemplateId;
  name: string;
  /** What an installer would use this for. */
  use: string;
  /** Short dimension summary shown on the card. */
  summary: string;
  tags: string[];
  recommended?: boolean;
  defaults: Partial<CustomPart>;
}

const MATERIAL = { material: 'Galvanized steel', thicknessMm: 0.7, quantity: 1, system: 'Supply air' };

const port = (value: Partial<PlenumPort> & Pick<PlenumPort, 'id' | 'name' | 'face' | 'shape'>): PlenumPort => ({
  widthMm: 200, heightMm: 160, diameterMm: 160, offsetHorizontalMm: 0, offsetVerticalMm: 0,
  projectionMm: 100, rotationDeg: 0, role: 'outlet', notes: '', ...value,
});

// Host-duct main opening used by the branch/saddle family (the duct's own open end).
const mainOutlet = (widthMm: number, heightMm: number): PlenumPort =>
  port({ id: 'P2', name: 'Main outlet P2', face: 'front', shape: 'rectangular', widthMm, heightMm, projectionMm: 60, role: 'outlet' });

export const PART_SAMPLES: PartSample[] = [
  // --- Straight duct (equal-ended loft) -----------------------------------
  {
    id: 'rect-straight-500x200-1000', templateId: 'rectangular-transition',
    name: '500 × 200 rectangular duct, 1000 mm',
    use: 'Plain straight run between two fittings.',
    summary: '500×200, L1000, both ends equal', tags: ['straight', 'duct', 'suora', 'kanava'],
    defaults: {
      ...MATERIAL, name: '500 × 200 rectangular duct 1000 mm',
      endAWidthMm: 500, endAHeightMm: 200, endBWidthMm: 500, endBHeightMm: 200,
      lengthMm: 1000, horizontalOffsetMm: 0, verticalOffsetMm: 0,
      outletHorizontalAngleDeg: 0, outletVerticalAngleDeg: 0, outletRotationDeg: 0,
    },
  },
  // --- Rectangular transition / muunto ------------------------------------
  {
    id: 'rect-transition-centred', templateId: 'rectangular-transition', recommended: true,
    name: '500 × 300 → 300 × 200 centred muunto',
    use: 'Standard size change with both ends on the same centreline.',
    summary: '500×300 → 300×200, L500, centred', tags: ['muunto', 'transition', 'reducer', 'supistus'],
    defaults: {
      ...MATERIAL, name: '500 × 300 → 300 × 200 centred muunto',
      endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 300, endBHeightMm: 200,
      lengthMm: 500, horizontalOffsetMm: 0, verticalOffsetMm: 0,
      outletHorizontalAngleDeg: 0, outletVerticalAngleDeg: 0, outletRotationDeg: 0,
    },
  },
  {
    id: 'rect-transition-bottom-fixed', templateId: 'rectangular-transition',
    name: '500 × 300 → 300 × 200, bottom fixed',
    use: 'Size change where the duct must stay level with the floor or ceiling grid.',
    summary: '500×300 → 300×200, L500, bottom flush', tags: ['muunto', 'transition', 'bottom flat', 'toispuoleinen'],
    defaults: {
      ...MATERIAL, name: '500 × 300 → 300 × 200 bottom-fixed muunto',
      endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 300, endBHeightMm: 200,
      // Bottom faces align: outlet drops by half the height difference.
      lengthMm: 500, horizontalOffsetMm: 0, verticalOffsetMm: -50,
    },
  },
  {
    id: 'rect-heitto-double', templateId: 'rectangular-transition',
    name: '500 × 300 double-offset heitto',
    use: 'Moves a run sideways and up without changing duct size — routing around an obstacle.',
    summary: '500×300 both ends, L800, 200 across / 250 up', tags: ['heitto', 'offset', 'siirtymä', 'jog'],
    defaults: {
      ...MATERIAL, name: '500 × 300 double-offset heitto',
      endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 500, endBHeightMm: 300,
      lengthMm: 800, horizontalOffsetMm: 200, verticalOffsetMm: 250,
    },
  },
  // --- Rectangular to round ------------------------------------------------
  {
    id: 'rect-to-round-eccentric', templateId: 'rectangular-to-round', recommended: true,
    name: '500 × 300 → Ø250 eccentric adapter',
    use: 'Connects a rectangular duct to a round spiral duct while keeping one side flush.',
    summary: '500×300 → Ø250, L500, 100 across', tags: ['muunto', 'transition', 'round', 'pyöreä', 'adapter'],
    defaults: {
      ...MATERIAL, name: '500 × 300 → Ø250 eccentric adapter',
      endAWidthMm: 500, endAHeightMm: 300, endBDiameterMm: 250,
      lengthMm: 500, horizontalOffsetMm: 100, verticalOffsetMm: -25,
      outletHorizontalAngleDeg: 0, outletVerticalAngleDeg: 0, outletRotationDeg: 0,
    },
  },
  {
    id: 'equipment-adapter-angled', templateId: 'rectangular-to-round',
    name: '500 × 300 equipment connection with angled Ø250 outlet',
    use: 'Joins an air-handling unit spigot where the duct leaves at an angle.',
    summary: '500×300 → Ø250, L600, outlet angled 18°', tags: ['equipment', 'laite', 'adapter', 'angled'],
    defaults: {
      ...MATERIAL, name: '500 × 300 equipment connection, angled Ø250 outlet', system: 'Extract air',
      endAWidthMm: 500, endAHeightMm: 300, endBDiameterMm: 250,
      lengthMm: 600, horizontalOffsetMm: 120, verticalOffsetMm: 0,
      outletHorizontalAngleDeg: 18, outletVerticalAngleDeg: 0, outletRotationDeg: 0,
    },
  },
  // --- Round reducer -------------------------------------------------------
  {
    id: 'round-reducer-eccentric', templateId: 'round-reducer', recommended: true,
    name: 'Ø315 → Ø200 eccentric reducer',
    use: 'Spiral-duct size change kept flush on one side so it can run against a soffit.',
    summary: 'Ø315 → Ø200, L450, offset one side', tags: ['supistus', 'reducer', 'round', 'pyöreä', 'eccentric'],
    defaults: {
      ...MATERIAL, name: 'Ø315 → Ø200 eccentric reducer',
      endADiameterMm: 315, endBDiameterMm: 200, lengthMm: 450,
      horizontalOffsetMm: 0, verticalOffsetMm: -57.5,
    },
  },
  {
    id: 'round-reducer-concentric', templateId: 'round-reducer',
    name: 'Ø250 → Ø160 concentric reducer',
    use: 'Standard in-line spiral reduction on a branch run.',
    summary: 'Ø250 → Ø160, L300, centred', tags: ['supistus', 'reducer', 'concentric'],
    defaults: {
      ...MATERIAL, name: 'Ø250 → Ø160 concentric reducer',
      endADiameterMm: 250, endBDiameterMm: 160, lengthMm: 300, horizontalOffsetMm: 0, verticalOffsetMm: 0,
    },
  },
  // --- Bends ---------------------------------------------------------------
  {
    id: 'rect-elbow-90', templateId: 'rectangular-elbow', recommended: true,
    name: '500 × 300 rectangular 90° bend',
    use: 'Turns a rectangular run through a right angle at a wall or shaft.',
    summary: '500×300, 90°, R450, 140 mm tails', tags: ['käyrä', 'elbow', 'bend', 'kulma'],
    defaults: {
      ...MATERIAL, name: '500 × 300 rectangular 90° bend',
      endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 500, endBHeightMm: 300,
      bendAngleDeg: 90, bendRadiusMm: 450, inletExtensionMm: 140, outletExtensionMm: 140, segmentCount: 14,
    },
  },
  {
    id: 'rect-elbow-45', templateId: 'rectangular-elbow',
    name: '400 × 250 rectangular 45° bend',
    use: 'Shallow direction change where a 90° turn will not fit.',
    summary: '400×250, 45°, R380', tags: ['käyrä', 'elbow', '45'],
    defaults: {
      ...MATERIAL, name: '400 × 250 rectangular 45° bend',
      endAWidthMm: 400, endAHeightMm: 250, endBWidthMm: 400, endBHeightMm: 250,
      bendAngleDeg: 45, bendRadiusMm: 380, inletExtensionMm: 120, outletExtensionMm: 120, segmentCount: 10,
    },
  },
  {
    id: 'round-elbow-90', templateId: 'round-elbow', recommended: true,
    name: 'Ø200 round 90° bend',
    use: 'Standard spiral-duct right-angle turn on a branch.',
    summary: 'Ø200, 90°, R300, 120 mm tails', tags: ['käyrä', 'elbow', 'bend', 'round', 'pyöreä'],
    defaults: {
      ...MATERIAL, name: 'Ø200 round 90° bend',
      endADiameterMm: 200, endBDiameterMm: 200,
      bendAngleDeg: 90, bendRadiusMm: 300, inletExtensionMm: 120, outletExtensionMm: 120, segmentCount: 14,
    },
  },
  {
    id: 'round-elbow-45', templateId: 'round-elbow',
    name: 'Ø160 round 45° bend',
    use: 'Small branch offset around a beam or luminaire.',
    summary: 'Ø160, 45°, R240', tags: ['käyrä', 'elbow', '45', 'round'],
    defaults: {
      ...MATERIAL, name: 'Ø160 round 45° bend',
      endADiameterMm: 160, endBDiameterMm: 160,
      bendAngleDeg: 45, bendRadiusMm: 240, inletExtensionMm: 100, outletExtensionMm: 100, segmentCount: 10,
    },
  },
  // --- Branches and saddles (one host-branch family) -----------------------
  {
    id: 'round-saddle-top', templateId: 'round-saddle', recommended: true,
    name: 'Ø200 top saddle on 500 × 300 duct',
    use: 'Takes a round branch off the top of a rectangular main to feed a diffuser.',
    summary: 'Host 500×300 × L700, Ø200 collar on top, centred', tags: ['satula', 'saddle', 'lähtö', 'takeoff', 'branch'],
    defaults: {
      ...MATERIAL, name: 'Ø200 top saddle on 500 × 300 duct',
      bodyWidthMm: 500, bodyHeightMm: 300, bodyDepthMm: 700,
      endAWidthMm: 500, endAHeightMm: 300,
      plenumPorts: [
        mainOutlet(500, 300),
        port({ id: 'B1', name: 'Round saddle B1', face: 'top', shape: 'round', diameterMm: 200, offsetHorizontalMm: 0, offsetVerticalMm: 0, projectionMm: 150, role: 'branch' }),
      ],
    },
  },
  {
    id: 'rect-saddle-side', templateId: 'round-saddle',
    name: '300 × 200 side saddle on 600 × 400 duct',
    use: 'Rectangular branch off the side of a main duct serving a second zone.',
    summary: 'Host 600×400 × L800, 300×200 branch on side', tags: ['satula', 'saddle', 'haara', 'branch', 'rectangular'],
    defaults: {
      ...MATERIAL, name: '300 × 200 side saddle on 600 × 400 duct',
      bodyWidthMm: 600, bodyHeightMm: 400, bodyDepthMm: 800,
      endAWidthMm: 600, endAHeightMm: 400,
      plenumPorts: [
        mainOutlet(600, 400),
        port({ id: 'B1', name: 'Rectangular branch B1', face: 'right', shape: 'rectangular', widthMm: 300, heightMm: 200, offsetHorizontalMm: 0, offsetVerticalMm: 0, projectionMm: 160, role: 'branch' }),
      ],
    },
  },
  {
    id: 'rect-tee-branch', templateId: 'round-saddle',
    name: '500 × 300 main with 250 × 200 branch (T-piece)',
    use: 'Splits a rectangular main into a continuing run and a perpendicular branch.',
    summary: 'Host 500×300 × L850, 250×200 branch at 90°', tags: ['haara', 'tee', 't-piece', 'branch'],
    defaults: {
      ...MATERIAL, name: '500 × 300 main with 250 × 200 branch',
      bodyWidthMm: 500, bodyHeightMm: 300, bodyDepthMm: 850,
      endAWidthMm: 500, endAHeightMm: 300,
      plenumPorts: [
        mainOutlet(500, 300),
        port({ id: 'B1', name: 'Branch B1', face: 'right', shape: 'rectangular', widthMm: 250, heightMm: 200, offsetHorizontalMm: 0, offsetVerticalMm: 0, projectionMm: 260, branchAngleDeg: 90, role: 'branch' }),
      ],
    },
  },
  // --- Boxes and plenums ---------------------------------------------------
  {
    id: 'plenum-four-outlet', templateId: 'plenum-four-outlet', recommended: true,
    name: '600 × 400 plenum with four Ø160 outlets',
    use: 'Distribution box feeding four diffusers from one duct connection.',
    summary: 'Body 600×400×320, inlet 400×250, 4 × Ø160 in 2×2', tags: ['laatikko', 'plenum', 'jakolaatikko', 'box', 'distribution'],
    defaults: {
      ...MATERIAL, name: '600 × 400 plenum with four Ø160 outlets',
      bodyWidthMm: 600, bodyHeightMm: 400, bodyDepthMm: 320,
      endAWidthMm: 400, endAHeightMm: 250,
      plenumPorts: [
        port({ id: 'B1', name: 'Outlet B1', face: 'front', shape: 'round', diameterMm: 160, offsetHorizontalMm: -150, offsetVerticalMm: -90, projectionMm: 110 }),
        port({ id: 'B2', name: 'Outlet B2', face: 'front', shape: 'round', diameterMm: 160, offsetHorizontalMm: 150, offsetVerticalMm: -90, projectionMm: 110 }),
        port({ id: 'B3', name: 'Outlet B3', face: 'front', shape: 'round', diameterMm: 160, offsetHorizontalMm: -150, offsetVerticalMm: 90, projectionMm: 110 }),
        port({ id: 'B4', name: 'Outlet B4', face: 'front', shape: 'round', diameterMm: 160, offsetHorizontalMm: 150, offsetVerticalMm: 90, projectionMm: 110 }),
      ],
    },
  },
  {
    id: 'equipment-box', templateId: 'plenum-four-outlet',
    name: '600 × 400 × 350 equipment box',
    use: 'Closed box connecting a rectangular duct to a single round equipment spigot.',
    summary: 'Body 600×400×350, rect inlet 400×250, one Ø200 outlet', tags: ['laatikko', 'box', 'equipment', 'laite'],
    defaults: {
      ...MATERIAL, name: '600 × 400 × 350 equipment box',
      bodyWidthMm: 600, bodyHeightMm: 400, bodyDepthMm: 350,
      endAWidthMm: 400, endAHeightMm: 250,
      plenumPorts: [
        port({ id: 'B1', name: 'Round outlet B1', face: 'front', shape: 'round', diameterMm: 200, offsetHorizontalMm: 0, offsetVerticalMm: 0, projectionMm: 120 }),
      ],
    },
  },
  {
    id: 'terminal-box', templateId: 'plenum-four-outlet',
    name: '400 × 300 terminal box with Ø200 connection',
    use: 'Diffuser box: round duct connection on top, rectangular terminal opening at the front.',
    summary: 'Body 400×300×250, Ø200 top inlet, 300×200 face opening', tags: ['päätelaatikko', 'terminal box', 'diffuser', 'laatikko'],
    defaults: {
      ...MATERIAL, name: '400 × 300 terminal box with Ø200 connection',
      bodyWidthMm: 400, bodyHeightMm: 300, bodyDepthMm: 250,
      endAWidthMm: 300, endAHeightMm: 200,
      plenumPorts: [
        port({ id: 'B1', name: 'Ø200 duct connection B1', face: 'top', shape: 'round', diameterMm: 200, offsetHorizontalMm: 0, offsetVerticalMm: 0, projectionMm: 120, role: 'inlet' }),
        port({ id: 'B2', name: 'Terminal opening B2', face: 'front', shape: 'rectangular', widthMm: 300, heightMm: 200, offsetHorizontalMm: 0, offsetVerticalMm: 0, projectionMm: 40, role: 'outlet' }),
      ],
    },
  },
];

/**
 * Samples deliberately NOT shipped, with the reason. Kept in code so the gap is
 * visible rather than silently filled with something that only looks plausible.
 */
export const REJECTED_SAMPLES: Array<{ name: string; reason: string }> = [
  {
    name: 'Ø250 round main with Ø160 branch (round T-piece)',
    reason: 'The host-branch family models the main duct as a rectangular body, so a round main would be drawn as a box. Needs a round host generator before it can be shipped honestly.',
  },
  {
    name: 'Round saddle on round duct',
    reason: 'Same limitation: no round host body generator yet.',
  },
  {
    name: 'Y-branch / trousers',
    reason: 'No splitting geometry generator; would only be a box with two ports.',
  },
  {
    name: 'Flange / collar / end cap details',
    reason: 'These are connection details, not standalone bodies; they are modelled as connection types on a port instead.',
  },
];

export function samplesForTemplate(templateId: string): PartSample[] {
  return PART_SAMPLES.filter((sample) => sample.templateId === templateId);
}
export function recommendedSample(templateId: string): PartSample | undefined {
  const list = samplesForTemplate(templateId);
  return list.find((sample) => sample.recommended) ?? list[0];
}
export function sampleById(id: string): PartSample | undefined {
  return PART_SAMPLES.find((sample) => sample.id === id);
}

/** Practical search aliases so workers can search in either language. */
export const SEARCH_ALIASES: Record<string, string[]> = {
  muunto: ['transition', 'reducer', 'rectangular transition', 'rectangular to round'],
  transition: ['muunto', 'reducer'],
  reducer: ['muunto', 'supistus', 'transition'],
  supistus: ['reducer', 'transition', 'muunto'],
  heitto: ['offset', 'jog', 'transition'],
  offset: ['heitto', 'transition'],
  bend: ['elbow', 'käyrä', 'kulma'],
  elbow: ['bend', 'käyrä', 'kulma'],
  käyrä: ['bend', 'elbow'],
  kulma: ['bend', 'elbow'],
  satula: ['saddle', 'branch', 'takeoff'],
  saddle: ['satula', 'branch', 'takeoff'],
  haara: ['branch', 'tee', 't-piece', 'saddle'],
  branch: ['haara', 'saddle', 'tee'],
  laatikko: ['box', 'plenum', 'terminal box'],
  box: ['laatikko', 'plenum'],
  plenum: ['laatikko', 'box', 'jakolaatikko'],
  lähtö: ['takeoff', 'collar', 'branch'],
  collar: ['kaulus', 'lähtö', 'saddle'],
  kaulus: ['collar', 'lähtö'],
  suora: ['straight', 'duct'],
  straight: ['suora', 'duct'],
  kanava: ['duct', 'straight'],
  pyöreä: ['round', 'circular'],
  round: ['pyöreä'],
};

/** Expands a query with its aliases so either language matches. */
export function expandQuery(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = new Set<string>([q]);
  Object.entries(SEARCH_ALIASES).forEach(([key, values]) => {
    if (key.includes(q) || q.includes(key)) { terms.add(key); values.forEach((v) => terms.add(v)); }
  });
  return [...terms];
}
