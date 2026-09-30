#!/usr/bin/env bash
# Reset the email-mcp audit environment to a known-empty state.
#
# Starts (or restarts) a local MailHog container bound to loopback only and
# purges every captured message. Asserts the inbox is empty before returning.
# Nothing here touches a real mailbox: MailHog is a fake SMTP sink.
#
# Ports: SMTP 127.0.0.1:1025, HTTP API 127.0.0.1:8025 (MailHog defaults, as
# documented by email-mcp's docs/local-testing.md).
set -euo pipefail
NAME=rr-audit-mailhog
IMAGE=mailhog/mailhog:latest
API=http://127.0.0.1:8025

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 "$IMAGE" >/dev/null
fi
for _ in $(seq 1 40); do
  curl -sf "$API/api/v2/messages" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -sf -X DELETE "$API/api/v1/messages" >/dev/null
total=$(curl -sf "$API/api/v2/messages" | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])')
if [ "$total" != "0" ]; then
  echo "reset-email-mcp: expected 0 messages after purge, found $total" >&2
  exit 1
fi
echo "reset-email-mcp: MailHog up on $API, inbox empty"
