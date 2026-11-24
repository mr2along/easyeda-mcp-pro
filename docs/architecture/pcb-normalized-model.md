# PCB Normalized Model and Geometry

## Purpose

The normalized PCB model is the vendor-neutral boundary between EasyEDA evidence and future
placement or routing algorithms. It provides a typed, validated shape for board geometry,
components, footprints, pads, nets, copper tracks, vias, and keepouts. It does not import a native
EasyEDA document or issue bridge calls.

The initial implementation lives in:

- `src/pcb-layout/normalized-model.ts` — versioned data contract, schema validation, identifier
  checks, and cross-reference checks.
- `src/pcb-layout/geometry.ts` — pure coordinate, polygon, bounds, and intersection operations.
- `tests/unit/pcb-layout/normalized-model.test.ts` and `geometry.test.ts` — contracts and geometry
  behavior independent of EasyEDA.

## Coordinate contract

Version 1 uses millimeters throughout. Its design frame keeps the design origin, has positive X to
the right and positive Y upward, and defines positive rotation as counter-clockwise. Angles are
normalized to `[0, 360)`. Footprint outline and pad coordinates are local to the component origin;
the component position is in the design frame.

The `milToMm` and `mmToMil` helpers use the exact unit relationship `1 mil = 0.0254 mm`. A future
EasyEDA adapter must establish native axis direction, origin, and angle semantics from supported
read-only evidence before converting coordinates. The normalized contract does not assume that
native coordinates already use this frame.

## Geometry behavior

- Board outlines, footprint outlines, polygon pads, and keepouts use finite, simple polygon rings.
  Rings do not repeat the first vertex at the end; the closing edge is implicit. Clockwise and
  counter-clockwise order are both accepted.
- Curves, arcs, holes, filled copper zones, thermal relief, and non-polygon native primitives are
  not represented in version 1.
- Polygon containment and intersection count boundary contact as inside/intersecting.
- `polygonsIntersectMm` answers geometric overlap only. It does not calculate clearance, track
  width spacing, manufacturing rules, or DRC results.
- Geometry functions are deterministic and have no project, filesystem, network, or bridge access.

## Validation boundary

The parser rejects unknown fields, invalid coordinate-frame declarations, non-finite values,
degenerate/self-intersecting polygons, duplicate IDs and component references, unknown net/layer
references, invalid dimensions, and vias whose drill is not smaller than their diameter. It
validates the data shape; it does not decide whether a component fits on the board or whether a
design is electrically or mechanically correct.

The model records layers and nets by stable IDs. It does not infer net connectivity from geometric
proximity. Missing footprints may be represented explicitly by omitting `footprint`; callers must
not replace missing footprint evidence with a guessed package outline.

## Planned integration sequence

1. Build a read-only EasyEDA adapter that preserves source IDs and records the evidence and
   coordinate conversion used for each imported snapshot.
2. Validate native-to-normalized conversions against saved fixtures and EasyEDA read-only
   read-back. Keep unsupported curves and ambiguous coordinate conventions fail-closed.
3. Use footprint polygons and board/keepout geometry for preview-only placement checks, then add
   separately verified write integration behind the existing approval and read-back rules.
4. Expand track, via, copper-zone, and clearance analysis only when their native geometry and rule
   semantics are represented by verified data.

The normalized model and geometry functions are foundations for those stages; they are not
manufacturing approval, electrical certification, or evidence that a layout is safe to fabricate.
