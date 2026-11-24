# Native PCB automation pipeline

This document defines the guarded pipeline implemented in `src/pcb/pcb-automation-pipeline.ts`.

## Pipeline

```text
EasyEDA Pro focused PCB
        |
        v
NativePcbAutomationAdapter.extractNativeSnapshot()
        |
        v
normalizeNativePcbSnapshot() -- reject incomplete/approximate geometry
        |
        v
optimizeComponentPlacement()
        |
        +--> Placement preview: x/y, rotation, TOP/BOTTOM, geometry blockers
        |
        +--> Routing analysis: pad escape, net-crossing and congestion proxies
        |
        +--> Optional native-router feedback (separate evidence)
        |
        v
User approval bound to proposal + board fingerprint + project/document UUID
        |
        v
Fresh extraction + fingerprint/document identity check
        |
        v
Native apply adapter (confirmWrite=true; no implicit save)
        |
        v
Native read-back comparison
        |
        v
Native PCB DRC
        |
        v
APPLIED_AND_VERIFIED only when write receipt, read-back and DRC all pass
```

## 1. Native PCB Extractor contract

The adapter must return:

- Exact board outline polygon in millimetres, not a dimensions/bounding-box approximation.
- Per-component courtyard polygon in local footprint coordinates.
- Per-pad local coordinates, pad identity and native net association.
- Native component primitive ID, reference, x/y, rotation, side and lock state.
- Complete native net-to-pad membership.
- Focused project/document identity and a stable snapshot fingerprint.

`normalizeNativePcbSnapshot` fails closed if any required geometry or net-membership evidence is missing. It does not infer courtyard from body dimensions, infer THT/SMD from reference designators, or treat a board bounding box as an outline.

### Current native bridge evidence and gap

The existing bridge already has read paths for component inventory, per-component pad connections, board dimensions, layers, tracks, vias, fills/regions/pours and PCB DRC. The current `board.getDimensions` path returns dimensions derived from outline primitive bounds; it does **not** return a verified closed outline polygon. `pcb.listComponents` returns component positions and footprint identifiers, while `getAllPinsByPrimitiveId` supports native pad/net connection evidence. The inspected implementation does not yet expose a verified footprint-courtyard polygon plus all pad geometry in the normalized shape required here.

Therefore the new pipeline defines the exact extractor contract and refuses to proceed without it. Do not connect a heuristic or bounding-box fallback and label it “exact”. The native extractor adapter remains an integration task against a live EasyEDA Pro runtime and the specific footprint API methods verified there.

## 2. Placement Preview

The preview reuses the deterministic placement optimizer and returns:

- Component x/y, rotation and assembly side.
- Existing courtyard, board-edge, keepout, allowed-region and component-clearance blockers.
- A stable proposal ID tied to the native snapshot fingerprint.
- Explicit `requiresHumanApproval: true` and `nativeWritePerformed: false`.

The existing assembly-side policy remains: THT on TOP, SMD on BOTTOM; MIXED/UNKNOWN requires a reviewed override with a reason. Routing layers remain independent of assembly side.

## 3. Routing-aware analysis

The preview calculates three geometry proxies:

- **Pad escape:** distance from each pad centre to its transformed courtyard boundary.
- **Net crossing:** intersections between straight-line star connections joining the pads of different nets.
- **Congestion index:** normalized comparative score from pad density and crossing count.

These are placement heuristics, not copper routes, DRC proof, or route-success probabilities. A native router result is stored separately and labelled `NATIVE_ROUTER`; it can report unrouted nets, failed nets, routed length, vias and DRC violations. If the native router adapter is absent, the pipeline labels the result `GEOMETRY_HEURISTIC` and warns accordingly.

The EasyEDA Pro API reference documents `PCB_Document.autoRouting(props)` as a beta API available since EDA v3.2.150. It performs routing on the focused PCB; it is not a read-only estimator. The API can take up to 900 seconds and has a fixed 15-minute hard limit. The newer `startAutoRouting` job model is documented from v4.1.79, so it must not be assumed available on the repository's earlier verified 3.2.209 runtime. The pipeline therefore keeps native autorouting out of Placement Preview and exposes it as a separate, explicitly approved write action through `runApprovedNativeAutorouting`. Its approval is distinct from placement approval and must specify a non-empty net list, ignored nets, enabled copper layers, completion/speed priority, and the safe `keepExistingTracksAndVias: true` policy. The adapter maps these normalized choices to the exact EasyEDA API enum/property values, returns the native router result, then triggers read-back and DRC. The currently implemented route post-check verifies document identity and DRC; a complete native track/via inventory comparison remains a follow-up requirement before marking route geometry as independently read-back verified.

## 4. Native Apply

`applyApprovedPcbPlacement` accepts only an explicit approval that matches all of:

- Proposal ID.
- Source board fingerprint.
- Project UUID.
- Focused PCB document UUID.

It re-extracts the board immediately before writing and rejects stale state or a changed focused document. The adapter receives `confirmWrite: true` and must use the existing native write permission policy. It must report every applied and failed primitive ID. The pipeline does not save the project implicitly.

The adapter is responsible for safe sequential writes and native API-specific rollback/recovery behavior. A partial write is reported as `PARTIAL_WRITE`, never as success.

## 5. Read-back and DRC

After a fully verified write, the adapter must re-read native component state and compare it against every approved placement. Any mismatch returns `READBACK_MISMATCH`. Only after read-back passes does the pipeline invoke native PCB DRC. DRC errors return `DRC_FAILED`; unavailable read-back or DRC returns `POST_WRITE_CHECK_FAILED`.

`APPLIED_AND_VERIFIED` means the native write receipt was complete, read-back had no mismatches, and PCB DRC reported zero errors. It does not save the design and does not certify electrical performance or manufacturability.

## Implementation status

| Layer | Code status | Live EasyEDA integration |
|---|---|---|
| Exact native snapshot contract and fail-closed normalizer | Implemented | Not connected; courtyard and exact outline extraction still need native API verification |
| Placement preview | Implemented using existing optimizer | Waiting for exact extractor payload |
| Pad escape / crossing / congestion proxies | Implemented | Uses normalized geometry only |
| Read-only router-analysis contract | Implemented | Adapter not wired |
| Explicitly approved native autorouter call + post-route DRC | Implemented as adapter contract | EasyEDA beta API adapter not wired; route geometry read-back still needed |
| Approval/fingerprint gate and apply/read-back/DRC orchestration | Implemented as adapter contract | Native write adapter not wired to dispatcher |
| Tests | Added | Not executed in this environment |

## Safety requirements for the next bridge integration

1. Verify courtyard and pad getters on each supported EasyEDA Pro version; store the observed API version and capability evidence.
2. Build closed outline loops from native primitives only when every segment/arc is connected and closure is verified. Reject open, self-intersecting or ambiguous loops.
3. Convert native coordinate units to millimetres in one audited boundary; do not mix mil and mm.
4. Capture project/document identity before and after extraction; discard snapshots if focus changes.
5. Keep preview and router analysis read-only.
6. Apply only the exact approved proposal after fresh fingerprint validation.
7. Verify native position/rotation/side read-back, then run PCB DRC. Never auto-save.
8. Use `PCB_Document.autoRouting` only as a separately approved mutation; enforce its 900-second hard limit and only pass enabled copper layers.
9. Add live smoke tests against supported EasyEDA versions before enabling the adapter in the default tool profile.
