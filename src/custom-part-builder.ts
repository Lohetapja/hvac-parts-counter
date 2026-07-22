import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { profileForEnd, syncCustomPartAssembly } from './custom-part-assembly';
import { downloadCustomPartPdf } from './custom-part-pdf';
import { buildTransitionGeometry, classifyTransition, dimensionLabel, dimensionUnit, solveBodyLengthFromEdge, swapTransitionEnds, validateCustomPart, validateDimensionValue, type DerivedEdgeKind, type EditableDimensionKey, type TransitionGeometry } from './transition-geometry';
import { renderTechnicalView, type GridSize, type TechnicalSelection } from './transition-views';
import { PART_TEMPLATES, templateForPart, templateThumbnail, defaultPlenumPorts, type PartTemplateDefinition, type PartTemplateId } from './part-templates';
import { buildPlenumGeometry, nextPortId, portSizeLabel } from './plenum-geometry';
import { renderPlenumViews } from './plenum-views';
import type { CustomPart, CustomPartType, PersonalTemplate, PlenumFace, PlenumPort, VerificationStatus } from './types';

const SYSTEMS = ['Supply air', 'Extract air', 'Outdoor air', 'Exhaust air', 'Transfer air', 'Other'];
const MATERIALS = ['Galvanized steel', 'Stainless steel', 'Aluminium', 'Painted steel', 'Other'];
const NUMERIC_KEYS = ['endAWidthMm', 'endAHeightMm', 'endADiameterMm', 'endBWidthMm', 'endBHeightMm', 'endBDiameterMm', 'lengthMm', 'horizontalOffsetMm', 'verticalOffsetMm', 'outletHorizontalAngleDeg', 'outletVerticalAngleDeg', 'outletRotationDeg', 'quantity', 'thicknessMm'] as const;
type NumericKey = typeof NUMERIC_KEYS[number];

export interface BuilderController {
  load(part?: CustomPart, existing?: boolean): void;
  setActive(active: boolean): void;
  dispose(): void;
}

interface BuilderOptions {
  onSave(part: CustomPart): void;
  onChange?(part: CustomPart): void;
  notify(message: string): void;
  /** Personal templates are reusable starting points; they never enter the material list. */
  getTemplates?(): PersonalTemplate[];
  saveTemplate?(template: PersonalTemplate): void;
  deleteTemplate?(id: string): void;
}

function timestamp(): string { return new Date().toISOString(); }
function newId(): string { return `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function examplePart(): CustomPart {
  const time = timestamp();
  const part = { id: newId(), name: 'Eccentric rectangular to round transition', partNumber: '', partType: 'rectangular-to-round-transition', endAWidthMm: 500, endAHeightMm: 300, endADiameterMm: 300, endBWidthMm: 300, endBHeightMm: 200, endBDiameterMm: 250, lengthMm: 600, horizontalOffsetMm: 100, verticalOffsetMm: 50, outletHorizontalAngleDeg: 12, outletVerticalAngleDeg: -6, outletRotationDeg: 0, quantity: 1, system: 'Supply air', material: 'Galvanized steel', thicknessMm: 0.7, notes: '', createdAt: time, updatedAt: time, verificationStatus: 'suggested' as VerificationStatus } as CustomPart;
  return syncCustomPartAssembly(part);
}
function rectangularExamplePart(): CustomPart {
  const time = timestamp();
  return syncCustomPartAssembly({ ...examplePart(), id: newId(), name: 'Offset transition 500x300 to 300x200', partType: 'rectangular-transition', endAWidthMm: 500, endAHeightMm: 300, endBWidthMm: 300, endBHeightMm: 200, lengthMm: 600, horizontalOffsetMm: 100, verticalOffsetMm: 50, outletHorizontalAngleDeg: 0, outletVerticalAngleDeg: 0, outletRotationDeg: 0, createdAt: time, updatedAt: time });
}
function blankPart(): CustomPart {
  const part = examplePart();
  return syncCustomPartAssembly({ ...part, id: newId(), name: 'Rectangular centred reducer', partType: 'rectangular-transition', horizontalOffsetMm: 0, verticalOffsetMm: 0, outletHorizontalAngleDeg: 0, outletVerticalAngleDeg: 0, createdAt: timestamp(), updatedAt: timestamp() });
}
function htmlEscape(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character); }

export function initCustomPartBuilder(root: HTMLElement, options: BuilderOptions): BuilderController {
  root.innerHTML = `<section id="builderLibrary" class="tpl-library">
    <div class="tpl-lib-head">
      <div><span class="eyebrow">Custom Part Library</span><h2>Choose a fitting template</h2><p class="help">Pick the closest family, then change its dimensions, offsets, angles and connections.</p></div>
      <label class="field tpl-search"><span class="label">Search</span><input id="tplSearch" class="input" placeholder="Name, profile, connection or tag"></label>
    </div>
    <div id="tplFilters" class="tpl-filters"></div>
    <div id="tplGrid" class="tpl-grid"></div>
  </section>
  <div class="builder-shell" id="builderShell">
    <aside class="builder-controls">
      <div class="builder-heading"><div><span class="eyebrow" id="builderTemplateName">Parametric fitting</span><h2 id="builderTitle">Transition</h2></div><div class="button-row"><button id="builderBackToLibrary" class="btn small">← Library</button></div></div>
      <div class="button-row"><button id="builderLoadRectExample" class="btn small">Rect example</button><button id="builderLoadExample" class="btn small">R→Ø example</button></div>
      <div id="plenumPanel" class="plenum-panel hidden"></div>
      <label class="field"><span class="label">Part type</span><select id="builderPartType" class="select"><option value="rectangular-transition">Rectangular → rectangular</option><option value="rectangular-to-round-transition">Rectangular → round</option><option value="round-to-rectangular-transition">Round → rectangular</option><option value="plenum-box">Plenum box with outlets</option></select></label>
      <label class="field"><span class="label">Part name</span><input id="builderName" class="input" maxlength="120"><span class="error" data-error="name"></span></label>
      <label class="field"><span class="label">Part number (optional)</span><input id="builderPartNumber" class="input" maxlength="80"></label>
      <div class="suggestion-box"><span>Suggested classification</span><strong id="builderClassification"></strong></div>
      <div id="transitionParams">
      <fieldset><legend>Port P1 · End A · Z = 0</legend><div id="builderEndARect" class="inline"><label class="field"><span class="label">Width (mm)</span><input id="builderEndAWidth" class="input" type="number" min="1" max="20000"><span class="error" data-error="endAWidthMm"></span></label><label class="field"><span class="label">Height (mm)</span><input id="builderEndAHeight" class="input" type="number" min="1" max="20000"><span class="error" data-error="endAHeightMm"></span></label></div><label id="builderEndARound" class="field hidden"><span class="label">Diameter (mm)</span><input id="builderEndADiameter" class="input" type="number" min="1" max="20000"><span class="error" data-error="endADiameterMm"></span></label></fieldset>
      <fieldset><legend>Port P2 · End B · Z = length</legend><div id="builderEndBRect" class="inline"><label class="field"><span class="label">Width (mm)</span><input id="builderEndBWidth" class="input" type="number" min="1" max="20000"><span class="error" data-error="endBWidthMm"></span></label><label class="field"><span class="label">Height (mm)</span><input id="builderEndBHeight" class="input" type="number" min="1" max="20000"><span class="error" data-error="endBHeightMm"></span></label></div><label id="builderEndBRound" class="field hidden"><span class="label">Diameter (mm)</span><input id="builderEndBDiameter" class="input" type="number" min="1" max="20000"><span class="error" data-error="endBDiameterMm"></span></label></fieldset>
      <label class="field"><span class="label">Body length (mm)</span><input id="builderLength" class="input" type="number" min="1" max="20000"><span class="error" data-error="lengthMm"></span></label>
      <fieldset><legend>End B offsets</legend>
        <label class="field"><span class="label">Horizontal offset X (mm)</span><input id="builderHorizontalOffset" class="input" type="number" min="-20000" max="20000"><span class="error" data-error="horizontalOffsetMm"></span></label>
        <div class="adjust-row"><button class="btn small" data-adjust="horizontalOffsetMm" data-delta="-10">−10 mm</button><button class="btn small" data-adjust="horizontalOffsetMm" data-delta="10">+10 mm</button><button id="builderCentreHorizontal" class="btn small">Centre horizontally</button></div>
        <label class="field"><span class="label">Vertical offset Y (mm)</span><input id="builderVerticalOffset" class="input" type="number" min="-20000" max="20000"><span class="error" data-error="verticalOffsetMm"></span></label>
        <div class="adjust-row"><button class="btn small" data-adjust="verticalOffsetMm" data-delta="-10">−10 mm</button><button class="btn small" data-adjust="verticalOffsetMm" data-delta="10">+10 mm</button><button id="builderCentreVertical" class="btn small">Centre vertically</button></div>
        <p class="help">+X moves End B right; −X left. +Y moves End B up; −Y down.</p>
      </fieldset>
      <fieldset><legend>Outlet P2 orientation</legend><div class="inline"><label class="field"><span class="label">Horizontal angle (°)</span><input id="builderHorizontalAngle" class="input" type="number" min="-85" max="85"><span class="error" data-error="outletHorizontalAngleDeg"></span></label><label class="field"><span class="label">Vertical angle (°)</span><input id="builderVerticalAngle" class="input" type="number" min="-85" max="85"><span class="error" data-error="outletVerticalAngleDeg"></span></label></div><label class="field"><span class="label">Rotation around outlet axis (°)</span><input id="builderOutletRotation" class="input" type="number" min="-180" max="180"><span class="error" data-error="outletRotationDeg"></span></label><p class="help">Angles define a full direction vector. Positive horizontal turns P2 right; positive vertical tilts P2 up.</p></fieldset>
      </div>
      <div class="inline"><label class="field"><span class="label">Quantity</span><input id="builderQuantity" class="input" type="number" min="1" max="10000"><span class="error" data-error="quantity"></span></label><label class="field"><span class="label">System</span><select id="builderSystem" class="select">${SYSTEMS.map((value) => `<option>${value}</option>`).join('')}</select></label></div>
      <div class="inline"><label class="field"><span class="label">Material</span><select id="builderMaterial" class="select">${MATERIALS.map((value) => `<option>${value}</option>`).join('')}</select></label><label class="field"><span class="label">Thickness (mm)</span><input id="builderThickness" class="input" type="number" min="0.1" max="20" step="0.1"><span class="error" data-error="thicknessMm"></span></label></div>
      <label class="field"><span class="label">Verification</span><select id="builderVerification" class="select"><option value="suggested">Suggested</option><option value="verified">Verified</option></select></label>
      <label class="field"><span class="label">Notes</span><textarea id="builderNotes" class="input" rows="2" maxlength="500"></textarea></label>
      <div class="button-row"><button id="builderSwapEnds" class="btn">Swap End A / B</button><button id="builderDuplicate" class="btn">Duplicate as new part</button><button id="builderPdf" class="btn">Export drawing PDF</button></div>
      <button id="builderSave" class="btn primary builder-save">Save project part</button>
      <button id="builderSaveTemplate" class="btn builder-save">Save as personal template</button>
    </aside>
    <section class="builder-visuals">
      <div class="builder-preview-panel"><div class="panel-header"><div><h2>Assembly 3D preview</h2><span id="builderEditingStatus" class="badge">New part</span></div><div class="preview-actions"><button class="btn small" data-camera="front">Front</button><button class="btn small" data-camera="top">Top</button><button class="btn small" data-camera="side">Side</button><button class="btn small" data-camera="iso">Isometric</button><button id="builderFitCamera" class="btn small">Fit</button><button id="builderResetCamera" class="btn small">Reset</button></div></div><div id="builder3d" class="builder-3d" aria-label="Interactive 3D custom HVAC fitting preview"></div><div id="builder3dContext" class="builder-context hidden" aria-live="polite"></div><label class="toggle-row"><input id="builderCentreline" type="checkbox" checked> Show 3D centreline</label></div>
      <div id="builderMetrics" class="builder-metrics"></div>
      <div class="technical-toolbar"><label><input id="builderShowDimensions" type="checkbox" checked> Show dimensions</label><label>Grid <select id="builderGrid" class="select compact"><option value="0">Off</option><option value="10">10 mm</option><option value="50" selected>50 mm</option><option value="100">100 mm</option></select></label></div>
      <div id="builderDimensionEditor" class="dimension-editor hidden" role="dialog" aria-modal="false" aria-labelledby="dimensionEditorTitle"><strong id="dimensionEditorTitle"></strong><label><span class="sr-only">New value</span><input id="dimensionEditorInput" class="input" type="number"></label><span id="dimensionEditorUnit" class="dimension-unit"></span><div id="dimensionEditorHelp" class="help"></div><div id="dimensionEditorError" class="error" aria-live="polite"></div><div class="button-row"><button id="dimensionEditorConfirm" class="btn small primary">Confirm</button><button id="dimensionEditorCancel" class="btn small">Cancel</button></div></div>
      <div id="builderTechnicalViews" class="technical-grid"></div>
    </section>
  </div>`;

  const get = <T extends HTMLElement>(id: string): T => { const value = root.querySelector<T>(`#${id}`); if (!value) throw new Error(`Missing builder element ${id}`); return value; };
  const inputs: Record<NumericKey, HTMLInputElement> = {
    endAWidthMm: get('builderEndAWidth'), endAHeightMm: get('builderEndAHeight'), endADiameterMm: get('builderEndADiameter'), endBWidthMm: get('builderEndBWidth'), endBHeightMm: get('builderEndBHeight'), endBDiameterMm: get('builderEndBDiameter'), lengthMm: get('builderLength'), horizontalOffsetMm: get('builderHorizontalOffset'), verticalOffsetMm: get('builderVerticalOffset'), outletHorizontalAngleDeg: get('builderHorizontalAngle'), outletVerticalAngleDeg: get('builderVerticalAngle'), outletRotationDeg: get('builderOutletRotation'), quantity: get('builderQuantity'), thicknessMm: get('builderThickness'),
  };
  const partTypeInput = get<HTMLSelectElement>('builderPartType'); const nameInput = get<HTMLInputElement>('builderName'); const partNumberInput = get<HTMLInputElement>('builderPartNumber'); const systemInput = get<HTMLSelectElement>('builderSystem'); const materialInput = get<HTMLSelectElement>('builderMaterial'); const notesInput = get<HTMLTextAreaElement>('builderNotes'); const verificationInput = get<HTMLSelectElement>('builderVerification');
  const preview = get<HTMLDivElement>('builder3d'); const technical = get<HTMLDivElement>('builderTechnicalViews'); const metrics = get<HTMLDivElement>('builderMetrics'); const contextPanel = get<HTMLDivElement>('builder3dContext'); const editor = get<HTMLDivElement>('builderDimensionEditor'); const editorInput = get<HTMLInputElement>('dimensionEditorInput'); const editorError = get<HTMLDivElement>('dimensionEditorError');
  let mode: 'library' | 'editor' = 'library';
  let libraryFilter = 'All'; let librarySearch = ''; let selectedPortId: string | null = null;
  let draft = blankPart(); let active = false; let editingExisting = false; let currentObject: THREE.Group | null = null; let renderTimer = 0; let selectedDimension: TechnicalSelection = {}; let selectedSurface: 'end-a' | 'end-b' | 'top' | 'bottom' | 'left' | 'right' | 'edge' | null = null; let editorTarget: { key: EditableDimensionKey } | { edgeKind: DerivedEdgeKind; edgeIndex: number } | null = null;

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b121c);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100_000);
  let renderer: THREE.WebGLRenderer | null = null; let controls: OrbitControls | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; preview.append(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false; controls.minDistance = 10; controls.maxDistance = 100_000; controls.addEventListener('change', () => renderer?.render(scene, camera));
  } catch (error) {
    console.error('WebGL preview unavailable', error); preview.innerHTML = '<div class="webgl-fallback"><b>3D preview unavailable</b><span>This browser could not start WebGL. Parameter calculations and technical views remain available.</span></div>';
  }
  scene.add(new THREE.HemisphereLight(0xdceeff, 0x263442, 2.1)); const keyLight = new THREE.DirectionalLight(0xffffff, 2.5); keyLight.position.set(1, 2, 1); scene.add(keyLight);

  function disposeObject(): void {
    if (!currentObject) return;
    currentObject.traverse((object) => { if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Line) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((material) => material.dispose()); } });
    scene.remove(currentObject); currentObject = null;
  }
  function create3d(geometry: TransitionGeometry): void {
    disposeObject(); const group = new THREE.Group();
    const positions = geometry.vertices.flatMap((v) => [v.x, v.y, v.z]);
    const addMesh = (pick: string, faces: Array<[number, number, number, number]>, capRing?: number[]): void => {
      const indices: number[] = []; faces.forEach(([a, b, c, d]) => indices.push(a, b, c, a, c, d)); if (capRing) for (let index = 1; index < capRing.length - 1; index += 1) indices.push(capRing[0], capRing[index], capRing[index + 1]);
      const meshGeometry = new THREE.BufferGeometry(); meshGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); meshGeometry.setIndex(indices); meshGeometry.computeVertexNormals();
      const selected = selectedSurface === pick; const mesh = new THREE.Mesh(meshGeometry, new THREE.MeshStandardMaterial({ color: selected ? 0xf1b94f : pick.startsWith('end-') ? 0x4c88aa : 0x5b9fc4, emissive: selected ? 0x5b3500 : 0x000000, metalness: .45, roughness: .48, side: THREE.DoubleSide, transparent: true, opacity: selected ? .98 : .86 })); mesh.userData.pick = pick; group.add(mesh);
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(meshGeometry, 12), new THREE.LineBasicMaterial({ color: selected ? 0xffdd77 : 0xd8efff })));
    };
    addMesh('bottom', geometry.sideFaces.slice(0, 6)); addMesh('right', geometry.sideFaces.slice(6, 12)); addMesh('top', geometry.sideFaces.slice(12, 18)); addMesh('left', geometry.sideFaces.slice(18, 24)); addMesh('end-a', [], [...geometry.endRings[0]].reverse()); addMesh('end-b', [], geometry.endRings[1]);
    [0, 6, 12, 18].forEach((index) => { const edgeGeometry = new THREE.BufferGeometry().setFromPoints([geometry.vertices[geometry.endRings[0][index]], geometry.vertices[geometry.endRings[1][index]]].map((point) => new THREE.Vector3(point.x, point.y, point.z))); const edge = new THREE.Line(edgeGeometry, new THREE.LineBasicMaterial({ color: selectedSurface === 'edge' && selectedDimension.edgeIndex === index ? 0xffdc73 : 0xe9f7ff, linewidth: 2 })); edge.userData.pick = 'edge'; edge.userData.edgeIndex = index; group.add(edge); });
    geometry.ports.forEach((port) => { const length = Math.max(40, draft.lengthMm * .18); const axis = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(port.position.x, port.position.y, port.position.z), new THREE.Vector3(port.position.x + port.direction.x * length, port.position.y + port.direction.y * length, port.position.z + port.direction.z * length)]); group.add(new THREE.Line(axis, new THREE.LineBasicMaterial({ color: port.role === 'inlet' ? 0x65c7ff : 0xffb15c }))); });
    if (get<HTMLInputElement>('builderCentreline').checked) { const centre = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(draft.horizontalOffsetMm, draft.verticalOffsetMm, draft.lengthMm)]); group.add(new THREE.Line(centre, new THREE.LineDashedMaterial({ color: 0xffd479, dashSize: Math.max(10, draft.lengthMm / 25), gapSize: Math.max(6, draft.lengthMm / 40) }))); (group.children[group.children.length - 1] as THREE.Line).computeLineDistances(); }
    currentObject = group; scene.add(group); renderer?.render(scene, camera);
  }
  function fitCamera(direction = new THREE.Vector3(1, .75, 1), up = new THREE.Vector3(0, 1, 0)): void {
    if (!currentObject) return; const box = new THREE.Box3().setFromObject(currentObject); const sphere = box.getBoundingSphere(new THREE.Sphere()); const distance = Math.max(100, sphere.radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.25);
    camera.up.copy(up); camera.position.copy(sphere.center).add(direction.clone().normalize().multiplyScalar(distance)); camera.near = Math.max(.1, distance / 1000); camera.far = distance * 20; camera.updateProjectionMatrix(); if (controls) { controls.target.copy(sphere.center); controls.update(); } renderer?.render(scene, camera);
  }
  function setCamera(view: string): void {
    if (view === 'front') fitCamera(new THREE.Vector3(0, 0, -1)); else if (view === 'top') fitCamera(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)); else if (view === 'side') fitCamera(new THREE.Vector3(1, 0, 0)); else fitCamera();
  }
  function resize(): void { if (!renderer) return; const width = Math.max(320, preview.clientWidth); const height = Math.max(260, preview.clientHeight); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.render(scene, camera); }
  const resizeObserver = new ResizeObserver(() => { if (active) resize(); }); resizeObserver.observe(preview);
  const raycaster = new THREE.Raycaster(); raycaster.params.Line = { threshold: 8 }; let previewPointerStart: { x: number; y: number; id: number } | null = null;
  renderer?.domElement.addEventListener('pointerdown', (event) => { previewPointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }; });
  renderer?.domElement.addEventListener('pointerup', (event) => {
    if (!previewPointerStart || previewPointerStart.id !== event.pointerId || Math.hypot(event.clientX - previewPointerStart.x, event.clientY - previewPointerStart.y) > 6 || !currentObject || !renderer) { previewPointerStart = null; return; }
    previewPointerStart = null; const rect = renderer.domElement.getBoundingClientRect(); raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hits = raycaster.intersectObject(currentObject, true); const hit = hits.find((item) => item.object.userData.pick === 'edge') ?? hits.find((item) => typeof item.object.userData.pick === 'string'); if (!hit) return; const pick = hit.object.userData.pick as typeof selectedSurface; selectedSurface = pick;
    if (pick === 'edge') selectedDimension = { edgeKind: 'corner-edge', edgeIndex: Number(hit.object.userData.edgeIndex) || 0 };
    else if (pick === 'end-a') selectedDimension = { key: profileForEnd(draft, 'a') === 'round' ? 'endADiameterMm' : 'endAWidthMm' };
    else if (pick === 'end-b') selectedDimension = { key: profileForEnd(draft, 'b') === 'round' ? 'endBDiameterMm' : 'endBWidthMm' };
    else selectedDimension = { key: 'lengthMm' };
    render();
  });

  // --- Template library -----------------------------------------------------
  function partFromTemplate(templateId: PartTemplateId): CustomPart {
    const base = blankPart();
    const time = timestamp();
    const common = { ...base, id: newId(), templateId, revision: 'A', tags: [] as string[], favourite: false, createdAt: time, updatedAt: time };
    if (templateId === 'plenum-box') {
      return syncCustomPartAssembly({
        ...common, name: 'Plenum box', partType: 'plenum-box' as CustomPartType,
        bodyWidthMm: 600, bodyHeightMm: 400, bodyDepthMm: 300,
        endAWidthMm: 400, endAHeightMm: 200, lengthMm: 300,
        plenumPorts: defaultPlenumPorts(),
      });
    }
    if (templateId === 'rectangular-to-round') {
      return syncCustomPartAssembly({ ...common, name: 'Rectangular to round transition', partType: 'rectangular-to-round-transition', endAWidthMm: 500, endAHeightMm: 300, endBDiameterMm: 250, horizontalOffsetMm: 0, verticalOffsetMm: 0 });
    }
    if (templateId === 'round-to-rectangular') {
      return syncCustomPartAssembly({ ...common, name: 'Round to rectangular transition', partType: 'round-to-rectangular-transition', endADiameterMm: 250, endBWidthMm: 400, endBHeightMm: 250, horizontalOffsetMm: 0, verticalOffsetMm: 0 });
    }
    return syncCustomPartAssembly({ ...common, name: 'Rectangular transition', partType: 'rectangular-transition' });
  }

  function showLibrary(): void { mode = 'library'; get('builderLibrary').classList.remove('hidden'); get('builderShell').classList.add('hidden'); renderLibrary(); }
  function showEditor(): void { mode = 'editor'; get('builderLibrary').classList.add('hidden'); get('builderShell').classList.remove('hidden'); window.setTimeout(() => { resize(); fitCamera(); }, 0); }

  function openTemplate(templateId: PartTemplateId): void {
    const template = PART_TEMPLATES.find((t) => t.id === templateId);
    if (!template || template.status !== 'available') { options.notify('This template family is coming in a later development phase'); return; }
    draft = partFromTemplate(templateId); editingExisting = false; selectedPortId = null;
    writeDraft(); showEditor(); render(); options.notify(`${template.name} opened`);
  }

  function openPersonalTemplate(id: string): void {
    const template = options.getTemplates?.().find((t) => t.id === id); if (!template) return;
    const time = timestamp();
    draft = syncCustomPartAssembly({ ...structuredClone(template.part), id: newId(), createdAt: time, updatedAt: time });
    editingExisting = false; selectedPortId = null; writeDraft(); showEditor(); render();
    options.notify(`New part started from “${template.name}”`);
  }

  const FILTERS = ['All', 'Rectangular', 'Round', 'Mixed profile', 'Branches', 'Transitions', 'Equipment connections', 'My templates', 'Favourites'];
  function templateMatches(t: PartTemplateDefinition): boolean {
    const q = librarySearch.trim().toLowerCase();
    if (q && !(`${t.name} ${t.description} ${t.category} ${t.inletProfile} ${t.outletProfile} ${t.tags.join(' ')}`.toLowerCase().includes(q))) return false;
    switch (libraryFilter) {
      case 'Rectangular': return t.inletProfile === 'rectangular' || t.outletProfile === 'rectangular';
      case 'Round': return t.inletProfile === 'round' || t.outletProfile === 'round';
      case 'Mixed profile': return t.inletProfile !== t.outletProfile && t.inletProfile !== 'either';
      case 'Branches': return t.tags.includes('branches') || t.outletProfile === 'multiple';
      case 'Transitions': return t.category === 'Transitions';
      case 'Equipment connections': return t.category === 'Equipment connections';
      case 'My templates': case 'Favourites': return false;
      default: return true;
    }
  }

  function renderLibrary(): void {
    get('tplFilters').innerHTML = FILTERS.map((f) => `<button class="btn small tpl-filter ${f === libraryFilter ? 'active' : ''}" data-tpl-filter="${htmlEscape(f)}">${htmlEscape(f)}</button>`).join('');
    const personal = options.getTemplates?.() ?? [];
    const q = librarySearch.trim().toLowerCase();
    const showPersonal = libraryFilter === 'All' || libraryFilter === 'My templates' || libraryFilter === 'Favourites';
    const personalMatches = personal.filter((t) => (libraryFilter !== 'Favourites' || t.favourite)
      && (!q || `${t.name} ${t.description} ${t.tags.join(' ')}`.toLowerCase().includes(q)));
    const standard = (libraryFilter === 'My templates' || libraryFilter === 'Favourites') ? [] : PART_TEMPLATES.filter(templateMatches);

    const standardCards = standard.map((t) => `<article class="tpl-card ${t.status === 'coming-later' ? 'later' : ''}">
      <div class="tpl-thumb">${templateThumbnail(t.id)}</div>
      <h3>${htmlEscape(t.name)}</h3>
      <p>${htmlEscape(t.description)}</p>
      <div class="tpl-meta"><span>In: ${htmlEscape(t.inletProfile)}</span><span>Out: ${htmlEscape(t.outletProfile)}</span></div>
      <div class="tpl-params">${htmlEscape(t.parameterSummary)}</div>
      ${t.status === 'available'
        ? `<button class="btn small primary" data-open-template="${t.id}">Open template</button>`
        : '<button class="btn small" disabled>Coming in a later development phase</button>'}
    </article>`).join('');

    const personalCards = showPersonal ? personalMatches.map((t) => `<article class="tpl-card personal">
      <div class="tpl-thumb">${templateThumbnail((t.sourceTemplateId as PartTemplateId) || 'rectangular-transition')}</div>
      <h3>${t.favourite ? '★ ' : ''}${htmlEscape(t.name)}</h3>
      <p>${htmlEscape(t.description || 'Personal template')}</p>
      <div class="tpl-meta"><span>My template</span><span>${htmlEscape(t.tags.join(', ') || 'no tags')}</span></div>
      <div class="button-row">
        <button class="btn small primary" data-open-personal="${t.id}">New part</button>
        <button class="btn small" data-fav-personal="${t.id}">${t.favourite ? 'Unfavourite' : 'Favourite'}</button>
        <button class="btn small" data-export-personal="${t.id}">JSON</button>
        <button class="btn small ghost danger" data-delete-personal="${t.id}">Delete</button>
      </div>
    </article>`).join('') : '';

    const importCard = `<article class="tpl-card import-card"><div class="tpl-thumb">${templateThumbnail('custom-assembly')}</div><h3>Import personal template</h3><p>Load a template previously exported as JSON. Nothing leaves this browser.</p><button class="btn small" data-import-template>Import JSON…</button></article>`;
    get('tplGrid').innerHTML = `${standardCards}${personalCards}${importCard}` || '<div class="empty-mini">No templates match this filter.</div>';
  }

  // --- Plenum editor --------------------------------------------------------
  const FACES: PlenumFace[] = ['front', 'back', 'top', 'bottom', 'left', 'right'];
  function plenumPorts(): PlenumPort[] { return draft.plenumPorts ?? []; }
  function updatePorts(next: PlenumPort[]): void { draft.plenumPorts = next; draft.updatedAt = timestamp(); render(); if (editingExisting) options.onChange?.(structuredClone(draft)); }

  function addPort(shape: 'round' | 'rectangular'): void {
    const ports = plenumPorts();
    const id = nextPortId(ports);
    ports.push({ id, name: `Outlet ${id}`, face: 'front', shape, widthMm: 300, heightMm: 200, diameterMm: 160, offsetHorizontalMm: 0, offsetVerticalMm: 0, projectionMm: 80, rotationDeg: 0, role: 'outlet', notes: '' });
    selectedPortId = id; updatePorts(ports); options.notify(`${shape === 'round' ? 'Round' : 'Rectangular'} outlet ${id} added`);
  }

  function renderPlenumPanel(): void {
    const panel = get('plenumPanel');
    if (draft.partType !== 'plenum-box') { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
    panel.classList.remove('hidden');
    const geometry = buildPlenumGeometry(draft);
    const ports = plenumPorts();
    const selected = ports.find((p) => p.id === selectedPortId) ?? null;
    panel.innerHTML = `
      <fieldset><legend>Body</legend><div class="inline">
        <label class="field"><span class="label">Width (mm)</span><input class="input" type="number" inputmode="numeric" data-plenum="bodyWidthMm" value="${draft.bodyWidthMm ?? 600}"></label>
        <label class="field"><span class="label">Height (mm)</span><input class="input" type="number" inputmode="numeric" data-plenum="bodyHeightMm" value="${draft.bodyHeightMm ?? 400}"></label></div>
        <label class="field"><span class="label">Depth (mm)</span><input class="input" type="number" inputmode="numeric" data-plenum="bodyDepthMm" value="${draft.bodyDepthMm ?? 300}"></label>
      </fieldset>
      <fieldset><legend>Inlet P1 (back face)</legend><div class="inline">
        <label class="field"><span class="label">Width (mm)</span><input class="input" type="number" inputmode="numeric" data-plenum="endAWidthMm" value="${draft.endAWidthMm}"></label>
        <label class="field"><span class="label">Height (mm)</span><input class="input" type="number" inputmode="numeric" data-plenum="endAHeightMm" value="${draft.endAHeightMm}"></label></div>
      </fieldset>
      <fieldset><legend>Outlets (${ports.length})</legend>
        <div class="button-row"><button class="btn small" data-add-port="round">+ Round outlet</button><button class="btn small" data-add-port="rectangular">+ Rectangular outlet</button></div>
        <div class="port-chips">${ports.map((p) => `<button class="duct-chip ${p.id === selectedPortId ? 'active' : ''}" data-select-port="${p.id}">${p.id} · ${htmlEscape(portSizeLabel(p))} · ${p.face}</button>`).join('') || '<span class="empty-mini">No outlets yet.</span>'}</div>
      </fieldset>
      ${selected ? `<fieldset><legend>Selected outlet ${selected.id}</legend>
        <label class="field"><span class="label">Name</span><input class="input" data-port-field="name" value="${htmlEscape(selected.name)}"></label>
        <div class="inline">
          <label class="field"><span class="label">Face</span><select class="select" data-port-field="face">${FACES.map((f) => `<option value="${f}"${f === selected.face ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
          <label class="field"><span class="label">Shape</span><select class="select" data-port-field="shape"><option value="round"${selected.shape === 'round' ? ' selected' : ''}>Round</option><option value="rectangular"${selected.shape === 'rectangular' ? ' selected' : ''}>Rectangular</option></select></label>
        </div>
        ${selected.shape === 'round'
          ? `<label class="field"><span class="label">Diameter (mm)</span><input class="input" type="number" inputmode="numeric" data-port-field="diameterMm" value="${selected.diameterMm}"></label>`
          : `<div class="inline"><label class="field"><span class="label">Width (mm)</span><input class="input" type="number" inputmode="numeric" data-port-field="widthMm" value="${selected.widthMm}"></label><label class="field"><span class="label">Height (mm)</span><input class="input" type="number" inputmode="numeric" data-port-field="heightMm" value="${selected.heightMm}"></label></div>`}
        <div class="inline">
          <label class="field"><span class="label">Offset H (mm)</span><input class="input" type="number" inputmode="numeric" data-port-field="offsetHorizontalMm" value="${selected.offsetHorizontalMm}"></label>
          <label class="field"><span class="label">Offset V (mm)</span><input class="input" type="number" inputmode="numeric" data-port-field="offsetVerticalMm" value="${selected.offsetVerticalMm}"></label>
        </div>
        <div class="inline">
          <label class="field"><span class="label">Connector (mm)</span><input class="input" type="number" inputmode="numeric" data-port-field="projectionMm" value="${selected.projectionMm}"></label>
          <label class="field"><span class="label">Rotation (°)</span><input class="input" type="number" inputmode="numeric" data-port-field="rotationDeg" value="${selected.rotationDeg}"></label>
        </div>
        <div class="button-row"><button class="btn small ghost danger" data-delete-port="${selected.id}">Delete outlet</button></div>
      </fieldset>` : ''}
      ${geometry.warnings.length ? `<div class="callout">${geometry.warnings.map((w) => htmlEscape(w)).join('<br>')}</div>` : ''}
      <fieldset><legend>Port schedule</legend><div class="port-schedule">
        <div class="port-row head"><span>ID</span><span>Role</span><span>Profile</span><span>Size</span><span>Face</span><span>Conn.</span></div>
        ${[geometry.inlet, ...geometry.ports].filter(Boolean).map((p) => { const q = p!.port; return `<div class="port-row"><span>${q.id}</span><span>${q.role}</span><span>${q.shape}</span><span>${htmlEscape(portSizeLabel(q))}</span><span>${q.face}</span><span>${q.projectionMm}</span></div>`; }).join('')}
      </div></fieldset>`;
  }

  function readDraft(): void {
    NUMERIC_KEYS.forEach((key) => { draft[key] = Number(inputs[key].value) as never; });
    draft.partType = partTypeInput.value as CustomPartType; draft.name = nameInput.value; draft.partNumber = partNumberInput.value.trim(); draft.system = systemInput.value; draft.material = materialInput.value; draft.notes = notesInput.value; draft.verificationStatus = verificationInput.value as VerificationStatus; draft.updatedAt = timestamp();
  }
  function writeDraft(): void {
    NUMERIC_KEYS.forEach((key) => { inputs[key].value = String(draft[key]); }); partTypeInput.value = draft.partType; nameInput.value = draft.name; partNumberInput.value = draft.partNumber ?? ''; systemInput.value = draft.system; materialInput.value = draft.material; notesInput.value = draft.notes; verificationInput.value = draft.verificationStatus;
    get('builderEditingStatus').textContent = editingExisting ? 'Editing' : 'New part';
  }
  function edgeValue(kind: DerivedEdgeKind, edgeIndex: number): number {
    const geometry = buildTransitionGeometry(draft); const index = ((edgeIndex % 24) + 24) % 24; const a = geometry.vertices[geometry.endRings[0][index]]; const b = geometry.vertices[geometry.endRings[1][index]];
    return kind === 'top-edge' ? Math.hypot(b.z - a.z, b.x - a.x) : kind === 'side-edge' ? Math.hypot(b.z - a.z, b.y - a.y) : Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  function renderContext(): void {
    if (!selectedSurface) { contextPanel.classList.add('hidden'); contextPanel.innerHTML = ''; return; }
    const profileA = profileForEnd(draft, 'a'); const profileB = profileForEnd(draft, 'b'); const buttons: Array<{ key?: EditableDimensionKey; edgeKind?: DerivedEdgeKind; edgeIndex?: number; label: string }> = [];
    if (selectedSurface === 'end-a') profileA === 'round' ? buttons.push({ key: 'endADiameterMm', label: `Diameter ${draft.endADiameterMm} mm` }) : buttons.push({ key: 'endAWidthMm', label: `Width ${draft.endAWidthMm} mm` }, { key: 'endAHeightMm', label: `Height ${draft.endAHeightMm} mm` });
    else if (selectedSurface === 'end-b') { profileB === 'round' ? buttons.push({ key: 'endBDiameterMm', label: `Diameter ${draft.endBDiameterMm} mm` }) : buttons.push({ key: 'endBWidthMm', label: `Width ${draft.endBWidthMm} mm` }, { key: 'endBHeightMm', label: `Height ${draft.endBHeightMm} mm` }); buttons.push({ key: 'horizontalOffsetMm', label: `X offset ${draft.horizontalOffsetMm} mm` }, { key: 'verticalOffsetMm', label: `Y offset ${draft.verticalOffsetMm} mm` }, { key: 'outletHorizontalAngleDeg', label: `H angle ${draft.outletHorizontalAngleDeg}°` }, { key: 'outletVerticalAngleDeg', label: `V angle ${draft.outletVerticalAngleDeg}°` }, { key: 'outletRotationDeg', label: `Rotation ${draft.outletRotationDeg}°` }); }
    else { buttons.push({ key: 'lengthMm', label: `Body length ${draft.lengthMm} mm` }, { edgeKind: 'corner-edge', edgeIndex: selectedDimension.edgeIndex ?? 0, label: `3D edge ${edgeValue('corner-edge', selectedDimension.edgeIndex ?? 0).toFixed(1)} mm` }); }
    contextPanel.innerHTML = `<strong>${selectedSurface === 'end-a' ? 'Port P1 / End A' : selectedSurface === 'end-b' ? 'Port P2 / End B' : selectedSurface === 'edge' ? 'Longitudinal edge' : `${selectedSurface[0].toUpperCase()}${selectedSurface.slice(1)} side`}</strong><span>Choose a dimension to edit</span><div class="button-row">${buttons.map((button) => `<button class="btn small" ${button.key ? `data-context-key="${button.key}"` : `data-context-edge="${button.edgeKind}" data-edge-index="${button.edgeIndex}"`}>${button.label}</button>`).join('')}</div>`; contextPanel.classList.remove('hidden');
  }
  function openEditor(target: { key: EditableDimensionKey } | { edgeKind: DerivedEdgeKind; edgeIndex: number }, anchor?: { x: number; y: number }): void {
    readDraft(); editorTarget = target; editorError.textContent = ''; const derived = 'edgeKind' in target; selectedDimension = derived ? { edgeKind: target.edgeKind, edgeIndex: target.edgeIndex } : { key: target.key };
    const value = derived ? edgeValue(target.edgeKind, target.edgeIndex) : draft[target.key]; const title = derived ? 'Calculated sloping edge' : dimensionLabel(target.key); const unit = derived ? 'mm' : dimensionUnit(target.key);
    get('dimensionEditorTitle').textContent = title; get('dimensionEditorUnit').textContent = unit; get('dimensionEditorHelp').textContent = derived ? 'Changing this edge length adjusts body length while keeping port sizes and offsets unchanged. Other sloping edges may also change.' : 'Updates the shared parameter model, 3D preview and all technical views.';
    editorInput.value = Number(value).toFixed(derived ? 1 : Number.isInteger(value) ? 0 : 2); editorInput.step = unit === '°' ? '1' : '1'; editor.style.setProperty('--editor-x', `${Math.min(window.innerWidth - 300, Math.max(12, anchor?.x ?? window.innerWidth / 2 - 140))}px`); editor.style.setProperty('--editor-y', `${Math.min(window.innerHeight - 220, Math.max(12, anchor?.y ?? window.innerHeight / 2 - 80))}px`); editor.classList.remove('hidden'); render(); window.setTimeout(() => { editorInput.focus(); editorInput.select(); }, 0);
  }
  function closeEditor(): void { editorTarget = null; editor.classList.add('hidden'); editorError.textContent = ''; }
  function confirmEditor(): void {
    if (!editorTarget) return; const target = editorTarget; readDraft(); const value = Number(editorInput.value);
    if ('key' in target) {
      const error = validateDimensionValue(draft, target.key, value); if (error) { editorError.textContent = error; return; }
      inputs[target.key].value = String(value); draft[target.key] = value as never;
    } else {
      const solution = solveBodyLengthFromEdge(draft, target.edgeKind, value, target.edgeIndex); if (solution.error || solution.bodyLengthMm === undefined) { editorError.textContent = `${solution.error ?? 'No real solution.'} Minimum possible edge length: ${solution.minimumTargetMm.toFixed(1)} mm.`; return; }
      inputs.lengthMm.value = String(Number(solution.bodyLengthMm.toFixed(3))); draft.lengthMm = solution.bodyLengthMm;
    }
    closeEditor(); writeDraft(); render(); if (editingExisting) options.onChange?.(structuredClone(draft)); options.notify(`${'key' in target ? 'Dimension' : 'Body length'} updated`);
  }
  function render(): void {
    readDraft(); const errors = validateCustomPart(draft); root.querySelectorAll<HTMLElement>('[data-error]').forEach((element) => { const key = element.dataset.error as keyof CustomPart; element.textContent = errors[key] ?? ''; });
    const template = templateForPart(draft);
    get('builderTemplateName').textContent = template ? template.name : 'Parametric fitting';
    const isPlenum = draft.partType === 'plenum-box';
    get('transitionParams').classList.toggle('hidden', isPlenum);
    if (isPlenum) { renderPlenum(); return; }
    get('plenumPanel').classList.add('hidden');
    const profileA = profileForEnd(draft, 'a'); const profileB = profileForEnd(draft, 'b'); get('builderEndARect').classList.toggle('hidden', profileA !== 'rectangular'); get('builderEndARound').classList.toggle('hidden', profileA !== 'round'); get('builderEndBRect').classList.toggle('hidden', profileB !== 'rectangular'); get('builderEndBRound').classList.toggle('hidden', profileB !== 'round');
    get('builderTitle').textContent = partTypeInput.selectedOptions[0]?.textContent ?? 'Transition'; get('builderClassification').textContent = classifyTransition(draft);
    if (Object.keys(errors).length) { get<HTMLButtonElement>('builderSave').disabled = true; get<HTMLButtonElement>('builderPdf').disabled = true; return; }
    get<HTMLButtonElement>('builderSave').disabled = false; get<HTMLButtonElement>('builderPdf').disabled = false; draft = syncCustomPartAssembly(draft); const geometry = buildTransitionGeometry(draft); create3d(geometry);
    const showDimensions = get<HTMLInputElement>('builderShowDimensions').checked; const grid = Number(get<HTMLSelectElement>('builderGrid').value) as GridSize;
    technical.innerHTML = renderTechnicalView(draft, geometry, 'front', showDimensions, grid, selectedDimension) + renderTechnicalView(draft, geometry, 'top', showDimensions, grid, selectedDimension) + renderTechnicalView(draft, geometry, 'side', showDimensions, grid, selectedDimension);
    const sizeA = profileA === 'round' ? `Ø${draft.endADiameterMm}` : `${draft.endAWidthMm} × ${draft.endAHeightMm}`; const sizeB = profileB === 'round' ? `Ø${draft.endBDiameterMm}` : `${draft.endBWidthMm} × ${draft.endBHeightMm}`; const direction = geometry.ports[1].direction;
    metrics.innerHTML = `<div><span>Port P1</span><b>${sizeA} mm</b></div><div><span>Port P2</span><b>${sizeB} mm</b></div><div><span>Body / centreline</span><b>${draft.lengthMm} / ${geometry.centrelineLengthMm.toFixed(1)} mm</b></div><div><span>Offsets X / Y</span><b>${draft.horizontalOffsetMm > 0 ? '+' : ''}${draft.horizontalOffsetMm} / ${draft.verticalOffsetMm > 0 ? '+' : ''}${draft.verticalOffsetMm} mm</b></div><div><span>P2 direction</span><b>${direction.x.toFixed(3)}, ${direction.y.toFixed(3)}, ${direction.z.toFixed(3)}</b></div><div><span>Surface area</span><b>${geometry.surfaceAreaM2.toFixed(3)} m²</b></div><p>Geometric estimates only; verify all ports, angles and dimensions before fabrication.</p>`;
    NUMERIC_KEYS.forEach((key) => inputs[key].classList.toggle('selected-parameter', selectedDimension.key === key)); renderContext(); renderer?.render(scene, camera);
  }
  // Plenum uses the same buildPlenumGeometry() output for 3D, views and schedule.
  function renderPlenum(): void {
    renderPlenumPanel();
    const geometry = buildPlenumGeometry(draft);
    get('builderTitle').textContent = 'Plenum box with outlets';
    get('builderClassification').textContent = `${geometry.ports.length} outlet${geometry.ports.length === 1 ? '' : 's'}${geometry.warnings.length ? ' · check warnings' : ''}`;
    get<HTMLButtonElement>('builderSave').disabled = false; get<HTMLButtonElement>('builderPdf').disabled = false;
    draft = syncCustomPartAssembly(draft);

    disposeObject();
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(draft.bodyWidthMm ?? 600, draft.bodyHeightMm ?? 400, draft.bodyDepthMm ?? 300),
      new THREE.MeshStandardMaterial({ color: 0x5b9fc4, metalness: .45, roughness: .5, transparent: true, opacity: .55, side: THREE.DoubleSide }),
    );
    group.add(body);
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: 0xd8efff })));
    const drawRing = (points: { x: number; y: number; z: number }[], colour: number): void => {
      const closed = [...points, points[0]].map((p) => new THREE.Vector3(p.x, p.y, p.z));
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(closed), new THREE.LineBasicMaterial({ color: colour })));
    };
    [geometry.inlet, ...geometry.ports].forEach((entry) => {
      if (!entry) return;
      const selected = entry.port.id === selectedPortId;
      const colour = entry.port.role === 'inlet' ? 0x65c7ff : selected ? 0xffd479 : 0xffb15c;
      drawRing(entry.outline, colour); drawRing(entry.outerRing, colour);
      entry.outline.forEach((p, i) => {
        if (i % Math.max(1, Math.floor(entry.outline.length / 8))) return;
        const q = entry.outerRing[i];
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(q.x, q.y, q.z)]), new THREE.LineBasicMaterial({ color: colour })));
      });
    });
    currentObject = group; scene.add(group); renderer?.render(scene, camera);

    const showDimensions = get<HTMLInputElement>('builderShowDimensions').checked;
    technical.innerHTML = renderPlenumViews(draft, showDimensions);
    metrics.innerHTML = `<div><span>Body</span><b>${draft.bodyWidthMm} × ${draft.bodyHeightMm} × ${draft.bodyDepthMm} mm</b></div>`
      + `<div><span>Inlet P1</span><b>${draft.endAWidthMm} × ${draft.endAHeightMm} mm</b></div>`
      + `<div><span>Outlets</span><b>${geometry.ports.length}</b></div>`
      + `<div><span>Volume</span><b>${geometry.volumeM3.toFixed(3)} m³</b></div>`
      + `<div><span>Surface area</span><b>${geometry.surfaceAreaM2.toFixed(3)} m²</b></div>`
      + `<div><span>Warnings</span><b>${geometry.warnings.length}</b></div>`
      + '<p>Geometric reference only. Port openings are not boolean-cut; verify before fabrication.</p>';
  }

  function scheduleRender(): void { window.clearTimeout(renderTimer); renderTimer = window.setTimeout(() => { render(); if (editingExisting && !Object.keys(validateCustomPart(draft)).length) options.onChange?.(structuredClone(draft)); }, 70); }
  root.addEventListener('input', (event) => { if (!(event.target as HTMLElement).closest('.dimension-editor')) scheduleRender(); }); root.addEventListener('change', (event) => { if (!(event.target as HTMLElement).closest('.dimension-editor')) scheduleRender(); });
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement; const adjust = target.dataset.adjust as NumericKey | undefined;
    if (adjust) { inputs[adjust].value = String((Number(inputs[adjust].value) || 0) + Number(target.dataset.delta)); render(); }
    const cameraView = target.dataset.camera; if (cameraView) setCamera(cameraView);
    const editable = target.closest<HTMLElement>('[data-dimension-key],[data-edge-kind],[data-context-key],[data-context-edge]'); if (!editable) return;
    const anchor = { x: event.clientX + 10, y: event.clientY + 10 }; const key = editable.dataset.dimensionKey ?? editable.dataset.contextKey; const edgeKind = editable.dataset.edgeKind ?? editable.dataset.contextEdge;
    if (key) openEditor({ key: key as EditableDimensionKey }, anchor); else if (edgeKind) openEditor({ edgeKind: edgeKind as DerivedEdgeKind, edgeIndex: Number(editable.dataset.edgeIndex) || 0 }, anchor);
  });
  root.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (target === editorInput && event.key === 'Enter') { event.preventDefault(); confirmEditor(); return; }
    if (editor.contains(target) && event.key === 'Escape') { event.preventDefault(); closeEditor(); return; }
    if ((event.key === 'Enter' || event.key === ' ') && target.matches('[data-dimension-key],[data-edge-kind]')) { event.preventDefault(); target.click(); }
  });
  // --- Library + plenum + personal-template wiring --------------------------
  get('builderBackToLibrary').addEventListener('click', showLibrary);
  get('tplSearch').addEventListener('input', (event) => { librarySearch = (event.target as HTMLInputElement).value; renderLibrary(); });
  get('tplFilters').addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tpl-filter]'); if (!target) return;
    libraryFilter = target.dataset.tplFilter ?? 'All'; renderLibrary();
  });
  get('tplGrid').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const open = target.closest<HTMLElement>('[data-open-template]')?.dataset.openTemplate;
    if (open) { openTemplate(open as PartTemplateId); return; }
    const personal = target.closest<HTMLElement>('[data-open-personal]')?.dataset.openPersonal;
    if (personal) { openPersonalTemplate(personal); return; }
    const fav = target.closest<HTMLElement>('[data-fav-personal]')?.dataset.favPersonal;
    if (fav) { const t = options.getTemplates?.().find((x) => x.id === fav); if (t) { options.saveTemplate?.({ ...t, favourite: !t.favourite, updatedAt: timestamp() }); renderLibrary(); } return; }
    const del = target.closest<HTMLElement>('[data-delete-personal]')?.dataset.deletePersonal;
    if (del) { const t = options.getTemplates?.().find((x) => x.id === del); if (t && window.confirm(`Delete personal template “${t.name}”?`)) { options.deleteTemplate?.(del); renderLibrary(); } return; }
    const exp = target.closest<HTMLElement>('[data-export-personal]')?.dataset.exportPersonal;
    if (exp) {
      const t = options.getTemplates?.().find((x) => x.id === exp); if (!t) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `${t.name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}-template.json`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0); options.notify('Personal template exported as JSON'); return;
    }
    if (target.closest('[data-import-template]')) {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json';
      input.addEventListener('change', () => {
        const file = input.files?.[0]; if (!file) return;
        file.text().then((text) => {
          const parsed: unknown = JSON.parse(text);
          if (!parsed || typeof parsed !== 'object' || !('part' in parsed)) { options.notify('That JSON is not a personal template'); return; }
          const incoming = parsed as PersonalTemplate;
          options.saveTemplate?.({ ...incoming, id: newId(), createdAt: timestamp(), updatedAt: timestamp() });
          renderLibrary(); options.notify(`Imported “${incoming.name}”`);
        }).catch(() => options.notify('Could not read that JSON file'));
      });
      input.click();
    }
  });
  get('plenumPanel').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const add = target.closest<HTMLElement>('[data-add-port]')?.dataset.addPort;
    if (add) { addPort(add === 'round' ? 'round' : 'rectangular'); return; }
    const select = target.closest<HTMLElement>('[data-select-port]')?.dataset.selectPort;
    if (select) { selectedPortId = select; render(); return; }
    const del = target.closest<HTMLElement>('[data-delete-port]')?.dataset.deletePort;
    if (del) { selectedPortId = null; updatePorts(plenumPorts().filter((p) => p.id !== del)); options.notify(`Outlet ${del} deleted`); }
  });
  const applyPlenumInput = (event: Event): void => {
    const target = event.target as HTMLElement;
    const bodyKey = target.closest<HTMLInputElement>('[data-plenum]')?.dataset.plenum;
    if (bodyKey) {
      const value = Number((target as HTMLInputElement).value);
      if (Number.isFinite(value)) { (draft as unknown as Record<string, number>)[bodyKey] = value; scheduleRender(); }
      return;
    }
    const field = target.closest<HTMLElement>('[data-port-field]')?.dataset.portField;
    if (!field || !selectedPortId) return;
    const ports = plenumPorts().map((p) => {
      if (p.id !== selectedPortId) return p;
      const raw = (target as HTMLInputElement | HTMLSelectElement).value;
      if (field === 'name' || field === 'face' || field === 'shape') return { ...p, [field]: raw } as PlenumPort;
      const value = Number(raw); return Number.isFinite(value) ? { ...p, [field]: value } as PlenumPort : p;
    });
    draft.plenumPorts = ports; scheduleRender();
  };
  get('plenumPanel').addEventListener('input', applyPlenumInput);
  get('plenumPanel').addEventListener('change', applyPlenumInput);
  get('builderSaveTemplate').addEventListener('click', () => {
    readDraft();
    const name = window.prompt('Personal template name:', draft.name); if (!name) return;
    const description = window.prompt('Short description (optional):', '') ?? '';
    const tags = (window.prompt('Tags, comma separated (optional):', '') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    const time = timestamp();
    options.saveTemplate?.({
      id: newId(), name, description, tags, favourite: false,
      sourceTemplateId: templateForPart(draft)?.id ?? draft.partType,
      part: syncCustomPartAssembly(structuredClone(draft)), createdAt: time, updatedAt: time,
    });
    options.notify(`Saved “${name}” as a personal template`);
  });
  get('builderDuplicate').addEventListener('click', () => {
    readDraft(); const time = timestamp();
    draft = syncCustomPartAssembly({ ...structuredClone(draft), id: newId(), name: `${draft.name} copy`, createdAt: time, updatedAt: time });
    editingExisting = false; writeDraft(); render(); options.notify('Duplicated as a new part — save it to create a separate record');
  });
  get('dimensionEditorConfirm').addEventListener('click', confirmEditor); get('dimensionEditorCancel').addEventListener('click', closeEditor);
  get('builderCentreHorizontal').addEventListener('click', () => { inputs.horizontalOffsetMm.value = '0'; render(); }); get('builderCentreVertical').addEventListener('click', () => { inputs.verticalOffsetMm.value = '0'; render(); });
  get('builderSwapEnds').addEventListener('click', () => { readDraft(); draft = syncCustomPartAssembly(swapTransitionEnds(draft)); writeDraft(); render(); options.notify('Ends and port profiles swapped; offsets and outlet orientation reversed'); });
  get('builderLoadRectExample').addEventListener('click', () => { draft = rectangularExamplePart(); editingExisting = false; writeDraft(); render(); fitCamera(); options.notify('Rectangular offset-transition example loaded'); });
  get('builderLoadExample').addEventListener('click', () => { draft = examplePart(); editingExisting = false; writeDraft(); render(); fitCamera(); options.notify('Example transition loaded'); });
  get('builderFitCamera').addEventListener('click', () => fitCamera(camera.position.clone().sub(controls?.target ?? new THREE.Vector3())));
  get('builderResetCamera').addEventListener('click', () => fitCamera());
  get('builderCentreline').addEventListener('change', render);
  get('builderPdf').addEventListener('click', () => { readDraft(); const errors = validateCustomPart(draft); if (Object.keys(errors).length) { render(); options.notify('Correct the highlighted measurements before exporting'); return; } draft = syncCustomPartAssembly(draft); downloadCustomPartPdf(draft); options.notify('Two-page custom fitting PDF created'); });
  get('builderSave').addEventListener('click', () => { readDraft(); const errors = validateCustomPart(draft); if (Object.keys(errors).length) { render(); options.notify('Correct the highlighted measurements before saving'); return; } draft = syncCustomPartAssembly(draft); options.onSave(structuredClone(draft)); });

  writeDraft(); render(); fitCamera(); showLibrary();
  return {
    load(part, existing = Boolean(part)) {
      if (!part) { showLibrary(); return; }              // no part -> template library
      draft = structuredClone(part); editingExisting = existing; selectedPortId = null;
      writeDraft(); showEditor(); render(); window.setTimeout(() => fitCamera(), 0);
    },
    setActive(value) { active = value; if (active && mode === 'editor') window.setTimeout(() => { resize(); fitCamera(); }, 0); },
    dispose() { resizeObserver.disconnect(); disposeObject(); controls?.dispose(); renderer?.dispose(); },
  };
}
