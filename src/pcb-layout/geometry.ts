import type { PcbPointMm } from './normalized-model.js';

export interface PcbBoundsMm {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const GEOMETRY_EPSILON_MM = 1e-9;

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function assertFinitePoint(point: PcbPointMm, name = 'point'): void {
  assertFiniteNumber(point.x, `${name}.x`);
  assertFiniteNumber(point.y, `${name}.y`);
}

function assertValidPolygon(vertices: readonly PcbPointMm[]): void {
  if (!isSimplePolygonMm(vertices)) {
    throw new RangeError('polygon must be simple and non-degenerate');
  }
}

function cross(a: PcbPointMm, b: PcbPointMm, c: PcbPointMm): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point: PcbPointMm, a: PcbPointMm, b: PcbPointMm): boolean {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (Math.abs(cross(a, b, point)) > GEOMETRY_EPSILON_MM * Math.max(1, length)) return false;
  const projection = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
  const lengthSquared = length * length;
  const tolerance = GEOMETRY_EPSILON_MM * Math.max(1, length);
  return projection >= -tolerance && projection <= lengthSquared + tolerance;
}

function segmentsIntersect(
  a1: PcbPointMm,
  a2: PcbPointMm,
  b1: PcbPointMm,
  b2: PcbPointMm,
): boolean {
  const abLength = Math.hypot(a2.x - a1.x, a2.y - a1.y);
  const cdLength = Math.hypot(b2.x - b1.x, b2.y - b1.y);
  const tolerance = GEOMETRY_EPSILON_MM * Math.max(1, abLength, cdLength);
  const o1 = cross(a1, a2, b1);
  const o2 = cross(a1, a2, b2);
  const o3 = cross(b1, b2, a1);
  const o4 = cross(b1, b2, a2);

  if (Math.abs(o1) <= tolerance && pointOnSegment(b1, a1, a2)) return true;
  if (Math.abs(o2) <= tolerance && pointOnSegment(b2, a1, a2)) return true;
  if (Math.abs(o3) <= tolerance && pointOnSegment(a1, b1, b2)) return true;
  if (Math.abs(o4) <= tolerance && pointOnSegment(a2, b1, b2)) return true;
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

/** Normalize a counter-clockwise angle to [0, 360), rejecting non-finite values. */
export function normalizeAngleDeg(angleDeg: number): number {
  assertFiniteNumber(angleDeg, 'angleDeg');
  const normalized = ((angleDeg % 360) + 360) % 360;
  return Math.abs(normalized) < 1e-12 || Math.abs(normalized - 360) < 1e-12 ? 0 : normalized;
}

/** Convert native PCB mil to canonical millimeters (1 mil = 0.0254 mm). */
export function milToMm(mils: number): number {
  assertFiniteNumber(mils, 'mils');
  const result = mils * 0.0254;
  assertFiniteNumber(result, 'converted millimeters');
  return result;
}

/** Convert canonical millimeters to native PCB mil (1 mm = 1000 / 25.4 mil). */
export function mmToMil(millimeters: number): number {
  assertFiniteNumber(millimeters, 'millimeters');
  const result = millimeters / 0.0254;
  assertFiniteNumber(result, 'converted mils');
  return result;
}

/** Rotate a point about the design origin in the normalized x-right/y-up frame. */
export function rotatePointMm(point: PcbPointMm, angleDeg: number): PcbPointMm {
  assertFinitePoint(point);
  const radians = (normalizeAngleDeg(angleDeg) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const snapQuarterTurn = (value: number) =>
    Math.abs(value) < 1e-12 ? 0 : Math.abs(Math.abs(value) - 1) < 1e-12 ? Math.sign(value) : value;
  const result = {
    x: point.x * snapQuarterTurn(cosine) - point.y * snapQuarterTurn(sine),
    y: point.x * snapQuarterTurn(sine) + point.y * snapQuarterTurn(cosine),
  };
  assertFinitePoint(result, 'rotated point');
  return result;
}

/** Rotate a local point, then translate it to the component's design-frame position. */
export function transformPointMm(
  localPointMm: PcbPointMm,
  positionMm: PcbPointMm,
  rotationDeg: number,
): PcbPointMm {
  assertFinitePoint(positionMm, 'positionMm');
  const rotated = rotatePointMm(localPointMm, rotationDeg);
  const result = { x: positionMm.x + rotated.x, y: positionMm.y + rotated.y };
  assertFinitePoint(result, 'transformed point');
  return result;
}

/** Shoelace signed area: positive for counter-clockwise rings and negative for clockwise rings. */
export function polygonSignedAreaMm2(vertices: readonly PcbPointMm[]): number {
  if (vertices.length < 3) throw new RangeError('polygon must have at least three vertices');
  vertices.forEach((point, index) => assertFinitePoint(point, `vertices[${index}]`));
  const origin = vertices[0];
  if (!origin) throw new RangeError('polygon vertex is missing');
  let twiceArea = 0;
  for (let index = 1; index < vertices.length - 1; index += 1) {
    const current = vertices[index];
    const next = vertices[index + 1];
    if (!current || !next) throw new RangeError('polygon vertex is missing');
    twiceArea += cross(origin, current, next);
  }
  const area = twiceArea / 2;
  assertFiniteNumber(area, 'polygon area');
  return area;
}

/** Return true only for a finite, non-self-intersecting polygon with non-zero area. */
export function isSimplePolygonMm(vertices: readonly PcbPointMm[]): boolean {
  try {
    if (vertices.length < 3) return false;
    vertices.forEach((point) => assertFinitePoint(point));
    if (Math.abs(polygonSignedAreaMm2(vertices)) <= GEOMETRY_EPSILON_MM ** 2) return false;

    for (let index = 0; index < vertices.length; index += 1) {
      const previous = vertices[(index + vertices.length - 1) % vertices.length];
      const current = vertices[index];
      const next = vertices[(index + 1) % vertices.length];
      if (!previous || !current || !next) return false;
      if (pointOnSegment(next, previous, current) || pointOnSegment(previous, current, next)) {
        return false;
      }
    }

    for (let index = 0; index < vertices.length; index += 1) {
      const next = (index + 1) % vertices.length;
      const start = vertices[index];
      const end = vertices[next];
      if (!start || !end) return false;
      if (Math.hypot(end.x - start.x, end.y - start.y) <= GEOMETRY_EPSILON_MM) return false;

      for (let otherIndex = index + 1; otherIndex < vertices.length; otherIndex += 1) {
        const otherNext = (otherIndex + 1) % vertices.length;
        if (otherIndex === index || otherIndex === next || otherNext === index) continue;
        const otherStart = vertices[otherIndex];
        const otherEnd = vertices[otherNext];
        if (otherStart && otherEnd && segmentsIntersect(start, end, otherStart, otherEnd))
          return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Axis-aligned bounds for a non-empty collection of finite points. */
export function boundsOfPointsMm(points: readonly PcbPointMm[]): PcbBoundsMm {
  if (points.length === 0) throw new RangeError('at least one point is required');
  points.forEach((point, index) => assertFinitePoint(point, `points[${index}]`));
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

/** Transform a footprint-local simple polygon into the normalized design frame. */
export function transformPolygonMm(
  vertices: readonly PcbPointMm[],
  positionMm: PcbPointMm,
  rotationDeg: number,
): PcbPointMm[] {
  assertValidPolygon(vertices);
  const transformed = vertices.map((vertex) => transformPointMm(vertex, positionMm, rotationDeg));
  assertValidPolygon(transformed);
  return transformed;
}

/** Point-in-polygon test; a point on the boundary is considered inside. */
export function pointInPolygonMm(point: PcbPointMm, polygon: readonly PcbPointMm[]): boolean {
  assertFinitePoint(point);
  assertValidPolygon(polygon);
  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    if (!current || !previous) throw new RangeError('polygon vertex is missing');
    if (pointOnSegment(point, previous, current)) return true;
    const crossesRay = current.y > point.y !== previous.y > point.y;
    if (crossesRay) {
      const intersectionX =
        ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
      if (point.x < intersectionX) inside = !inside;
    }
  }
  return inside;
}

/** Polygon intersection includes edge and vertex contact; it does not calculate clearance. */
export function polygonsIntersectMm(
  left: readonly PcbPointMm[],
  right: readonly PcbPointMm[],
): boolean {
  assertValidPolygon(left);
  assertValidPolygon(right);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const leftStart = left[leftIndex];
    const leftEnd = left[(leftIndex + 1) % left.length];
    if (!leftStart || !leftEnd) throw new RangeError('left polygon vertex is missing');
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const rightStart = right[rightIndex];
      const rightEnd = right[(rightIndex + 1) % right.length];
      if (!rightStart || !rightEnd) throw new RangeError('right polygon vertex is missing');
      if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) return true;
    }
  }
  const leftFirst = left[0];
  const rightFirst = right[0];
  if (!leftFirst || !rightFirst) throw new RangeError('polygon vertex is missing');
  return pointInPolygonMm(leftFirst, right) || pointInPolygonMm(rightFirst, left);
}
