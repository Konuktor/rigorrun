#!/usr/bin/env python3
"""A local MCP server (stdio, `initialize` handshake) that answers in every shape the preflight needs.

Nothing here is RigorRun-specific; each tool returns one result shape a real
server can return, so the preflight can record what RigorRun's client and
normaliser do with it.

    structured_only   structuredContent, and an empty content list
    json_text         JSON in a text block only (no structuredContent)
    prose             a plain sentence in a text block
    tool_error        a result with isError: true
    rpc_error         a JSON-RPC error (-32602) instead of a result
    slow              answers after 25 s
    resource_link     a resource_link content block only
    image_only        an image content block only
    stderr_flood      writes 200 KB to stderr, then answers
    page_two_tool     listed only on the second page of tools/list (nextCursor)

    preflight_server.py [--negotiate VERSION]
"""
import argparse
import base64
import json
import sys
import time

SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
PAGE_ONE = ["structured_only", "json_text", "prose", "tool_error", "rpc_error", "slow", "resource_link", "image_only", "stderr_flood"]
PAGE_TWO = ["page_two_tool"]


def tool(name):
    return {"name": name, "description": f"preflight shape: {name}", "inputSchema": {"type": "object", "properties": {}}, "annotations": {"readOnlyHint": True}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--negotiate")
    a = parser.parse_args()

    def send(message):
        sys.stdout.write(json.dumps(message) + "\n")
        sys.stdout.flush()

    payload = {"items": [{"id": 1, "name": "alpha"}, {"id": 2, "name": "beta"}]}
    for line in sys.stdin:
        if not line.strip():
            continue
        message = json.loads(line)
        if "id" not in message or "method" not in message:
            continue
        method, params, mid = message["method"], message.get("params") or {}, message["id"]
        if method == "initialize":
            requested = params.get("protocolVersion")
            version = a.negotiate or (requested if requested in SUPPORTED else SUPPORTED[0])
            send({"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": version, "capabilities": {"tools": {}}, "serverInfo": {"name": "preflight-shapes", "version": "1.0.0"}}})
        elif method == "ping":
            send({"jsonrpc": "2.0", "id": mid, "result": {}})
        elif method == "tools/list":
            if params.get("cursor") == "page-2":
                send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [tool(n) for n in PAGE_TWO]}})
            else:
                send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [tool(n) for n in PAGE_ONE], "nextCursor": "page-2"}})
        elif method == "tools/call":
            name = params.get("name")
            if name == "structured_only":
                send({"jsonrpc": "2.0", "id": mid, "result": {"content": [], "structuredContent": payload}})
            elif name == "json_text":
                send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": json.dumps(payload)}]}})
            elif name == "prose":
                send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": "There are two items, alpha and beta."}]}})
            elif name == "tool_error":
                send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": "the tool failed"}], "isError": True}})
            elif name == "rpc_error":
                send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": "invalid params"}})
            elif name == "slow":
                time.sleep(25)
                send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": json.dumps(payload)}]}})
            elif name == "resource_link":
                send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "resource_link", "uri": "file:///tmp/preflight.json", "name": "preflight.json", "mimeType": "application/json"}]}})
            elif name == "image_only":
                png = base64.b64encode(bytes.fromhex("89504e470d0a1a0a")).decode()
                send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "image", "data": png, "mimeType": "image/png"}]}})
            elif name == "stderr_flood":
                sys.stderr.write("x" * 200_000 + "\n")
                sys.stderr.flush()
                send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": json.dumps(payload)}]}})
            elif name == "page_two_tool":
                send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": json.dumps(payload)}]}})
            else:
                send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": f"unknown tool {name}"}})
        else:
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}})


if __name__ == "__main__":
    main()
