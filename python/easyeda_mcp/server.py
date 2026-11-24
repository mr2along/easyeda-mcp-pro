"""Python MCP server and EasyEDA Pro native WebSocket bridge (migration alpha)."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import secrets
from dataclasses import dataclass, field
from typing import Any

from mcp.server import MCPServer
from websockets.asyncio.server import ServerConnection, serve

log = logging.getLogger("easyeda_mcp")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

# Mirrored from src/bridge/types.ts. Keep sorted-hash calculation byte-identical
# to the current TypeScript server and extension handshake contract.
NATIVE_METHODS = (
    "project.list", "project.open", "project.create", "project.close",
    "document.activate", "project.save", "project.export",
    "schematic.listNets", "schematic.getNetDetail", "schematic.getPinNoConnect",
    "schematic.getPrimitiveSnapshot", "schematic.listPrimitiveIds",
    "schematic.listComponents", "schematic.listRectangles", "schematic.searchDevice",
    "schematic.getSheetInfo", "schematic.primitiveBounds", "schematic.placeComponent",
    "schematic.restorePrimitiveSnapshot", "schematic.recreatePrimitiveSnapshot",
    "schematic.addWire", "schematic.addText", "schematic.addRectangle",
    "schematic.addCircle", "schematic.addPolygon", "schematic.deletePrimitive",
    "schematic.modifyPrimitive", "schematic.createNetFlag", "schematic.createNetPort",
    "schematic.connectPinToNet", "schematic.connectPinsByNet", "schematic.validateNetlist",
    "schematic.setPinNoConnect", "schematic.setTitleBlock", "schematic.syncToPcb",
    "system.apiInventory", "system.inspectComponents", "system.inspectWires",
    "api.call", "api.read", "board.listLayers", "board.getStackup",
    "board.getDimensions", "board.getFeatures", "board.exportGerbers", "board.export3d",
    "pcb.importFromSchematic", "bom.generate", "bom.validate", "inventory.search",
    "inventory.getPrice", "design.ruleCheck", "design.erc", "design.drc",
    "system.getStatus", "export.pickPlace", "export.pdf", "export.netlist", "export.odb",
    "pcb.addTrack", "pcb.addVia", "pcb.addZone", "pcb.addText", "pcb.addSilkscreenLine",
    "pcb.deleteComponent", "pcb.modifyComponent", "pcb.rebuildCopper", "pcb.zonePreflight",
    "pcb.exportRouteContext", "pcb.listComponentPadConnections", "pcb.listComponents",
    "pcb.listFills", "pcb.listPours", "pcb.listRegions", "pcb.listTracks", "pcb.listVias",
    "api.execute", "canvas.capture", "canvas.captureRegion", "canvas.locate",
    "library.getDeviceByLcscId", "library.getDeviceSubParts", "library.updateDeviceMetadata",
)
METHOD_HASH = hashlib.sha256(",".join(sorted(NATIVE_METHODS)).encode()).hexdigest()[:16]

READ_ONLY = frozenset({
    "project.list", "board.listLayers", "board.getStackup", "board.getDimensions",
    "board.getFeatures", "design.drc", "design.erc", "design.ruleCheck",
    "system.apiInventory", "system.inspectComponents", "system.inspectWires",
    "system.getStatus", "schematic.listNets", "schematic.getNetDetail",
    "schematic.getPinNoConnect", "schematic.getPrimitiveSnapshot",
    "schematic.listPrimitiveIds", "schematic.listComponents", "schematic.listRectangles",
    "schematic.searchDevice", "schematic.getSheetInfo", "schematic.primitiveBounds",
    "pcb.listComponentPadConnections", "pcb.listComponents", "pcb.listFills",
    "pcb.listPours", "pcb.listRegions", "pcb.listTracks", "pcb.listVias",
    "pcb.exportRouteContext", "inventory.search", "inventory.getPrice",
    "bom.generate", "bom.validate", "library.getDeviceByLcscId",
    "library.getDeviceSubParts", "api.read", "canvas.capture", "canvas.captureRegion",
    "canvas.locate",
})

@dataclass
class Session:
    ws: ServerConnection
    handshake: dict[str, Any]
    pending: dict[str, asyncio.Future[Any]] = field(default_factory=dict)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def call(self, method: str, params: dict[str, Any] | None = None,
                   timeout: float = 30.0) -> Any:
        if method not in NATIVE_METHODS:
            raise ValueError(f"Native method not allowlisted: {method}")
        rid = secrets.token_hex(12)
        future = asyncio.get_running_loop().create_future()
        self.pending[rid] = future
        request = {"id": rid, "type": "request", "method": method,
                   "params": params or {}, "timeoutMs": int(timeout * 1000)}
        try:
            async with self.send_lock:
                await self.ws.send(json.dumps(request, separators=(",", ":")))
            return await asyncio.wait_for(future, timeout + 2)
        finally:
            self.pending.pop(rid, None)

class NativeBridge:
    def __init__(self) -> None:
        self.host = os.getenv("BRIDGE_HOST", "127.0.0.1")
        self.port = int(os.getenv("BRIDGE_PORT", "8765"))
        self.session: Session | None = None
        self.server = None

    async def start(self) -> None:
        self.server = await serve(self._handle, self.host, self.port, max_size=32 * 1024 * 1024)
        log.info("EasyEDA bridge listening at ws://%s:%s", self.host, self.port)

    async def close(self) -> None:
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        if self.session:
            await self.session.ws.close()
        self.session = None

    async def call(self, method: str, params: dict[str, Any] | None = None) -> Any:
        if not self.session:
            raise ConnectionError("EasyEDA Pro extension is not connected")
        return await self.session.call(method, params)

    async def _handle(self, ws: ServerConnection) -> None:
        session = None
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except (TypeError, json.JSONDecodeError):
                    continue
                if msg.get("type") == "handshake":
                    if msg.get("protocol") != "easyeda-mcp-pro.bridge":
                        await ws.close(code=1002, reason="Unsupported bridge protocol")
                        return
                    session = Session(ws, msg)
                    self.session = session
                    await ws.send(json.dumps({
                        "type": "hello", "bridgeVersion": "2.0.0a1", "contractVersion": 1,
                        "supportedProtocolVersions": ["1.0.0"],
                        "easyedaVersion": msg.get("easyedaVersion"),
                        "capabilities": list(NATIVE_METHODS), "methodRegistryHash": METHOD_HASH,
                        "maxPayloadSize": 8 * 1024 * 1024, "supportsChunking": False,
                        "devMode": False,
                    }))
                    log.info("EasyEDA Pro extension connected")
                elif msg.get("type") == "response" and session:
                    future = session.pending.get(str(msg.get("id")))
                    if future and not future.done():
                        if msg.get("ok"):
                            future.set_result(msg.get("result"))
                        else:
                            err = msg.get("error") or {}
                            future.set_exception(RuntimeError(
                                f"{err.get('code', 'UNKNOWN')}: {err.get('message', 'Native call failed')}"
                            ))
                elif msg.get("type") == "heartbeat":
                    continue
        finally:
            if self.session and self.session.ws is ws:
                self.session = None
            if session:
                for future in session.pending.values():
                    if not future.done():
                        future.set_exception(ConnectionError("EasyEDA extension disconnected"))

mcp = MCPServer("EasyEDA MCP Pro Python")
bridge = NativeBridge()

@mcp.tool()
async def easyeda_bridge_status() -> dict[str, Any]:
    """Show native extension connection and protocol compatibility."""
    s = bridge.session
    return {"connected": bridge.session is not None,
            "easyeda_version": s.handshake.get("easyedaVersion") if s else None,
            "extension_version": s.handshake.get("extensionVersion") if s else None,
            "python_method_hash": METHOD_HASH,
            "extension_method_hash": s.handshake.get("methodListHash") if s else None,
            "native_method_count": len(NATIVE_METHODS)}

@mcp.tool()
async def easyeda_native_read(method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call an allowlisted read-only native API method in the active EasyEDA document."""
    if method not in READ_ONLY:
        raise ValueError("Method is not classified read-only; refusing execution")
    return {"method": method, "result": await bridge.call(method, params or {})}

@mcp.tool()
async def easyeda_native_write_preview(method: str, params: dict[str, Any]) -> dict[str, Any]:
    """Preview a native write request without executing or changing the PCB."""
    if method not in NATIVE_METHODS or method in READ_ONLY:
        raise ValueError("Expected an allowlisted native write method")
    return {"executed": False, "requires_explicit_approval": True,
            "method": method, "params": params,
            "message": "Preview only; dedicated validated apply tool not implemented yet."}

def main() -> None:
    async def run() -> None:
        await bridge.start()
        try:
            await mcp.run(transport="stdio")
        finally:
            await bridge.close()
    asyncio.run(run())

if __name__ == "__main__":
    main()
