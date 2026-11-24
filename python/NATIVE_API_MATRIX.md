# Native API compatibility matrix — Python migration

This matrix separates documented EasyEDA Pro native APIs from methods already wrapped by the
current extension dispatcher. A documented API is not automatically production-safe:
EasyEDA marks several PCB primitive methods as beta previews.

| Capability | Native EasyEDA Pro API | Existing bridge method | Python migration status | Assessment |
|---|---|---|---|---|
| PCB component inventory | PCB_PrimitiveComponent.getAll | pcb.listComponents | Read path can be called | Wrapped output currently has ref, primitive ID, footprint name/UUID, XY, rotation, layer and lock state |
| Component pad geometry | PCB_PrimitiveComponent.getAllPinsByPrimitiveId | pcb.listComponentPadConnections | Partial | Connectivity is exposed; normalized pad-local XY, shape, dimensions and courtyard are not guaranteed |
| Component placement | PCB_PrimitiveComponent.modify | pcb.modifyComponent | Native write exists | Must snapshot, apply one component, read back and rollback on mismatch |
| Component delete | PCB_PrimitiveComponent.delete | pcb.deleteComponent | Native write exists | Destructive; requires explicit approval and post-readback |
| Tracks | PCB_PrimitiveLine.getAll / native primitive getters | pcb.listTracks | Read path can be called | Current wrapper extracts endpoints, width, layer and net |
| Vias | PCB_PrimitiveVia.getAll / native primitive getters | pcb.listVias | Read path can be called | Current wrapper extracts XY, hole/diameter and net |
| Copper pours/fills | PCB_PrimitivePour / PCB_PrimitiveFill | pcb.listPours / pcb.listFills | Partial read | Association and polygon evidence vary; rebuild is a separate write |
| Regions/keepouts | PCB_PrimitiveRegion | pcb.listRegions | Partial read | Rule type and polygon source are exposed; not a substitute for courtyard geometry |
| Board dimensions | PCB_Document / board metadata | board.getDimensions | Read path can be called | Bounds only; do not mistake bounds for a closed board-outline polygon |
| Exact board outline | PCB_Primitive.getPrimitiveBoardLine | Not currently exposed as a dedicated bridge method | Missing bridge adapter | Add a dedicated read operation and verify closed-loop topology before placement |
| Layers/stackup | PCB_Layer / PCB_Document | board.listLayers / board.getStackup | Read path can be called | Validate actual layer IDs and stackup on the active document |
| DRC | PCB_Drc.check | design.drc | Read/check operation exists | Native DRC is evidence, not proof of saved/persisted design |
| Autorouting | PCB_Document.autoRouting | Existing autoroute flow | Exists, beta | Native router may be used only after preflight and explicit approval; require unrouted count and failed-net accounting |
| Track create | PCB_PrimitiveLine.create / wrapped addTrack | pcb.addTrack | Existing bridge write | Validate geometry/net/layer/clearance, then read back |
| Via create | PCB_PrimitiveVia.create / wrapped addVia | pcb.addVia | Existing bridge write | Validate drill/diameter/layer span, then read back |
| Pad create | PCB_PrimitivePad.create | Not currently exposed as a supported bridge method | Missing | Do not emulate via arbitrary API calls; implement dedicated schema and live smoke test first |
| Copper zone create | PCB_PrimitivePour.create | pcb.addZone | Fail-closed in current adapter | Do not report success unless native creation, fill, save/reopen and polygon readback are proven |

## Current Python implementation boundary

The first Python slice currently implements:
- MCP server process and local WebSocket listener.
- Existing bridge handshake fields and the 83-method allowlist mirrored from src/bridge/types.ts.
- Read-only native RPC entry point.
- Write preview that deliberately does not execute.

It does not yet implement full tool parity, native writes, exact board outline extraction,
courtyard/pad geometry normalization, DRC reconciliation, or saved-project persistence checks.

## Implementation order

1. Verify the bridge handshake and method-list hash against the extension build.
2. Add native outline extraction via PCB_Primitive.getPrimitiveBoardLine and polygon closure checks.
3. Add normalized pad and footprint courtyard extraction, including embedded footprint primitives.
4. Port read-only PCB, schematic, BOM, DRC/ERC, library, export and diagnostics tools.
5. Port placement and routing previews to Python; keep native writes behind explicit approval.
6. Add per-operation snapshot, transactional apply, readback, rollback and DRC verification.
7. Run live smoke tests against each supported EasyEDA Pro version before switching the default MCP entry point.

## Source references

- EasyEDA Pro Extension API reference: https://prodocs.easyeda.com/en/api/reference/pro-api.html
- PCB_Document: https://prodocs.easyeda.com/en/api/reference/pro-api.pcb_document.html
- PCB_PrimitiveComponent: https://prodocs.easyeda.com/en/api/reference/pro-api.pcb_primitivecomponent.html
- PCB_PrimitivePad: https://prodocs.easyeda.com/en/api/reference/pro-api.pcb_primitivepad.html
- Python MCP SDK: https://py.sdk.modelcontextprotocol.io/
