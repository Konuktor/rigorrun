#!/usr/bin/env python3
"""A local MCP server that speaks only protocol revision 2026-07-28 (stateless, no handshake), over stdio.

Written from the 2026-07-28 specification's versioning page, for the preflight
only: it is not a full implementation. What it does is what a modern-only server
must do to a client from an earlier revision:

- `initialize` is not a method in 2026-07-28; the request is rejected with a
  JSON-RPC error that names the versions this server supports (the spec says a
  modern-only server SHOULD, because a legacy client has no other diagnostic);
- `server/discover` answers with the supported versions, capabilities and identity;
- any other request must carry `_meta["io.modelcontextprotocol/protocolVersion"]`,
  otherwise it is rejected with UnsupportedProtocolVersionError (-32022);
- `tools/list` and `tools/call` work for a request that declares 2026-07-28.
"""
import json
import sys

SUPPORTED = ["2026-07-28"]
SERVER_INFO = {"name": "modern-only-preflight", "version": "1.0.0"}
TOOLS = [{"name": "echo", "description": "echo", "inputSchema": {"type": "object", "properties": {}}}]


def main():
    def send(message):
        sys.stdout.write(json.dumps(message) + "\n")
        sys.stdout.flush()

    for line in sys.stdin:
        if not line.strip():
            continue
        message = json.loads(line)
        if "id" not in message or "method" not in message:
            continue
        method, params, mid = message["method"], message.get("params") or {}, message["id"]
        if method == "initialize":
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"initialize is not supported: this server speaks MCP {', '.join(SUPPORTED)} only", "data": {"supported": SUPPORTED}}})
            continue
        if method == "server/discover":
            send({"jsonrpc": "2.0", "id": mid, "result": {"resultType": "complete", "supportedVersions": SUPPORTED, "capabilities": {"tools": {}}, "serverInfo": SERVER_INFO}})
            continue
        requested = (params.get("_meta") or {}).get("io.modelcontextprotocol/protocolVersion")
        if requested not in SUPPORTED:
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32022, "message": "Unsupported protocol version", "data": {"supported": SUPPORTED, "requested": requested}}})
            continue
        if method == "tools/list":
            send({"jsonrpc": "2.0", "id": mid, "result": {"resultType": "complete", "tools": TOOLS, "ttlMs": 0, "cacheScope": "private"}})
        elif method == "tools/call":
            send({"jsonrpc": "2.0", "id": mid, "result": {"resultType": "complete", "content": [{"type": "text", "text": "{}"}]}})
        else:
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}})


if __name__ == "__main__":
    main()
