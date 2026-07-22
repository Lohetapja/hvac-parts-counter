import { buildPlenumGeometry, plenumBody, portSizeLabel } from './plenum-geometry';
import type { CustomPart, Vector3 } from './types';

// Technical SVG views for the plenum family, generated from the same
// buildPlenumGeometry() output used by the 3D preview and the PDF export.

type View = 'isometric' | 'front' | 'top' | 'side';

function project(point: Vector3, view: View): { x: number; y: number } {
  if (view === 'isometric') return { x: (point.x - point.z) * .72, y: -point.y - (point.x + point.z) * .32 };
  if (view === 'front') return { x: point.x, y: -point.y };
  if (view === 'top') return { x: point.x, y: point.z };
  return { x: -point.z, y: -point.y };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c] ?? c);
}

export function renderPlenumViews(part: CustomPart, showDimensions: boolean): string {
  return (['isometric', 'front', 'top', 'side'] as View[]).map((view) => renderView(part, view, showDimensions)).join('');
}

function renderView(part: CustomPart, view: View, showDimensions: boolean): string {
  const geometry = buildPlenumGeometry(part);
  const body = plenumBody(part);
  const pts = geometry.corners.map((c) => project(c, view));
  const portPts = geometry.ports.flatMap((p) => [...p.outline, ...p.outerRing].map((q) => project(q, view)));
  const inletPts = geometry.inlet ? [...geometry.inlet.outline, ...geometry.inlet.outerRing].map((q) => project(q, view)) : [];
  const all = [...pts, ...portPts, ...inletPts];
  const minX = Math.min(...all.map((p) => p.x)); const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y)); const maxY = Math.max(...all.map((p) => p.y));
  const pad = Math.max(60, (maxX - minX) * 0.12);
  const vb = `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${(maxX - minX + pad * 2).toFixed(1)} ${(maxY - minY + pad * 2).toFixed(1)}`;

  // Body outline for this view (axis-aligned box projection).
  const bx = [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))];
  const by = [Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))];
  let svg = `<rect class="profile" x="${bx[0]}" y="${by[0]}" width="${bx[1] - bx[0]}" height="${by[1] - by[0]}"/>`;

  // Port footprints + projected connector outlines, labelled with their identifiers.
  const drawPort = (outline: Vector3[], ring: Vector3[], centre: Vector3, id: string, cls: string, locked: boolean): void => {
    const o = outline.map((p) => project(p, view)); const r = ring.map((p) => project(p, view));
    svg += `<polygon class="${cls}" points="${o.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"/>`;
    svg += `<polygon class="transition-edge" fill="none" points="${r.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"/>`;
    for (let i = 0; i < o.length; i += Math.max(1, Math.floor(o.length / 4))) {
      svg += `<line class="transition-edge" x1="${o[i].x.toFixed(1)}" y1="${o[i].y.toFixed(1)}" x2="${r[i].x.toFixed(1)}" y2="${r[i].y.toFixed(1)}"/>`;
    }
    const c = project(centre, view);
    svg += `<text class="port-id" x="${(c.x + 6).toFixed(1)}" y="${(c.y - 6).toFixed(1)}">${escapeHtml(id)}${locked ? ' · LOCK' : ''}</text>`;
  };
  const isLocked = (locks: import('./types').ElementLockState | undefined): boolean => Boolean(locks && (locks.grounded || locks.position.x || locks.position.y || locks.position.z || locks.profileLocked));
  if (geometry.inlet) drawPort(geometry.inlet.outline, geometry.inlet.outerRing, geometry.inlet.centre, geometry.inlet.port.id, 'end-a', isLocked(part.portALocks));
  geometry.ports.forEach((p) => drawPort(p.outline, p.outerRing, p.centre, p.port.id, 'end-b', isLocked(p.port.locks)));

  if (showDimensions) {
    const w = view === 'side' ? body.depth : body.width;
    const h = view === 'top' ? body.depth : body.height;
    svg += `<text x="${((bx[0] + bx[1]) / 2).toFixed(1)}" y="${(by[0] - 14).toFixed(1)}" text-anchor="middle">${w} mm</text>`;
    svg += `<text x="${(bx[1] + 14).toFixed(1)}" y="${((by[0] + by[1]) / 2).toFixed(1)}">${h} mm</text>`;
  }
  const caption = view === 'isometric' ? 'ISOMETRIC' : view === 'front' ? 'FRONT' : view === 'top' ? 'TOP' : 'SIDE';
  return `<figure class="technical-view"><svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${svg}</svg><figcaption>${caption}${part.bodyLocks?.grounded ? ' · BODY GROUNDED' : ''}</figcaption></figure>`;
}

export function portScheduleRows(part: CustomPart): Array<{ id: string; role: string; profile: string; size: string; face: string; position: string; projection: string; rotation: string }> {
  const geometry = buildPlenumGeometry(part);
  const rows = [] as ReturnType<typeof portScheduleRows>;
  const push = (p: { port: import('./types').PlenumPort; centre: Vector3 }): void => {
    rows.push({
      id: p.port.id, role: p.port.role, profile: p.port.shape, size: portSizeLabel(p.port), face: p.port.face,
      position: `${p.centre.x.toFixed(0)}, ${p.centre.y.toFixed(0)}, ${p.centre.z.toFixed(0)}`,
      projection: `${p.port.projectionMm} mm`, rotation: `${p.port.rotationDeg}°`,
    });
  };
  if (geometry.inlet) push(geometry.inlet);
  geometry.ports.forEach(push);
  return rows;
}
