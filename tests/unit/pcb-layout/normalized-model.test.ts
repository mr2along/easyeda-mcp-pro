import { describe, expect, it } from 'vitest';

import {
  PcbModelInputError,
  parsePcbNormalizedModel,
  pcbNormalizedModelSchema,
} from '../../../src/pcb-layout/normalized-model.js';

const validModel = {
  schemaVersion: 1,
  coordinateFrame: {
    units: 'mm',
    origin: 'design',
    xAxis: 'right',
    yAxis: 'up',
    positiveRotation: 'counter-clockwise',
  },
  source: { system: 'fixture', documentId: 'board-1', revision: 'r1' },
  board: {
    outlineMm: [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 20 },
      { x: 0, y: 20 },
    ],
  },
  layers: [
    { id: 'top-copper', kind: 'copper', side: 'top' },
    { id: 'bottom-copper', kind: 'copper', side: 'bottom' },
  ],
  nets: [{ id: 'net-gnd', name: 'GND' }],
  components: [
    {
      id: 'component-c1',
      reference: 'C1',
      positionMm: { x: 5, y: 6 },
      rotationDeg: 450,
      side: 'top',
      footprint: {
        name: '0603',
        outlineMm: [
          { x: -0.8, y: -0.4 },
          { x: 0.8, y: -0.4 },
          { x: 0.8, y: 0.4 },
          { x: -0.8, y: 0.4 },
        ],
        pads: [
          {
            id: 'pad-1',
            number: '1',
            centerMm: { x: -0.75, y: 0 },
            shape: { kind: 'rectangle', widthMm: 0.6, heightMm: 0.8 },
            netId: 'net-gnd',
          },
        ],
      },
    },
  ],
  tracks: [
    {
      id: 'track-1',
      netId: 'net-gnd',
      layerId: 'top-copper',
      widthMm: 0.25,
      centerlineMm: [
        { x: 5, y: 6 },
        { x: 10, y: 6 },
      ],
    },
  ],
  vias: [
    {
      id: 'via-1',
      netId: 'net-gnd',
      centerMm: { x: 10, y: 6 },
      diameterMm: 0.6,
      drillMm: 0.3,
      layerIds: ['top-copper', 'bottom-copper'],
    },
  ],
  keepouts: [
    {
      id: 'keepout-1',
      outlineMm: [
        { x: 15, y: 5 },
        { x: 20, y: 5 },
        { x: 20, y: 10 },
        { x: 15, y: 10 },
      ],
      purpose: 'both',
      layerIds: ['top-copper'],
    },
  ],
} as const;

describe('normalized PCB data contract', () => {
  it('accepts canonical millimeter data and normalizes rotations', () => {
    const parsed = parsePcbNormalizedModel(validModel);

    expect(parsed.coordinateFrame).toEqual({
      units: 'mm',
      origin: 'design',
      xAxis: 'right',
      yAxis: 'up',
      positiveRotation: 'counter-clockwise',
    });
    expect(parsed.components[0]?.rotationDeg).toBe(90);
    expect(parsed.tracks[0]?.centerlineMm).toHaveLength(2);
  });

  it('rejects native mil data unless it has been converted to the canonical frame', () => {
    const result = pcbNormalizedModelSchema.safeParse({
      ...validModel,
      coordinateFrame: { ...validModel.coordinateFrame, units: 'mil' },
    });

    expect(result.success).toBe(false);
  });

  it('rejects duplicate identifiers and unknown layer or net references', () => {
    const invalid = {
      ...validModel,
      tracks: [
        ...validModel.tracks,
        { ...validModel.tracks[0], id: 'track-1', layerId: 'missing-layer', netId: 'missing-net' },
      ],
    };

    expect(() => parsePcbNormalizedModel(invalid)).toThrow(PcbModelInputError);
    expect(() => parsePcbNormalizedModel(invalid)).toThrow(/duplicate tracks id/);
    expect(() => parsePcbNormalizedModel(invalid)).toThrow(/unknown layer id/);
    expect(() => parsePcbNormalizedModel(invalid)).toThrow(/unknown net id/);
  });

  it('rejects self-intersecting board outlines', () => {
    const result = pcbNormalizedModelSchema.safeParse({
      ...validModel,
      board: {
        outlineMm: [
          { x: 0, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
          { x: 3, y: 0 },
        ],
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'board.outlineMm')).toBe(
        true,
      );
    }
  });

  it('rejects non-positive dimensions and impossible via drill sizes', () => {
    expect(() =>
      parsePcbNormalizedModel({
        ...validModel,
        tracks: [{ ...validModel.tracks[0], widthMm: 0 }],
      }),
    ).toThrow(PcbModelInputError);

    const result = pcbNormalizedModelSchema.safeParse({
      ...validModel,
      vias: [{ ...validModel.vias[0], drillMm: 0.6 }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'vias.0.drillMm')).toBe(
        true,
      );
    }
  });

  it('rejects duplicate component references and coordinates outside finite numbers', () => {
    const invalid = {
      ...validModel,
      components: [...validModel.components, { ...validModel.components[0], id: 'component-c2' }],
    };

    expect(() => parsePcbNormalizedModel(invalid)).toThrow(/duplicate component reference/);
    expect(() =>
      parsePcbNormalizedModel({
        ...validModel,
        board: {
          outlineMm: [
            { x: 0, y: 0 },
            { x: Number.NaN, y: 0 },
            { x: 0, y: 1 },
          ],
        },
      }),
    ).toThrow(PcbModelInputError);
  });
});
