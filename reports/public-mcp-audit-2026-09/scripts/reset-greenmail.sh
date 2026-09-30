#!/usr/bin/env bash
# SUPPLEMENT (labelled deviation from the MailHog-only instruction): a local
# GreenMail fake IMAP/SMTP server, so the upstream server's IMAP-backed reads
# can be exercised unmodified. Purges every mailbox via GreenMail's REST API
# and (re)starts the loopback STARTTLS relay. Never a real mail server.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
NAME=rr-audit-greenmail
API=http://127.0.0.1:18080/api
if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -p 127.0.0.1:3025:3025 -p 127.0.0.1:3143:3143 -p 127.0.0.1:3993:3993 -p 127.0.0.1:18080:8080 \
    -e GREENMAIL_OPTS='-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=qa:secret@example.test,agent:secret@example.test -Dgreenmail.auth.disabled=true' \
    greenmail/standalone:2.1.4 >/dev/null
fi
for _ in $(seq 1 60); do curl -sf "$API/service/readiness" >/dev/null 2>&1 && break; sleep 0.5; done
curl -sf -X POST "$API/mail/purge" >/dev/null || curl -sf -X POST "$API/service/reset" >/dev/null
if ! ss -ltn | grep -q ':3125 '; then
  UV=$(command -v uv)
  ( cd "$HERE/../../../tmp/rigorrun-audit/email-mcp" && nohup "$UV" run python "$HERE/starttls-relay.py" > /tmp/rr-starttls-relay.log 2>&1 & )
  for _ in $(seq 1 40); do ss -ltn | grep -q ':3125 ' && break; sleep 0.25; done
fi
n=$(python3 "$HERE/oracle-greenmail.py" | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])')
[ "$n" = "0" ] || { echo "reset-greenmail: expected empty mailboxes, found $n" >&2; exit 1; }
echo "reset-greenmail: GreenMail purged, relay on 127.0.0.1:3125"
