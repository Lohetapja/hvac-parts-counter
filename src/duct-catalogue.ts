import type { PartDefinition } from './duct-network-types';

// A generic, local part catalogue. It intentionally contains only generic category
// and parameter definitions — no scraped product descriptions, images, prices, or
// protected catalogue data, and no runtime dependency on any supplier.

export const BUILTIN_CATALOGUE: PartDefinition[] = [
  { id: 'round-duct', category: 'Duct', shape: 'round', names: { fi: 'Kierresaumakanava', en: 'Spiral / round duct' }, requiredFields: ['diameterMm', 'lengthMm'], optionalFields: ['material', 'thicknessMm'], aliases: ['spiral duct', 'round duct', 'kierrekanava'], builtin: true },
  { id: 'round-bend-15', category: 'Bend', shape: 'round', names: { fi: 'Kulma 15°', en: 'Bend 15°' }, requiredFields: ['diameterMm', 'angleDeg'], optionalFields: ['radius'], aliases: ['15 bend', 'kulma 15'], builtin: true },
  { id: 'round-bend-30', category: 'Bend', shape: 'round', names: { fi: 'Kulma 30°', en: 'Bend 30°' }, requiredFields: ['diameterMm', 'angleDeg'], optionalFields: ['radius'], aliases: ['30 bend', 'kulma 30'], builtin: true },
  { id: 'round-bend-45', category: 'Bend', shape: 'round', names: { fi: 'Kulma 45°', en: 'Bend 45°' }, requiredFields: ['diameterMm', 'angleDeg'], optionalFields: ['radius'], aliases: ['45 bend', 'kulma 45'], builtin: true },
  { id: 'round-bend-60', category: 'Bend', shape: 'round', names: { fi: 'Kulma 60°', en: 'Bend 60°' }, requiredFields: ['diameterMm', 'angleDeg'], optionalFields: ['radius'], aliases: ['60 bend', 'kulma 60'], builtin: true },
  { id: 'round-bend-90', category: 'Bend', shape: 'round', names: { fi: 'Kulma 90°', en: 'Bend 90°' }, requiredFields: ['diameterMm', 'angleDeg'], optionalFields: ['radius'], aliases: ['90 bend', 'kulma 90'], builtin: true },
  { id: 'round-tee', category: 'Branch', shape: 'round', names: { fi: 'T-haara', en: 'T-piece' }, requiredFields: ['diameterMm', 'branchDiameterMm'], optionalFields: [], aliases: ['tee', 't-piece', 't-kappale'], builtin: true },
  { id: 'round-y-branch', category: 'Branch', shape: 'round', names: { fi: 'Y-haara', en: 'Y-branch' }, requiredFields: ['diameterMm', 'branchDiameterMm'], optionalFields: [], aliases: ['y branch', 'y-haara'], builtin: true },
  { id: 'round-saddle', category: 'Branch', shape: 'round', names: { fi: 'Satulahaara / sivuliitos', en: 'Side connector / saddle' }, requiredFields: ['diameterMm', 'branchDiameterMm'], optionalFields: [], aliases: ['saddle', 'side connection', 'satula'], builtin: true },
  { id: 'round-reducer', category: 'Transition', shape: 'round', names: { fi: 'Supistus', en: 'Reducer' }, requiredFields: ['fromDiameterMm', 'toDiameterMm'], optionalFields: [], aliases: ['reducer', 'supistus'], builtin: true },
  { id: 'round-inner-connector', category: 'Connector', shape: 'round', names: { fi: 'Sisäliitin', en: 'Inner connector' }, requiredFields: ['diameterMm'], optionalFields: [], aliases: ['nippa', 'inner connector'], builtin: true },
  { id: 'round-outer-connector', category: 'Connector', shape: 'round', names: { fi: 'Ulkoliitin / muhvi', en: 'Outer connector' }, requiredFields: ['diameterMm'], optionalFields: [], aliases: ['muhvi', 'outer connector'], builtin: true },
  { id: 'round-end-cap', category: 'Termination', shape: 'round', names: { fi: 'Päätytulppa', en: 'End cap' }, requiredFields: ['diameterMm'], optionalFields: [], aliases: ['end cap', 'tulppa'], builtin: true },
  { id: 'round-damper', category: 'Damper', shape: 'round', names: { fi: 'Säätöpelti', en: 'Damper' }, requiredFields: ['diameterMm'], optionalFields: [], aliases: ['damper', 'pelti'], builtin: true },
  { id: 'round-fire-damper', category: 'Damper', shape: 'round', names: { fi: 'Palopelti', en: 'Fire damper' }, requiredFields: ['diameterMm'], optionalFields: ['fireClass'], aliases: ['fire damper', 'palopelti'], builtin: true },
  { id: 'round-silencer', category: 'Silencer', shape: 'round', names: { fi: 'Äänenvaimennin', en: 'Silencer' }, requiredFields: ['diameterMm', 'lengthMm'], optionalFields: [], aliases: ['silencer', 'vaimennin'], builtin: true },
  { id: 'round-cleaning-hatch', category: 'Access', shape: 'round', names: { fi: 'Puhdistusluukku', en: 'Cleaning hatch' }, requiredFields: ['diameterMm'], optionalFields: [], aliases: ['cleaning hatch', 'puhdistusluukku'], builtin: true },
  { id: 'supply-terminal', category: 'Terminal', shape: 'round', names: { fi: 'Tuloilmalaite', en: 'Supply terminal' }, requiredFields: ['diameterMm'], optionalFields: ['model'], aliases: ['supply terminal', 'tuloilmalaite'], builtin: true },
  { id: 'extract-terminal', category: 'Terminal', shape: 'round', names: { fi: 'Poistoilmalaite', en: 'Extract terminal' }, requiredFields: ['diameterMm'], optionalFields: ['model'], aliases: ['extract terminal', 'poistoilmalaite'], builtin: true },
  { id: 'rect-duct', category: 'Duct', shape: 'rectangular', names: { fi: 'Suorakaidekanava', en: 'Rectangular duct' }, requiredFields: ['widthMm', 'heightMm', 'lengthMm'], optionalFields: ['material', 'thicknessMm'], aliases: ['rectangular duct', 'suorakaidekanava'], builtin: true },
  { id: 'rect-bend', category: 'Bend', shape: 'rectangular', names: { fi: 'Suorakaidekulma', en: 'Rectangular bend' }, requiredFields: ['widthMm', 'heightMm', 'angleDeg'], optionalFields: [], aliases: ['rectangular bend', 'suorakaidekulma'], builtin: true },
  { id: 'rect-transition', category: 'Transition', shape: 'rectangular', names: { fi: 'Muunto', en: 'Rectangular transition' }, requiredFields: ['fromWidthMm', 'fromHeightMm', 'toWidthMm', 'toHeightMm'], optionalFields: ['offset'], aliases: ['muunto', 'transition', 'reducer'], builtin: true },
  { id: 'rect-branch', category: 'Branch', shape: 'rectangular', names: { fi: 'Suorakaidehaara', en: 'Rectangular branch' }, requiredFields: ['widthMm', 'heightMm'], optionalFields: [], aliases: ['rectangular branch', 'haara'], builtin: true },
  { id: 'rect-saddle', category: 'Branch', shape: 'rectangular', names: { fi: 'Suorakaidesatula', en: 'Rectangular saddle' }, requiredFields: ['widthMm', 'heightMm'], optionalFields: [], aliases: ['rectangular saddle'], builtin: true },
  { id: 'rect-end-cap', category: 'Termination', shape: 'rectangular', names: { fi: 'Suorakaidepääty', en: 'Rectangular end cap' }, requiredFields: ['widthMm', 'heightMm'], optionalFields: [], aliases: ['rectangular end cap'], builtin: true },
  { id: 'rect-connector', category: 'Connector', shape: 'rectangular', names: { fi: 'Laippa / liitin', en: 'Flange / connector' }, requiredFields: ['widthMm', 'heightMm'], optionalFields: [], aliases: ['flange', 'connector', 'laippa'], builtin: true },
  { id: 'rect-damper', category: 'Damper', shape: 'rectangular', names: { fi: 'Suorakaidepelti', en: 'Rectangular damper' }, requiredFields: ['widthMm', 'heightMm'], optionalFields: [], aliases: ['rectangular damper'], builtin: true },
  { id: 'rect-fire-damper', category: 'Damper', shape: 'rectangular', names: { fi: 'Suorakaide palopelti', en: 'Rectangular fire damper' }, requiredFields: ['widthMm', 'heightMm'], optionalFields: ['fireClass'], aliases: ['rectangular fire damper'], builtin: true },
  { id: 'rect-silencer', category: 'Silencer', shape: 'rectangular', names: { fi: 'Suorakaide vaimennin', en: 'Rectangular silencer' }, requiredFields: ['widthMm', 'heightMm', 'lengthMm'], optionalFields: [], aliases: ['rectangular silencer'], builtin: true },
  { id: 'rect-cleaning-hatch', category: 'Access', shape: 'rectangular', names: { fi: 'Suorakaide puhdistusluukku', en: 'Rectangular cleaning hatch' }, requiredFields: ['widthMm', 'heightMm'], optionalFields: [], aliases: ['rectangular cleaning hatch'], builtin: true },
  { id: 'vertical-continuation', category: 'Continuation', shape: 'both', names: { fi: 'Pystynousu / YLÖS-ALAS', en: 'Vertical continuation' }, requiredFields: [], optionalFields: ['verticalLengthMm', 'floorDestination'], aliases: ['ylös', 'alas', 'riser', 'drop'], builtin: true },
  { id: 'custom-fitting', category: 'Custom', shape: 'both', names: { fi: 'Erikoisosa', en: 'Custom fabricated fitting' }, requiredFields: [], optionalFields: [], aliases: ['custom', 'erikoisosa'], builtin: true },
];

const BUILTIN_MAP = new Map(BUILTIN_CATALOGUE.map((item) => [item.id, item]));

export function mergedCatalogue(custom: PartDefinition[], disabledIds: string[]): PartDefinition[] {
  const disabled = new Set(disabledIds);
  const byId = new Map<string, PartDefinition>();
  BUILTIN_CATALOGUE.forEach((item) => byId.set(item.id, { ...item, disabled: disabled.has(item.id) }));
  custom.forEach((item) => byId.set(item.id, { ...item, disabled: disabled.has(item.id) || item.disabled }));
  return [...byId.values()];
}

export function catalogueEntry(id: string, custom: PartDefinition[]): PartDefinition | undefined {
  return custom.find((item) => item.id === id) ?? BUILTIN_MAP.get(id);
}

export function catalogueName(id: string, custom: PartDefinition[]): string {
  const entry = catalogueEntry(id, custom);
  return entry ? `${entry.names.fi} / ${entry.names.en}` : id;
}

// Round-bend catalogue id for an approximate angle, snapped to the seeded angles.
export function bendCatalogueId(shape: 'round' | 'rectangular', angleDeg: number): string {
  if (shape === 'rectangular') return 'rect-bend';
  const snapped = [15, 30, 45, 60, 90].reduce((best, value) => Math.abs(value - angleDeg) < Math.abs(best - angleDeg) ? value : best, 90);
  return `round-bend-${snapped}`;
}

export function newCustomDefinitionId(): string {
  return `custom-def-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
