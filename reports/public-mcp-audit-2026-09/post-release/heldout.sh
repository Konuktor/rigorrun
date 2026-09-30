#!/usr/bin/env bash
# The in-process held-out set (remediation/heldout/inprocess/heldout.inprocess.test.ts, unmodified) at a
# release commit. A temporary copy under packages/runner/test differs from the frozen test only in its
# RESULTS path, and is removed however the run ends.
#
#   heldout.sh <version>
set -uo pipefail
VERSION=${1:?usage: heldout.sh <version>}
HERE=$(cd "$(dirname "$0")" && pwd)
REPORT=$(cd "$HERE/.." && pwd)
REPO=$(cd "$REPORT/../.." && pwd)
SOURCE="$REPORT/remediation/heldout/inprocess/heldout.inprocess.test.ts"
COPY="$REPO/packages/runner/test/zz_heldout_pr.test.ts"
OUT="$HERE/$VERSION/heldout-inprocess"
mkdir -p "$OUT"

python3 -B -c "import sys; sys.path.insert(0, '$HERE'); import pr; pr.make_verify_product('$VERSION')()" || exit 1
commit=$(git -C "$REPO" rev-parse HEAD)

trap 'rm -f "$COPY"' EXIT
python3 - "$SOURCE" "$COPY" "$VERSION" <<'PY'
import sys
source, copy, version = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(source).read()
old = "const RESULTS = join(REPO, 'reports', 'public-mcp-audit-2026-09', 'remediation', 'heldout', 'results-inprocess.json');"
new = f"const RESULTS = join(REPO, 'reports', 'public-mcp-audit-2026-09', 'post-release', '{version}', 'heldout-inprocess', 'results.json');"
assert text.count(old) == 1, "the results path line is not where the frozen test had it"
open(copy, "w").write(text.replace(old, new))
PY
sha256sum "$SOURCE" | awk '{print "frozen test sha256 " $1}' > "$OUT/run.log"
HELDOUT_COMMIT="$commit" "$REPO/node_modules/.bin/vitest" run --root "$REPO" packages/runner/test/zz_heldout_pr.test.ts >> "$OUT/run.log" 2>&1
status=$?
echo "exit $status" >> "$OUT/run.log"
exit $status
