"""Putting an existing Python agent under test, in about ten lines.

The whole surface is one function that takes yours and serves the protocol
RigorRun expects. Deliberately not a framework: RigorRun evaluates agents, and
the moment this starts offering a loop, a memory or a tool abstraction it is
competing with the thing it is supposed to measure — and every opinion it takes
narrows what it can honestly measure.

    from rigorrun import serve

    def my_agent(task, environment):
        # Point your existing MCP client at environment["mcpUrl"] and work.
        return {"status": "completed", "output": "Confirmed the booking."}

    serve(my_agent, port=8900)

Or, if your agent is a command rather than a service, the same function without
a port:

    from rigorrun import run_stdio

    run_stdio(my_agent)

What you get for free is the part that is tedious and easy to get subtly wrong:
the probe RigorRun uses to check you are there before it starts a run, request
validation, error shaping, and a body limit.

Standard library only. An agent under test should not have to reconcile its
dependencies with its test harness's.
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Mapping, MutableMapping

__all__ = [
    "AGENT_PROTOCOL_V2",
    "AgentError",
    "handle_request",
    "run_stdio",
    "serve",
]

AGENT_PROTOCOL_V2 = "rigorrun/agent/2"

#: A request beyond this is not read. A harness is not a file upload service.
MAX_REQUEST_BYTES = 1024 * 1024
#: An account of what happened, not a transcript.
MAX_OUTPUT_CHARS = 8000

#: What RigorRun sends, and what your function receives.
Task = Mapping[str, Any]
Environment = Mapping[str, Any]
#: What you return: at minimum ``{"status": ..., "output": ...}``.
Agent = Callable[[Task, Environment], Mapping[str, Any]]


class AgentError(Exception):
    """Raised for a request that is not one RigorRun would send."""


def _describe(agent: Agent) -> MutableMapping[str, str]:
    """The name RigorRun shows, taken from your function unless you say."""
    return {
        "name": getattr(agent, "rigorrun_name", getattr(agent, "__name__", "agent")),
        "version": getattr(agent, "rigorrun_version", ""),
    }


def handle_request(agent: Agent, body: Any) -> MutableMapping[str, Any]:
    """Answers one request. The whole protocol, in one function.

    Separated from both transports so the same code answers an HTTP request and
    a line on stdin — and so it can be tested without opening a socket.
    """
    if not isinstance(body, dict):
        raise AgentError("expected a JSON object")

    if body.get("probe") is True:
        # Answered before any work is attempted. RigorRun will not call an
        # agent connected until this comes back, because a configuration that
        # says CONNECTED on the strength of a well-formed URL turns into a
        # failed run half an hour later, blamed on the agent.
        return {"ok": True, "agent": _describe(agent)}

    if body.get("protocol") != AGENT_PROTOCOL_V2:
        raise AgentError(
            f"expected protocol {AGENT_PROTOCOL_V2}, got {body.get('protocol')!r}"
        )

    task = body.get("task") or {}
    environment = body.get("environment") or {}

    try:
        result = agent(task, environment)
    except Exception as error:  # noqa: BLE001 — an agent's failure is a result.
        # A crash is a *result*: that case failed, and whatever the agent
        # managed to do first is already in RigorRun's evidence. Turning it
        # into a transport error would lose both.
        return {"status": "failed", "output": f"{type(error).__name__}: {error}"[:MAX_OUTPUT_CHARS]}

    if not isinstance(result, Mapping):
        return {"status": "failed", "output": "the agent returned something that is not a result"}

    status = result.get("status", "completed")
    answer: MutableMapping[str, Any] = {
        "status": status if status in ("completed", "failed") else "completed",
        "output": str(result.get("output", ""))[:MAX_OUTPUT_CHARS],
    }
    # Optional, and passed through only when present — `None` and 0 mean
    # different things, and RigorRun reports an unknown cost as unknown rather
    # than as free.
    if "usage" in result:
        answer["usage"] = result["usage"]
    if "costUsd" in result:
        answer["costUsd"] = result["costUsd"]
    return answer


def run_stdio(agent: Agent) -> None:
    """Serves the protocol on stdin and stdout, for an agent that is a command.

    One line of JSON in, one line out, then exit. RigorRun starts the command
    again for the next case, because a case is the isolation unit everywhere
    else in the product and a long-lived process lets case seven inherit case
    six's memory.
    """
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            answer = handle_request(agent, json.loads(line))
        except (AgentError, json.JSONDecodeError) as error:
            answer = {"status": "failed", "output": str(error)}
        sys.stdout.write(json.dumps(answer) + "\n")
        sys.stdout.flush()
        if not answer.get("ok"):
            # A probe is answered and the process stays up for the real
            # request; a case is answered and it is done.
            break


def serve(agent: Agent, port: int = 8900, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    """Serves the protocol over HTTP, and returns the server so you can stop it.

    Loopback by default, and that is not timidity: an agent under test usually
    holds credentials for the system it is being tested against.
    """

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 — the name http.server requires.
            length = int(self.headers.get("content-length") or 0)
            if length > MAX_REQUEST_BYTES:
                self._reply(413, {"error": "request too large"})
                return
            raw = self.rfile.read(length) if length else b""
            try:
                answer = handle_request(agent, json.loads(raw or b"{}"))
            except (AgentError, json.JSONDecodeError) as error:
                self._reply(400, {"error": str(error)})
                return
            self._reply(200, answer)

        def _reply(self, code: int, body: Mapping[str, Any]) -> None:
            payload = json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_: Any) -> None:
            """Quiet. Your agent's logs are yours; this is plumbing."""

    server = ThreadingHTTPServer((host, port), Handler)
    return server
