# PCB Component Placement Optimizer

## Purpose

The placement optimizer creates a deterministic, geometry-aware placement proposal before routing. It is a pure TypeScript engine: it does not call EasyEDA, mutate a document, or authorize native writes.

## Input contract

All coordinates are millimetres. The caller must normalize native EasyEDA data into:

- A closed board-outline polygon (at least three vertices).
- Component references, footprint courtyard polygons, pad IDs and local pad coordinates.
- Existing component origin coordinates and rotation where available. Omit both coordinates to request initial placement.
- Nets as pad-reference pairs.
- Explicit mount technology (`TH` or `SMD`), existing component side, optional reviewed side override, fixed/locked flags, allowed rotations, optional allowed-region polygons, edge constraints, functional group labels, side-aware keepouts and board-specific clearance/grid values.

Assembly-side policy is strict: `TH` components are placed on `TOP`; `SMD` components are placed on `BOTTOM`. `MIXED` and `UNKNOWN` technology block automatic placement unless a side override includes a non-empty engineering reason. If native data reports an existing side that conflicts with the technology rule, the placement is blocked for review. Components on opposite sides are not treated as same-side courtyard collisions in this 2D model; body-to-body interference across the board requires a separate 3D height/clearance check. A component courtyard is expressed in local coordinates relative to its placement origin. Supported rotations are 0, 90, 180 and 270 degrees, with optional per-component rotation restrictions/locks. Optional allowed-region polygons and left/right/top/bottom edge constraints support functional partitioning and board-edge connectors. The board polygon is implicitly closed; do not repeat its first vertex. The current geometry model is polygonal; it does not yet model per-layer courtyard variants, copper zones, 3D body collision, or differential-pair escape geometry.

## Placement sequence

1. Validate board outline, component references and courtyard polygons.
2. Preserve fixed components and existing placement coordinates.
3. Seed unplaced components using deterministic area-descending, grid-scanned legal placement.
4. Enforce board-edge clearance, keepouts, allowed placement regions, allowed rotations, connector-to-edge constraints and courtyard-to-courtyard clearance.
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
- Mount technology is explicit; reference designators and footprint names alone are not sufficient evidence to decide TH versus SMD.
- THT-to-TOP and SMD-to-BOTTOM assignment is an assembly-side policy; it does not mean copper routing is restricted to the same side. Copper layers and vias are handled by the routing-rule engine.
- An invalid existing placement, missing legal initial position, or geometry conflict must be resolved before routing.
- The bridge adapter must read back the native board after an approved write and verify reference, x/y, rotation, TOP/BOTTOM side, outline containment, side-aware keepouts and DRC.
- The caller must provide accurate courtyard polygons and approved manufacturing clearances. A bounding-box approximation from footprint dimensions is not equivalent to native courtyard geometry.
- Routing quality still requires congestion analysis, pad escape checks, net-class width/clearance rules, copper-layer constraints, thermal/high-voltage partitioning and a real router evaluation.

## Current limitations

This first optimizer is an offline proposal engine. It does not yet extract the native board outline/footprints/nets from EasyEDA, render an interactive preview, apply placement through the bridge, or invoke the EasyEDA router. Those are separate integration milestones and must be tested against a real EasyEDA Pro version.
