#!/usr/bin/env python3
"""TEST-HARNESS COMPONENT — a loopback SMTP relay that offers STARTTLS.

email-mcp's SMTP service always calls STARTTLS, and GreenMail's plain SMTP port
does not offer it. This relay listens on 127.0.0.1:3125 with a self-signed
certificate, accepts STARTTLS, and forwards each message unchanged to
GreenMail on 127.0.0.1:3025 with the agent's credentials. It adds nothing,
drops nothing and never touches a real mail server. It exists only so the
upstream server can be used unmodified against a local fake IMAP mailbox.

Runs in the foreground; stop with SIGTERM.
"""
import asyncio
import os
import smtplib
import ssl
import subprocess
import tempfile

from aiosmtpd.controller import Controller
from aiosmtpd.smtp import AuthResult

UPSTREAM = ("127.0.0.1", int(os.environ.get("RELAY_UPSTREAM_PORT", "3025")))
LISTEN = ("127.0.0.1", int(os.environ.get("RELAY_PORT", "3125")))
AUTH = (os.environ.get("RELAY_USER", "agent"), os.environ.get("RELAY_PASSWORD", "secret"))


class Forward:
    async def handle_DATA(self, server, session, envelope):
        def send():
            with smtplib.SMTP(*UPSTREAM, timeout=15) as s:
                s.login(*AUTH)
                s.sendmail(envelope.mail_from, envelope.rcpt_tos, envelope.content)
        try:
            await asyncio.get_event_loop().run_in_executor(None, send)
        except Exception as exc:  # surfaced to the client as a permanent failure
            return f"554 relay failed: {exc}"
        return "250 OK relayed"


def self_signed():
    d = tempfile.mkdtemp(prefix="rr-relay-")
    key, crt = os.path.join(d, "key.pem"), os.path.join(d, "cert.pem")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", "2", "-subj", "/CN=127.0.0.1"], check=True, capture_output=True)
    ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ctx.load_cert_chain(crt, key)
    return ctx


if __name__ == "__main__":
    controller = Controller(Forward(), hostname=LISTEN[0], port=LISTEN[1], tls_context=self_signed(), auth_require_tls=False, auth_required=False,
                            authenticator=lambda server, session, envelope, mechanism, auth_data: AuthResult(success=True), decode_data=False)
    controller.start()
    print(f"starttls-relay: {LISTEN} -> {UPSTREAM}", flush=True)
    try:
        asyncio.new_event_loop().run_forever()
    except KeyboardInterrupt:
        pass
    finally:
        controller.stop()
