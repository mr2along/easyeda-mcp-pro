# PCB Component Placement Optimizer

## Purpose

The placement optimizer creates a deterministic, geometry-aware placement proposal before routing. It is a pure TypeScript engine: it does not call EasyEDA, mutate a document, or authorize native writes.

## Input contract

All coordinates are millimetres. The caller must normalize native EasyEDA data into:

- A closed board-outline polygon (at least three vertices).
- Component references, footprint courtyard polygons, pad IDs and local pad coordinates.
- Existing component origin coordinates and rotation where available. Omit both coordinates to request initial placement.
- Nets as pad-reference pairs.
- Fixed/locked component flags, functional group labels, keepout polygons and board-specific clearance/grid values.

A component courtyard is expressed in local coordinates relative to its placement origin. Supported rotations are 0, 90, 180 and 270 degrees. The current geometry model is polygonal; it does not yet model per-layer courtyard variants, copper zones, 3D body collision, or differential-pair escape geometry.

## Placement sequence

1. Validate board outline, component references and courtyard polygons.
2. Preserve fixed components and existing placement coordinates.
3. Seed unplaced components using deterministic area-descending, grid-scanned legal placement.
4. Reject candidate positions outside the outline, inside keepouts, or closer than the configured courtyard clearance.
5. Run seeded simulated annealing over translation and orthogonal rotation.
6. Score weighted net half-perimeter wire length (HPWL), functional-group dispersion and a normalized routing-pressure heuristic.
7. Return a preview, blockers, warnings and metrics. Human approval remains mandatory.

## Optimization objective

The current objective is:

`weighted HPWL + 0.35 × group dispersion + 20 × normalized routing-pressure index`

Critical nets default to weight 3; other nets default to weight 1. A caller may provide explicit net weights and component group/placement priority. HPWL is a placement proxy, not a detailed routed-length prediction. The routing-pressure index is not a via-count estimate or a probability of successful routing.

## Safety and engineering boundaries

- No EasyEDA/native write occurs in this module.
- No placement is marked route-approved.
- An invalid existing placement, missing legal initial position, or geometry conflict must be resolved before routing.
- The bridge adapter must read back the native board after an approved write and verify reference, x/y, rotation, outline containment, keepouts and DRC.
- The caller must provide accurate courtyard polygons and approved manufacturing clearances. A bounding-box approximation from footprint dimensions is not equivalent to native courtyard geometry.
- Routing quality still requires congestion analysis, pad escape checks, net-class width/clearance rules, copper-layer constraints, thermal/high-voltage partitioning and a real router evaluation.

## Current limitations

This first optimizer is an offline proposal engine. It does not yet extract the native board outline/footprints/nets from EasyEDA, render an interactive preview, apply placement through the bridge, or invoke the EasyEDA router. Those are separate integration milestones and must be tested against a real EasyEDA Pro version.
