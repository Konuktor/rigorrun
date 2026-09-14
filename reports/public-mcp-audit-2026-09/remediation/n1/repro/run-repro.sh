#!/usr/bin/env bash
# Reproduces EH-WT-03's verdict in-process from the frozen W2 artefacts, with no
# Worktide stack. Copies eh-wt-03.repro.test.ts into packages/runner/test (so the
# workspace aliases resolve), runs it, removes it. The test writes
# n1/evidence/repro-<label>.json; this script writes n1/evidence/repro-<label>.log.
#
#   bash run-repro.sh before-fix     # or: after-fix
set -uo pipefail
LABEL=${1:?label: before-fix or after-fix}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../../.." && pwd)
TARGET="$REPO/packages/runner/test/zz_n1_repro.test.ts"
cp "$HERE/eh-wt-03.repro.test.ts" "$TARGET"
N1_REPRO_LABEL="$LABEL" N1_REPRO_COMMIT=$(git -C "$REPO" rev-parse HEAD) \
  "$REPO/node_modules/.bin/vitest" run --root "$REPO" --maxWorkers=1 packages/runner/test/zz_n1_repro.test.ts \
  > "$HERE/../evidence/repro-$LABEL.log" 2>&1
code=$?
rm -f "$TARGET"
sed -i "s#$REPO#{REPO}#g" "$HERE/../evidence/repro-$LABEL.log"
grep -E "✓|×|Test Files|Tests " "$HERE/../evidence/repro-$LABEL.log"
exit $code
