import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { profileForEnd, syncCustomPartAssembly } from './custom-part-assembly';
import { downloadCustomPartPdf } from './custom-part-pdf';
import { buildTransitionGeometry, classifyTransition, swapTransitionEnds, validateCustomPart, type TransitionGeometry } from './transition-geometry';
import { renderTechnicalView, type GridSize } from './transition-views';
import type { CustomPart, CustomPartType, VerificationStatus } from './types';

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
  notify(message: string): void;
}

function timestamp(): string { return new Date().toISOString(); }
function newId(): string { return `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function examplePart(): CustomPart {
  const time = timestamp();
  const part = { id: newId(), name: 'Eccentric rectangular to round transition', partNumber: '', partType: 'rectangular-to-round-transition', endAWidthMm: 500, endAHeightMm: 300, endADiameterMm: 300, endBWidthMm: 300, endBHeightMm: 200, endBDiameterMm: 250, lengthMm: 600, horizontalOffsetMm: 100, verticalOffsetMm: 50, outletHorizontalAngleDeg: 12, outletVerticalAngleDeg: -6, outletRotationDeg: 0, quantity: 1, system: 'Supply air', material: 'Galvanized steel', thicknessMm: 0.7, notes: '', createdAt: time, updatedAt: time, verificationStatus: 'suggested' as VerificationStatus } as CustomPart;
  return syncCustomPartAssembly(part);
}
function blankPart(): CustomPart {
  const part = examplePart();
  return syncCustomPartAssembly({ ...part, id: newId(), name: 'Rectangular centred reducer', partType: 'rectangular-transition', horizontalOffsetMm: 0, verticalOffsetMm: 0, outletHorizontalAngleDeg: 0, outletVerticalAngleDeg: 0, createdAt: timestamp(), updatedAt: timestamp() });
}
function htmlEscape(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character); }

export function initCustomPartBuilder(root: HTMLElement, options: BuilderOptions): BuilderController {
  root.innerHTML = `<div class="builder-shell">
    <aside class="builder-controls">
      <div class="builder-heading"><div><span class="eyebrow">Parametric assembly</span><h2 id="builderTitle">Transition</h2></div><button id="builderLoadExample" class="btn">Load R→Ø Example</button></div>
      <label class="field"><span class="label">Part type</span><select id="builderPartType" class="select"><option value="rectangular-transition">Rectangular → rectangular</option><option value="rectangular-to-round-transition">Rectangular → round</option><option value="round-to-rectangular-transition">Round → rectangular</option></select></label>
      <label class="field"><span class="label">Part name</span><input id="builderName" class="input" maxlength="120"><span class="error" data-error="name"></span></label>
      <label class="field"><span class="label">Part number (optional)</span><input id="builderPartNumber" class="input" maxlength="80"></label>
      <div class="suggestion-box"><span>Suggested classification</span><strong id="builderClassification"></strong></div>
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
      <div class="inline"><label class="field"><span class="label">Quantity</span><input id="builderQuantity" class="input" type="number" min="1" max="10000"><span class="error" data-error="quantity"></span></label><label class="field"><span class="label">System</span><select id="builderSystem" class="select">${SYSTEMS.map((value) => `<option>${value}</option>`).join('')}</select></label></div>
      <div class="inline"><label class="field"><span class="label">Material</span><select id="builderMaterial" class="select">${MATERIALS.map((value) => `<option>${value}</option>`).join('')}</select></label><label class="field"><span class="label">Thickness (mm)</span><input id="builderThickness" class="input" type="number" min="0.1" max="20" step="0.1"><span class="error" data-error="thicknessMm"></span></label></div>
      <label class="field"><span class="label">Verification</span><select id="builderVerification" class="select"><option value="suggested">Suggested</option><option value="verified">Verified</option></select></label>
      <label class="field"><span class="label">Notes</span><textarea id="builderNotes" class="input" rows="2" maxlength="500"></textarea></label>
      <div class="button-row"><button id="builderSwapEnds" class="btn">Swap End A / B</button><button id="builderNew" class="btn ghost">New part</button><button id="builderPdf" class="btn">Export drawing PDF</button></div>
      <button id="builderSave" class="btn primary builder-save">Save Custom Part</button>
    </aside>
    <section class="builder-visuals">
      <div class="builder-preview-panel"><div class="panel-header"><div><h2>Assembly 3D preview</h2><span id="builderEditingStatus" class="badge">New part</span></div><div class="preview-actions"><button class="btn small" data-camera="front">Front</button><button class="btn small" data-camera="top">Top</button><button class="btn small" data-camera="side">Side</button><button class="btn small" data-camera="iso">Isometric</button><button id="builderFitCamera" class="btn small">Fit</button><button id="builderResetCamera" class="btn small">Reset</button></div></div><div id="builder3d" class="builder-3d" aria-label="Interactive 3D custom HVAC fitting preview"></div><label class="toggle-row"><input id="builderCentreline" type="checkbox" checked> Show 3D centreline</label></div>
      <div id="builderMetrics" class="builder-metrics"></div>
      <div class="technical-toolbar"><label><input id="builderShowDimensions" type="checkbox" checked> Show dimensions</label><label>Grid <select id="builderGrid" class="select compact"><option value="0">Off</option><option value="10">10 mm</option><option value="50" selected>50 mm</option><option value="100">100 mm</option></select></label></div>
      <div id="builderTechnicalViews" class="technical-grid"></div>
    </section>
  </div>`;

  const get = <T extends HTMLElement>(id: string): T => { const value = root.querySelector<T>(`#${id}`); if (!value) throw new Error(`Missing builder element ${id}`); return value; };
  const inputs: Record<NumericKey, HTMLInputElement> = {
    endAWidthMm: get('builderEndAWidth'), endAHeightMm: get('builderEndAHeight'), endADiameterMm: get('builderEndADiameter'), endBWidthMm: get('builderEndBWidth'), endBHeightMm: get('builderEndBHeight'), endBDiameterMm: get('builderEndBDiameter'), lengthMm: get('builderLength'), horizontalOffsetMm: get('builderHorizontalOffset'), verticalOffsetMm: get('builderVerticalOffset'), outletHorizontalAngleDeg: get('builderHorizontalAngle'), outletVerticalAngleDeg: get('builderVerticalAngle'), outletRotationDeg: get('builderOutletRotation'), quantity: get('builderQuantity'), thicknessMm: get('builderThickness'),
  };
  const partTypeInput = get<HTMLSelectElement>('builderPartType'); const nameInput = get<HTMLInputElement>('builderName'); const partNumberInput = get<HTMLInputElement>('builderPartNumber'); const systemInput = get<HTMLSelectElement>('builderSystem'); const materialInput = get<HTMLSelectElement>('builderMaterial'); const notesInput = get<HTMLTextAreaElement>('builderNotes'); const verificationInput = get<HTMLSelectElement>('builderVerification');
  const preview = get<HTMLDivElement>('builder3d'); const technical = get<HTMLDivElement>('builderTechnicalViews'); const metrics = get<HTMLDivElement>('builderMetrics');
  let draft = blankPart(); let active = false; let editingExisting = false; let currentObject: THREE.Group | null = null; let renderTimer = 0;

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
    const indices: number[] = [];
    geometry.sideFaces.forEach(([a, b, c, d]) => indices.push(a, b, c, a, c, d));
    const bodyGeometry = new THREE.BufferGeometry(); bodyGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); bodyGeometry.setIndex(indices); bodyGeometry.computeVertexNormals();
    const body = new THREE.Mesh(bodyGeometry, new THREE.MeshStandardMaterial({ color: 0x5b9fc4, metalness: .45, roughness: .48, side: THREE.DoubleSide, transparent: true, opacity: .88 })); group.add(body);
    const edgesGeometry = new THREE.EdgesGeometry(bodyGeometry, 15); group.add(new THREE.LineSegments(edgesGeometry, new THREE.LineBasicMaterial({ color: 0xd8efff })));
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

  function readDraft(): void {
    NUMERIC_KEYS.forEach((key) => { draft[key] = Number(inputs[key].value) as never; });
    draft.partType = partTypeInput.value as CustomPartType; draft.name = nameInput.value; draft.partNumber = partNumberInput.value.trim(); draft.system = systemInput.value; draft.material = materialInput.value; draft.notes = notesInput.value; draft.verificationStatus = verificationInput.value as VerificationStatus; draft.updatedAt = timestamp();
  }
  function writeDraft(): void {
    NUMERIC_KEYS.forEach((key) => { inputs[key].value = String(draft[key]); }); partTypeInput.value = draft.partType; nameInput.value = draft.name; partNumberInput.value = draft.partNumber ?? ''; systemInput.value = draft.system; materialInput.value = draft.material; notesInput.value = draft.notes; verificationInput.value = draft.verificationStatus;
    get('builderEditingStatus').textContent = editingExisting ? 'Editing' : 'New part';
  }
  function render(): void {
    readDraft(); const errors = validateCustomPart(draft); root.querySelectorAll<HTMLElement>('[data-error]').forEach((element) => { const key = element.dataset.error as keyof CustomPart; element.textContent = errors[key] ?? ''; });
    const profileA = profileForEnd(draft, 'a'); const profileB = profileForEnd(draft, 'b'); get('builderEndARect').classList.toggle('hidden', profileA !== 'rectangular'); get('builderEndARound').classList.toggle('hidden', profileA !== 'round'); get('builderEndBRect').classList.toggle('hidden', profileB !== 'rectangular'); get('builderEndBRound').classList.toggle('hidden', profileB !== 'round');
    get('builderTitle').textContent = partTypeInput.selectedOptions[0]?.textContent ?? 'Transition'; get('builderClassification').textContent = classifyTransition(draft);
    if (Object.keys(errors).length) { get<HTMLButtonElement>('builderSave').disabled = true; get<HTMLButtonElement>('builderPdf').disabled = true; return; }
    get<HTMLButtonElement>('builderSave').disabled = false; get<HTMLButtonElement>('builderPdf').disabled = false; draft = syncCustomPartAssembly(draft); const geometry = buildTransitionGeometry(draft); create3d(geometry);
    const showDimensions = get<HTMLInputElement>('builderShowDimensions').checked; const grid = Number(get<HTMLSelectElement>('builderGrid').value) as GridSize;
    technical.innerHTML = renderTechnicalView(draft, geometry, 'front', showDimensions, grid) + renderTechnicalView(draft, geometry, 'top', showDimensions, grid) + renderTechnicalView(draft, geometry, 'side', showDimensions, grid);
    const sizeA = profileA === 'round' ? `Ø${draft.endADiameterMm}` : `${draft.endAWidthMm} × ${draft.endAHeightMm}`; const sizeB = profileB === 'round' ? `Ø${draft.endBDiameterMm}` : `${draft.endBWidthMm} × ${draft.endBHeightMm}`; const direction = geometry.ports[1].direction;
    metrics.innerHTML = `<div><span>Port P1</span><b>${sizeA} mm</b></div><div><span>Port P2</span><b>${sizeB} mm</b></div><div><span>Body / centreline</span><b>${draft.lengthMm} / ${geometry.centrelineLengthMm.toFixed(1)} mm</b></div><div><span>Offsets X / Y</span><b>${draft.horizontalOffsetMm > 0 ? '+' : ''}${draft.horizontalOffsetMm} / ${draft.verticalOffsetMm > 0 ? '+' : ''}${draft.verticalOffsetMm} mm</b></div><div><span>P2 direction</span><b>${direction.x.toFixed(3)}, ${direction.y.toFixed(3)}, ${direction.z.toFixed(3)}</b></div><div><span>Surface area</span><b>${geometry.surfaceAreaM2.toFixed(3)} m²</b></div><p>Geometric estimates only; verify all ports, angles and dimensions before fabrication.</p>`;
    renderer?.render(scene, camera);
  }
  function scheduleRender(): void { window.clearTimeout(renderTimer); renderTimer = window.setTimeout(render, 70); }
  root.addEventListener('input', scheduleRender); root.addEventListener('change', scheduleRender);
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement; const adjust = target.dataset.adjust as NumericKey | undefined;
    if (adjust) { inputs[adjust].value = String((Number(inputs[adjust].value) || 0) + Number(target.dataset.delta)); render(); }
    const cameraView = target.dataset.camera; if (cameraView) setCamera(cameraView);
  });
  get('builderCentreHorizontal').addEventListener('click', () => { inputs.horizontalOffsetMm.value = '0'; render(); }); get('builderCentreVertical').addEventListener('click', () => { inputs.verticalOffsetMm.value = '0'; render(); });
  get('builderSwapEnds').addEventListener('click', () => { readDraft(); draft = syncCustomPartAssembly(swapTransitionEnds(draft)); writeDraft(); render(); options.notify('Ends and port profiles swapped; offsets and outlet orientation reversed'); });
  get('builderLoadExample').addEventListener('click', () => { draft = examplePart(); editingExisting = false; writeDraft(); render(); fitCamera(); options.notify('Example transition loaded'); });
  get('builderNew').addEventListener('click', () => { draft = blankPart(); editingExisting = false; writeDraft(); render(); fitCamera(); });
  get('builderFitCamera').addEventListener('click', () => fitCamera(camera.position.clone().sub(controls?.target ?? new THREE.Vector3())));
  get('builderResetCamera').addEventListener('click', () => fitCamera());
  get('builderCentreline').addEventListener('change', render);
  get('builderPdf').addEventListener('click', () => { readDraft(); const errors = validateCustomPart(draft); if (Object.keys(errors).length) { render(); options.notify('Correct the highlighted measurements before exporting'); return; } draft = syncCustomPartAssembly(draft); downloadCustomPartPdf(draft); options.notify('Two-page custom fitting PDF created'); });
  get('builderSave').addEventListener('click', () => { readDraft(); const errors = validateCustomPart(draft); if (Object.keys(errors).length) { render(); options.notify('Correct the highlighted measurements before saving'); return; } draft = syncCustomPartAssembly(draft); options.onSave(structuredClone(draft)); });

  writeDraft(); render(); fitCamera();
  return {
    load(part, existing = Boolean(part)) { draft = structuredClone(part ?? blankPart()); editingExisting = existing; writeDraft(); render(); window.setTimeout(() => fitCamera(), 0); },
    setActive(value) { active = value; if (active) window.setTimeout(() => { resize(); fitCamera(); }, 0); },
    dispose() { resizeObserver.disconnect(); disposeObject(); controls?.dispose(); renderer?.dispose(); },
  };
}
