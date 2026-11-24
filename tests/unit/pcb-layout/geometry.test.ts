import { describe, expect, it } from 'vitest';

import {
  boundsOfPointsMm,
  isSimplePolygonMm,
  milToMm,
  mmToMil,
  normalizeAngleDeg,
  pointInPolygonMm,
  polygonSignedAreaMm2,
  polygonsIntersectMm,
  rotatePointMm,
  transformPointMm,
  transformPolygonMm,
} from '../../../src/pcb-layout/geometry.js';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('normalized PCB geometry', () => {
  it('normalizes counter-clockwise angles without negative zero', () => {
    expect(normalizeAngleDeg(-90)).toBe(270);
    expect(normalizeAngleDeg(450)).toBe(90);
    expect(normalizeAngleDeg(-360)).toBe(0);
    expect(Object.is(normalizeAngleDeg(-0), -0)).toBe(false);
    expect(() => normalizeAngleDeg(Number.NaN)).toThrow(RangeError);
  });

  it('converts between native mil and normalized millimeters', () => {
    expect(milToMm(1)).toBeCloseTo(0.0254, 12);
    expect(mmToMil(2.54)).toBeCloseTo(100, 12);
    expect(mmToMil(milToMm(1234.5))).toBeCloseTo(1234.5, 10);
  });

  it('rotates and transforms points in the documented x-right/y-up frame', () => {
    expect(rotatePointMm({ x: 2, y: 1 }, 90)).toEqual({ x: -1, y: 2 });
    expect(rotatePointMm({ x: 2, y: 1 }, 180)).toEqual({ x: -2, y: -1 });
    expect(transformPointMm({ x: 2, y: 0 }, { x: 10, y: 5 }, 90)).toEqual({ x: 10, y: 7 });
    expect(transformPolygonMm(square.slice(0, 3), { x: 1, y: 2 }, 90)).toEqual([
      { x: 1, y: 2 },
      { x: 1, y: 12 },
      { x: -9, y: 12 },
    ]);
  });

  it('computes signed area and axis-aligned bounds', () => {
    expect(polygonSignedAreaMm2(square)).toBe(100);
    expect(polygonSignedAreaMm2([...square].reverse())).toBe(-100);
    expect(
      polygonSignedAreaMm2([
        { x: 1_000_000_000_000, y: 1_000_000_000_000 },
        { x: 1_000_000_000_010, y: 1_000_000_000_000 },
        { x: 1_000_000_000_010, y: 1_000_000_000_010 },
        { x: 1_000_000_000_000, y: 1_000_000_000_010 },
      ]),
    ).toBe(100);
    expect(boundsOfPointsMm(square)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(
      boundsOfPointsMm([
        { x: -2, y: 4 },
        { x: 3, y: -1 },
      ]),
    ).toEqual({
      minX: -2,
      minY: -1,
      maxX: 3,
      maxY: 4,
    });
  });

  it('includes polygon boundaries and detects overlap or edge contact', () => {
    expect(pointInPolygonMm({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygonMm({ x: 10, y: 5 }, square)).toBe(true);
    expect(pointInPolygonMm({ x: 11, y: 5 }, square)).toBe(false);
    expect(
      polygonsIntersectMm(square, [
        { x: 10, y: 2 },
        { x: 12, y: 2 },
        { x: 12, y: 4 },
        { x: 10, y: 4 },
      ]),
    ).toBe(true);
    expect(
      polygonsIntersectMm(square, [
        { x: 11, y: 11 },
        { x: 12, y: 11 },
        { x: 12, y: 12 },
        { x: 11, y: 12 },
      ]),
    ).toBe(false);
  });

  it('rejects degenerate polygons and non-finite coordinates', () => {
    expect(
      isSimplePolygonMm([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBe(false);
    expect(
      isSimplePolygonMm([
        { x: 0, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
        { x: 3, y: 0 },
      ]),
    ).toBe(false);
    expect(
      isSimplePolygonMm([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(false);
    expect(() => rotatePointMm({ x: Number.POSITIVE_INFINITY, y: 0 }, 0)).toThrow(RangeError);
    expect(() => boundsOfPointsMm([])).toThrow(RangeError);
  });
});
