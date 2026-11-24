import { z } from 'zod';

import { isSimplePolygonMm, normalizeAngleDeg } from './geometry.js';

/** A point in the normalized PCB design frame, measured in millimeters. */
export interface PcbPointMm {
  x: number;
  y: number;
}

export type PcbPolygonMm = PcbPointMm[];

const finiteNumber = z.number().finite();
const positiveMm = finiteNumber.positive();
const pointSchema = z.object({ x: finiteNumber, y: finiteNumber }).strict();
const polygonSchema = z
  .array(pointSchema)
  .min(3)
  .refine((points) => isSimplePolygonMm(points), 'must be a simple, non-degenerate polygon');
const polylineSchema = z
  .array(pointSchema)
  .min(2)
  .refine(
    (points) => points.every((point, index) => index === 0 || !samePoint(points[index - 1], point)),
    'must not contain consecutive duplicate points',
  );

function samePoint(left: PcbPointMm | undefined, right: PcbPointMm | undefined): boolean {
  return left !== undefined && right !== undefined && left.x === right.x && left.y === right.y;
}

const coordinateFrameSchema = z
  .object({
    units: z.literal('mm'),
    origin: z.literal('design'),
    xAxis: z.literal('right'),
    yAxis: z.literal('up'),
    positiveRotation: z.literal('counter-clockwise'),
  })
  .strict();

const layerSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['copper', 'solder-mask', 'silkscreen', 'outline', 'mechanical', 'other']),
    side: z.enum(['top', 'bottom', 'inner', 'none']),
  })
  .strict();

const netSchema = z.object({ id: z.string().min(1), name: z.string().min(1) }).strict();

const padShapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('circle'), diameterMm: positiveMm }).strict(),
  z.object({ kind: z.literal('rectangle'), widthMm: positiveMm, heightMm: positiveMm }).strict(),
  z.object({ kind: z.literal('polygon'), outlineMm: polygonSchema }).strict(),
]);

const padSchema = z
  .object({
    id: z.string().min(1),
    number: z.string().min(1),
    centerMm: pointSchema,
    shape: padShapeSchema,
    netId: z.string().min(1).optional(),
  })
  .strict();

const footprintSchema = z
  .object({
    name: z.string().min(1).optional(),
    outlineMm: polygonSchema.optional(),
    pads: z.array(padSchema),
  })
  .strict();

const componentSchema = z
  .object({
    id: z.string().min(1),
    reference: z.string().min(1),
    positionMm: pointSchema,
    rotationDeg: finiteNumber.transform(normalizeAngleDeg),
    side: z.enum(['top', 'bottom']),
    locked: z.boolean().optional(),
    footprint: footprintSchema.optional(),
  })
  .strict();

const trackSchema = z
  .object({
    id: z.string().min(1),
    netId: z.string().min(1).optional(),
    layerId: z.string().min(1),
    widthMm: positiveMm,
    centerlineMm: polylineSchema,
  })
  .strict();

const viaSchema = z
  .object({
    id: z.string().min(1),
    netId: z.string().min(1).optional(),
    centerMm: pointSchema,
    diameterMm: positiveMm,
    drillMm: positiveMm,
    layerIds: z.array(z.string().min(1)).min(2),
  })
  .strict();

const keepoutSchema = z
  .object({
    id: z.string().min(1),
    outlineMm: polygonSchema,
    purpose: z.enum(['placement', 'routing', 'both']),
    layerIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const sourceSchema = z
  .object({
    system: z.string().min(1),
    documentId: z.string().min(1).optional(),
    revision: z.string().min(1).optional(),
  })
  .strict();

/**
 * Versioned, vendor-neutral PCB contract. This schema describes normalized data only; it does not
 * imply that a native EasyEDA snapshot has been imported or verified.
 */
export const pcbNormalizedModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    coordinateFrame: coordinateFrameSchema,
    source: sourceSchema.optional(),
    board: z.object({ outlineMm: polygonSchema }).strict(),
    layers: z.array(layerSchema),
    nets: z.array(netSchema),
    components: z.array(componentSchema),
    tracks: z.array(trackSchema),
    vias: z.array(viaSchema),
    keepouts: z.array(keepoutSchema),
  })
  .strict()
  .superRefine((model, context) => {
    const checkUniqueIds = (values: readonly { id: string }[], collection: string) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value.id)) {
          context.addIssue({
            code: 'custom',
            path: [collection, index, 'id'],
            message: `duplicate ${collection} id "${value.id}"`,
          });
        }
        seen.add(value.id);
      });
    };

    checkUniqueIds(model.layers, 'layers');
    checkUniqueIds(model.nets, 'nets');
    checkUniqueIds(model.components, 'components');
    checkUniqueIds(model.tracks, 'tracks');
    checkUniqueIds(model.vias, 'vias');
    checkUniqueIds(model.keepouts, 'keepouts');

    const seenReferences = new Set<string>();
    model.components.forEach((component, index) => {
      if (seenReferences.has(component.reference)) {
        context.addIssue({
          code: 'custom',
          path: ['components', index, 'reference'],
          message: `duplicate component reference "${component.reference}"`,
        });
      }
      seenReferences.add(component.reference);
      if (component.footprint) checkUniqueIds(component.footprint.pads, `components.${index}.pads`);
    });

    const layerIds = new Set(model.layers.map((layer) => layer.id));
    const netIds = new Set(model.nets.map((net) => net.id));
    const checkLayerReference = (id: string, path: (string | number)[]) => {
      if (!layerIds.has(id)) {
        context.addIssue({ code: 'custom', path, message: `unknown layer id "${id}"` });
      }
    };
    const checkNetReference = (id: string | undefined, path: (string | number)[]) => {
      if (id !== undefined && !netIds.has(id)) {
        context.addIssue({ code: 'custom', path, message: `unknown net id "${id}"` });
      }
    };

    model.components.forEach((component, componentIndex) => {
      component.footprint?.pads.forEach((pad, padIndex) => {
        checkNetReference(pad.netId, [
          'components',
          componentIndex,
          'footprint',
          'pads',
          padIndex,
          'netId',
        ]);
      });
    });
    model.tracks.forEach((track, index) => {
      checkNetReference(track.netId, ['tracks', index, 'netId']);
      checkLayerReference(track.layerId, ['tracks', index, 'layerId']);
    });
    model.vias.forEach((via, index) => {
      checkNetReference(via.netId, ['vias', index, 'netId']);
      if (via.drillMm >= via.diameterMm) {
        context.addIssue({
          code: 'custom',
          path: ['vias', index, 'drillMm'],
          message: 'via drill diameter must be smaller than via diameter',
        });
      }
      const uniqueViaLayers = new Set(via.layerIds);
      if (uniqueViaLayers.size !== via.layerIds.length) {
        context.addIssue({
          code: 'custom',
          path: ['vias', index, 'layerIds'],
          message: 'via layer ids must be unique',
        });
      }
      via.layerIds.forEach((layerId, layerIndex) => {
        checkLayerReference(layerId, ['vias', index, 'layerIds', layerIndex]);
      });
    });
    model.keepouts.forEach((keepout, index) => {
      keepout.layerIds?.forEach((layerId, layerIndex) => {
        checkLayerReference(layerId, ['keepouts', index, 'layerIds', layerIndex]);
      });
    });
  });

export type PcbNormalizedModel = z.infer<typeof pcbNormalizedModelSchema>;

export class PcbModelInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';

  constructor(readonly issues: z.core.$ZodIssue[]) {
    super(
      `Invalid normalized PCB model: ${issues
        .map((issue) => `${issue.path.join('.') || 'model'}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'PcbModelInputError';
  }
}

/** Validate unknown data and normalize component rotations into the canonical [0, 360) range. */
export function parsePcbNormalizedModel(input: unknown): PcbNormalizedModel {
  const result = pcbNormalizedModelSchema.safeParse(input);
  if (!result.success) throw new PcbModelInputError(result.error.issues);
  return result.data;
}
