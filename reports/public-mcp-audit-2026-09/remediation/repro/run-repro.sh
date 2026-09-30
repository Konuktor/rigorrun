#!/usr/bin/env bash
# Runs the defect reproductions on one side of the remediation.
#
#   run-repro.sh before [ref]   # disposable worktree at ref (default 07dda8c), logs to repro/before.log
#   run-repro.sh after          # the working tree, logs to repro/after.log
#
# Each test asserts a DEFECT. Expected: all pass "before", all fail "after".
# The worktree lives in $REPRO_WORKTREE (default: a temp dir) and is removed.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
SIDE=${1:?before|after}
REF=${2:-07dda8c738d6daada161ffcf2bfc046b3c874ac5}
LOG="$HERE/$SIDE.log"

place() { # $1 = checkout root
  cp "$HERE/runner.repro.test.ts" "$1/packages/runner/test/zz_repro.test.ts"
  cp "$HERE/daemon.repro.test.ts" "$1/packages/daemon/test/zz_repro.test.ts"
  cp "$HERE/cli.repro.test.ts" "$1/packages/cli/test/zz_repro.test.ts"
}
unplace() { rm -f "$1/packages/runner/test/zz_repro.test.ts" "$1/packages/daemon/test/zz_repro.test.ts" "$1/packages/cli/test/zz_repro.test.ts"; }

if [ "$SIDE" = before ]; then
  WT=${REPRO_WORKTREE:-$(mktemp -d)/rr-before}
  git -C "$REPO" worktree add --detach "$WT" "$REF" >/dev/null
  # Third-party dependencies linked from the main checkout; @rigorrun/* links
  # remapped to the worktree's own sources. Symlinking whole node_modules
  # directories is not enough (pnpm workspace links resolve back to the NEW
  # sources), and an offline install needs packages the local store lacks.
  python3 "$HERE/link-deps.py" "$REPO" "$WT" > "$HERE/before.install.log" 2>&1 || { cat "$HERE/before.install.log"; git -C "$REPO" worktree remove --force "$WT" >/dev/null; exit 2; }
  # The fixture toggle is test infrastructure the reproduction needs.
  cp "$REPO/fixtures/external/mcp-venue-desk/src/server.ts" "$WT/fixtures/external/mcp-venue-desk/src/server.ts"
  place "$WT"
  { echo "side=before ref=$REF"; git -C "$WT" rev-parse HEAD; (cd "$WT" && node_modules/.bin/vitest run packages/runner/test/zz_repro.test.ts packages/daemon/test/zz_repro.test.ts packages/cli/test/zz_repro.test.ts 2>&1); } > "$LOG"
  git -C "$REPO" worktree remove --force "$WT" >/dev/null
else
  place "$REPO"
  { echo "side=after"; git -C "$REPO" rev-parse HEAD; git -C "$REPO" status --short | grep -v zz_repro; (cd "$REPO" && node_modules/.bin/vitest run packages/runner/test/zz_repro.test.ts packages/daemon/test/zz_repro.test.ts packages/cli/test/zz_repro.test.ts 2>&1); } > "$LOG"
  unplace "$REPO"
fi
grep -E "✓|×|Test Files|Tests " "$LOG" | sed 's/^/  /'
