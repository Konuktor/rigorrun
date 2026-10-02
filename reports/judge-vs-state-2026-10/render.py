"""The one renderer every grader's input comes from (PREREGISTRATION.md §4).

From a cell's agent transcript it takes only: the ticket text and the policy
exactly as the agent received them, each tool call with its arguments and its
result, and the final reply. No case id, token, prompt variant, model,
reasoning, envelope field or file name reaches a grader.

The state record (M6) is the difference between the case's starting world
(`worlds/<case>.json`, built by the pack) and the twin's dump after the case.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
TABLES = ("customers", "orders", "tickets", "refunds")


def _compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def load_transcript(text: str) -> dict[str, Any]:
    ticket = policy = None
    tools: list[tuple[str, Any, Any]] = []
    reply = ""
    for line in text.splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        kind = entry.get("kind")
        if kind == "task":
            task = entry["envelope"]["task"]
            ticket, policy = task["text"], task["policyBrief"]
        elif kind == "tool":
            tools.append((entry["name"], entry.get("args"), entry.get("result")))
        elif kind == "answer":
            reply = entry.get("message") or ""
    if ticket is None or policy is None:
        raise ValueError("the transcript has no task entry")
    return {"ticket": ticket, "policy": policy, "tools": tools, "reply": reply}


def render_transcript(parsed: dict[str, Any]) -> str:
    lines = [f"{index}. {name}({_compact(args)}) → {_compact(result)}"
             for index, (name, args, result) in enumerate(parsed["tools"], start=1)]
    if not lines:
        lines = ["(no tool calls)"]
    lines.append(f"Final reply: {parsed['reply']}")
    return "\n".join(lines)


def _rows(state: dict[str, Any], table: str) -> dict[str, dict[str, Any]]:
    return {str(row["id"]): row for row in state.get(table, []) if isinstance(row, dict) and "id" in row}


def render_state(case: str, dump: dict[str, Any]) -> str:
    before = json.loads((ROOT / "worlds" / f"{case}.json").read_text())
    lines: list[str] = []
    log = dump.get("access_log", [])
    lines.append("Access-log rows added:")
    lines += [f"- {row.get('action')} {row.get('table')}.{row.get('row_id')} (row's organisation: {row.get('row_org_id')})"
              for row in log] or ["- none"]
    lines.append("Records created, changed and deleted:")
    changes: list[str] = []
    for table in TABLES:
        old, new = _rows(before, table), _rows(dump, table)
        for row_id in sorted(set(new) - set(old)):
            changes.append(f"- created {table}.{row_id}: {_compact(new[row_id])}")
        for row_id in sorted(set(old) - set(new)):
            changes.append(f"- deleted {table}.{row_id}: {_compact(old[row_id])}")
        for row_id in sorted(set(old) & set(new)):
            fields = [f"{field}: {_compact(old[row_id].get(field))} → {_compact(new[row_id].get(field))}"
                      for field in sorted(set(old[row_id]) | set(new[row_id]))
                      if old[row_id].get(field) != new[row_id].get(field)]
            if fields:
                changes.append(f"- changed {table}.{row_id} (organisation {new[row_id].get('org_id')}): " + "; ".join(fields))
    lines += changes or ["- none"]
    lines.append("Emails sent:")
    lines += [f"- to {row.get('to')}, subject {_compact(row.get('subject'))}, body {_compact(row.get('body'))}"
              for row in dump.get("outbox", [])] or ["- none"]
    return "\n".join(lines)
