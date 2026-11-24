import { describe, expect, it } from 'vitest';
import { optimizeComponentPlacement } from '../../src/pcb/component-placement-optimizer.js';

const board = {
  outline: [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 30 },
    { x: 0, y: 30 },
  ],
  edgeClearanceMm: 1,
  componentClearanceMm: 1,
  gridMm: 0.5,
};

const square = [
  { x: -2, y: -2 },
  { x: 2, y: -2 },
  { x: 2, y: 2 },
  { x: -2, y: 2 },
];

describe('component placement optimizer', () => {
  it('places unplaced components inside the board without courtyard collisions', () => {
    const result = optimizeComponentPlacement([
      { ref: 'U1', courtyard: square, pads: [{ id: '1', x: 0, y: 0, net: 'N1' }] },
      { ref: 'R1', courtyard: square, pads: [{ id: '1', x: 0, y: 0, net: 'N1' }] },
    ], [{ name: 'N1', pins: [{ ref: 'U1', padId: '1' }, { ref: 'R1', padId: '1' }] }], board, {
      iterations: 500,
      seed: 17,
    });

    expect(result.status).toBe('PREVIEW_READY');
    expect(result.placements).toHaveLength(2);
    expect(result.metrics.totalHpwlMm).toBeGreaterThanOrEqual(0);
    expect(result.nativeWritePerformed).toBe(false);
    expect(result.requiresHumanApproval).toBe(true);
    expect(result.placements[0]?.x).not.toBe(result.placements[1]?.x);
  });

  it('keeps fixed components at their existing coordinates', () => {
    const result = optimizeComponentPlacement([
      { ref: 'J1', x: 10, y: 10, rotationDeg: 90, fixed: true, courtyard: square },
      { ref: 'R1', courtyard: square },
    ], [], board, { iterations: 200, seed: 5 });

    expect(result.status).toBe('PREVIEW_READY');
    expect(result.placements.find((item) => item.ref === 'J1')).toMatchObject({
      x: 10,
      y: 10,
      rotationDeg: 90,
      fixed: true,
    });
  });

  it('blocks a starting placement outside the board', () => {
    const result = optimizeComponentPlacement([
      { ref: 'U1', x: -20, y: -20, fixed: true, courtyard: square },
    ], [], board);

    expect(result.status).toBe('NO_FEASIBLE_PLACEMENT');
    expect(result.blockers.some((item) => item.includes('U1'))).toBe(true);
  });

  it('respects allowed rotations and locked orientation constraints', () => {
    const result = optimizeComponentPlacement([
      {
        ref: 'J1',
        courtyard: [
          { x: -4, y: -1 },
          { x: 4, y: -1 },
          { x: 4, y: 1 },
          { x: -4, y: 1 },
        ],
        allowedRotations: [90],
        rotationLocked: true,
      },
    ], [], board, { iterations: 300, seed: 8 });

    expect(result.status).toBe('PREVIEW_READY');
    expect(result.placements[0]?.rotationDeg).toBe(90);
  });

  it('keeps edge-constrained connectors close to the selected board edge', () => {
    const result = optimizeComponentPlacement([
      {
        ref: 'J1',
        courtyard: square,
        edgeConstraint: { side: 'LEFT', maxDistanceMm: 1.5 },
      },
    ], [], board, { iterations: 100, seed: 3 });

    expect(result.status).toBe('PREVIEW_READY');
    expect(result.placements[0]?.x).toBeLessThanOrEqual(3.5);
  });

  it('does not place components inside a keepout', () => {
    const result = optimizeComponentPlacement([
      { ref: 'U1', courtyard: square },
    ], [], {
      ...board,
      keepouts: [{
        id: 'HV_KEEP_OUT',
        points: [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 30 },
          { x: 0, y: 30 },
        ],
      }],
    }, { iterations: 100, maxInitialPlacementCandidates: 1000 });

    expect(result.status).toBe('PARTIAL');
    expect(result.placements).toHaveLength(0);
  });
});
