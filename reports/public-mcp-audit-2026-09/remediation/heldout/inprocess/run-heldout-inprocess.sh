#!/usr/bin/env bash
# Runs the in-process held-out set once against the working tree and writes
# remediation/heldout/results-inprocess.json and inprocess.log.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../../.." && pwd)
TARGET="$REPO/packages/runner/test/zz_heldout.test.ts"
cp "$HERE/heldout.inprocess.test.ts" "$TARGET"
HELDOUT_COMMIT=$(git -C "$REPO" rev-parse HEAD) "$REPO/node_modules/.bin/vitest" run --root "$REPO" packages/runner/test/zz_heldout.test.ts > "$HERE/../inprocess.log" 2>&1
code=$?
rm -f "$TARGET"
grep -E "✓|×|Test Files|Tests " "$HERE/../inprocess.log"
exit $code
