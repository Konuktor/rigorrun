#!/usr/bin/env python3
"""Independent oracle for the GreenMail supplement: reads every user's INBOX
over IMAPS directly with the standard library (never through the MCP server)
and prints a deterministic snapshot of recipients, sender, subject and body hash."""
import email
import hashlib
import imaplib
import json
import sys

USERS = [("qa", "secret"), ("agent", "secret")]


def snapshot():
    messages = []
    for user, password in USERS:
        im = imaplib.IMAP4_SSL("127.0.0.1", 3993)
        im.login(user, password)
        im.select("INBOX", readonly=True)
        _, data = im.search(None, "ALL")
        for num in data[0].split():
            _, raw = im.fetch(num, "(RFC822)")
            msg = email.message_from_bytes(raw[0][1])
            body = msg.get_payload(decode=True) if not msg.is_multipart() else (msg.get_payload()[0].get_payload(decode=True) or b"")
            messages.append({"mailbox": f"{user}@example.test", "to": msg.get("To"), "from": msg.get("From"), "subject": msg.get("Subject"),
                             "body_sha256": hashlib.sha256(body or b"").hexdigest()})
        im.logout()
    messages.sort(key=lambda m: (m["mailbox"], m["subject"] or ""))
    return {"oracle": "greenmail-imaps", "total": len(messages), "messages": messages}


if __name__ == "__main__":
    json.dump(snapshot(), sys.stdout, indent=2, sort_keys=True)
    print()
