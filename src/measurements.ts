import type { Point, ProjectData, RouteItem } from './types';

export const PDF_POINT_MM = 25.4 / 72;

export function presetMmPerPdfPoint(scaleRatio: number): number {
  return PDF_POINT_MM * scaleRatio;
}

export function polylinePdfDistance(points: Point[]): number {
  return points.slice(1).reduce((sum, point, index) => {
    const previous = points[index];
    return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
}

export function routeLengthM(route: RouteItem, project: ProjectData): number {
  return polylinePdfDistance(route.points) * project.calibration.mmPerPdfPoint / 1000;
}

export function snapPoint(origin: Point, candidate: Point): Point {
  const dx = candidate.x - origin.x;
  const dy = candidate.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) return candidate;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: origin.x + Math.cos(angle) * distance, y: origin.y + Math.sin(angle) * distance };
}

export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}
