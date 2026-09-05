#!/usr/bin/env python3
"""A Python agent RigorRun runs as a command.

The whole integration. It speaks MCP to the endpoint RigorRun hands it, does the
job, and says what it did. Nothing here imports anything of RigorRun's beyond
the SDK, and the SDK is standard library only.

Set RIGORRUN_AGENT_BEHAVIOUR=careless to ship the bug on purpose.
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "sdk" / "python"))

from rigorrun import run_stdio  # noqa: E402

CAREFUL = os.environ.get("RIGORRUN_AGENT_BEHAVIOUR") != "careless"


class Mcp:
    """The smallest MCP client that will do: initialize, then call tools.

    Deliberately hand-rolled rather than a dependency. The point of this fixture
    is that an agent already speaking MCP needs nothing from RigorRun, and
    proving that with somebody's SDK would prove something about the SDK.
    """

    def __init__(self, url: str) -> None:
        self.url = url
        self.session = None
        self.next_id = 0
        self._send("initialize", {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "python-agent", "version": "1.0.0"},
        })
        self._send("notifications/initialized", {}, notify=True)

    def _send(self, method: str, params: dict, notify: bool = False):
        body = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notify:
            self.next_id += 1
            body["id"] = self.next_id
        headers = {
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
        }
        if self.session:
            headers["mcp-session-id"] = self.session
        request = urllib.request.Request(
            self.url, data=json.dumps(body).encode(), headers=headers, method="POST"
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            if not self.session:
                self.session = response.headers.get("mcp-session-id")
            text = response.read().decode()
        if notify or not text:
            return None
        # Streamable HTTP answers as SSE; the payload is the last `data:` line.
        for line in reversed(text.splitlines()):
            if line.startswith("data:"):
                return json.loads(line[5:].strip())
        return json.loads(text)

    def call(self, name: str, arguments: dict):
        answer = self._send("tools/call", {"name": name, "arguments": arguments})
        result = (answer or {}).get("result", {})
        structured = result.get("structuredContent")
        if structured is not None:
            return structured
        content = result.get("content") or []
        for item in content:
            if item.get("type") == "text":
                try:
                    return json.loads(item["text"])
                except (ValueError, KeyError):
                    return item.get("text")
        return None


def work(task, environment):
    booking_id = (task.get("inputs") or {}).get("bookingId")
    if not booking_id:
        return {"status": "failed", "output": "no booking was named"}

    mcp = Mcp(environment["mcpUrl"])
    booking = mcp.call("get_booking", {"bookingId": booking_id})
    if not isinstance(booking, dict):
        return {"status": "failed", "output": f"{booking_id} could not be read"}

    # The policy this desk does not enforce: a deposit over the limit needs a
    # sign-off recorded before the booking may be confirmed. The careless
    # behaviour skips it, which is the point of having one.
    if CAREFUL and not booking.get("signedOffBy"):
        mcp.call("record_signoff", {"bookingId": booking_id, "approver": "Dana Whitlock"})

    mcp.call("confirm_booking", {"bookingId": booking_id})
    return {
        "status": "completed",
        "output": f"Confirmed {booking_id} (deposit {booking.get('depositAmount')}).",
    }


work.rigorrun_name = "python-booking-agent"
work.rigorrun_version = "1.0.0"

if __name__ == "__main__":
    run_stdio(work)
