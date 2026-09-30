#!/usr/bin/env bash
# The in-process held-out set (remediation/heldout/inprocess/heldout.inprocess.test.ts, unmodified),
# re-run at the product under test, with its results written into final-qualification.
#
# The frozen test writes remediation/heldout/results-inprocess.json. A temporary copy in
# packages/runner/test/ writes evidence/heldout-inprocess/results.json instead; that one
# path is the only difference, and the copy is removed however the run ends. Nothing
# else may run a product-sources check while the copy exists.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
FQ=$(cd "$HERE/.." && pwd)
REPO=$(cd "$FQ/../../.." && pwd)
SOURCE="$FQ/../remediation/heldout/inprocess/heldout.inprocess.test.ts"
COPY="$REPO/packages/runner/test/zz_heldout_fq.test.ts"
OUT="$FQ/evidence/heldout-inprocess"
mkdir -p "$OUT"

node "$HERE/product-under-test.mjs" --check || exit 1
commit=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["productCommit"])' "$FQ/product-under-test.json")

trap 'rm -f "$COPY"' EXIT
python3 - "$SOURCE" "$COPY" <<'PY'
import sys
source, copy = sys.argv[1], sys.argv[2]
text = open(source).read()
old = "const RESULTS = join(REPO, 'reports', 'public-mcp-audit-2026-09', 'remediation', 'heldout', 'results-inprocess.json');"
new = "const RESULTS = join(REPO, 'reports', 'public-mcp-audit-2026-09', 'final-qualification', 'evidence', 'heldout-inprocess', 'results.json');"
assert text.count(old) == 1, "the results path line is not where the frozen test had it"
open(copy, "w").write(text.replace(old, new))
PY
sha256sum "$SOURCE" | awk '{print "frozen test sha256 " $1}' > "$OUT/run.log"
HELDOUT_COMMIT="$commit" "$REPO/node_modules/.bin/vitest" run --root "$REPO" packages/runner/test/zz_heldout_fq.test.ts >> "$OUT/run.log" 2>&1
status=$?
echo "exit $status" >> "$OUT/run.log"
rm -f "$COPY"
trap - EXIT
git -C "$REPO" status --porcelain -- packages | head -3
grep -E "✓|×|Test Files|Tests |exit" "$OUT/run.log"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("rigorrunCommit"), d.get("totals"))' "$OUT/results.json"
exit $status
