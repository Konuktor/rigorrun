#!/usr/bin/env python3
"""Independent oracle for the email-mcp target.

Reads MailHog's HTTP API directly (never through the MCP server) and prints a
normalised, deterministic JSON snapshot of every captured message: recipients,
sender, subject, a hash of the plain body, and the total count. This is the
ground truth every email case is judged against.

Usage: oracle-mailhog.py [--api URL] > snapshot.json
"""
import argparse
import hashlib
import json
import sys
import urllib.request


def snapshot(api: str) -> dict:
    with urllib.request.urlopen(f"{api}/api/v2/messages?limit=500", timeout=10) as r:
        data = json.load(r)
    messages = []
    for m in data.get("items", []):
        headers = m.get("Content", {}).get("Headers", {})
        body = m.get("Content", {}).get("Body", "")
        messages.append(
            {
                "to": sorted(f"{t['Mailbox']}@{t['Domain']}" for t in m.get("To", [])),
                "from": f"{m['From']['Mailbox']}@{m['From']['Domain']}" if m.get("From") else None,
                "subject": (headers.get("Subject") or [""])[0],
                "body_sha256": hashlib.sha256(body.encode()).hexdigest(),
                "created": m.get("Created"),
            }
        )
    # Sort so two snapshots of the same state compare equal regardless of order.
    messages.sort(key=lambda x: (x["created"] or "", x["subject"]))
    return {"oracle": "mailhog-http", "total": data.get("total", len(messages)), "messages": messages}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--api", default="http://127.0.0.1:8025")
    a = p.parse_args()
    json.dump(snapshot(a.api), sys.stdout, indent=2, sort_keys=True)
    print()
