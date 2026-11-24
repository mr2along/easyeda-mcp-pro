# EasyEDA MCP Pro — Python migration alpha

Python will own the MCP server, validation, engineering algorithms, orchestration and reports.
The EasyEDA Pro .eext JavaScript extension remains a minimal transport adapter because the native
Extension API is only exposed inside EasyEDA's JavaScript runtime.

Install with pip install -e . and run easyeda-mcp-pro. Configure the extension to connect to
ws://127.0.0.1:49620. MCP uses stdio.

This first migration slice implements the Python MCP entry point, bridge handshake, native method
allowlist, read-only native calls and fail-closed write previews. It does not yet port every existing
TypeScript tool or enable live native PCB writes. Keep the TypeScript server as fallback until
feature parity and live-editor tests pass.
