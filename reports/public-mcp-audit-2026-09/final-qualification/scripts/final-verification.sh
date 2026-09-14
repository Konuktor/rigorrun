#!/usr/bin/env bash
# Phase 8: the full product checks at the product under test, one log each in evidence/final/.
#
#   final-verification.sh test|typecheck|lint|e2e|all
#
# Every log ends with "exit N" (aggregate-final.mjs reads it). Nothing is retried
# silently: a failing step is re-run only by calling this again, and both logs are kept
# (a previous log is renamed with its time before a new one is written).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
FQ=$(cd "$HERE/.." && pwd)
REPO=$(cd "$FQ/../../.." && pwd)
OUT="$FQ/evidence/final"
mkdir -p "$OUT"
cd "$REPO" || exit 1

keep() {
  if [ -f "$OUT/$1" ]; then mv "$OUT/$1" "$OUT/${1%.log}.$(date -u +%H%M%S).log"; fi
}

step() {
  local name=$1
  node "$HERE/product-under-test.mjs" --check > /dev/null || { echo "product sources differ from the product under test" >&2; exit 1; }
  keep "$name.log"
  case "$name" in
    test)
      { echo "free MiB at start: $(free -m | awk '/^Mem:/ { print $7 }')"; pnpm test; echo "exit $?"; } > "$OUT/test.log" 2>&1 ;;
    typecheck)
      { pnpm typecheck; echo "exit $?"; } > "$OUT/typecheck.log" 2>&1 ;;
    lint)
      mapfile -t files < <( { git diff --name-only --diff-filter=d 07dda8c HEAD -- packages apps | grep -E '\.(ts|tsx)$'; git ls-files reports/public-mcp-audit-2026-09/final-qualification | grep -E '\.(ts|mjs)$'; } | sort -u)
      { echo "files: ${#files[@]} (TypeScript changed since 07dda8c under packages/ and apps/, plus final-qualification TypeScript and JavaScript)"; node_modules/.bin/eslint "${files[@]}"; s=$?; echo "linted ${#files[@]} files"; echo "exit $s"; } > "$OUT/lint.log" 2>&1 ;;
    e2e)
      { pnpm e2e; echo "exit $?"; } > "$OUT/e2e.log" 2>&1 ;;
  esac
  tail -6 "$OUT/$name.log"
}

case "${1:-}" in
  test|typecheck|lint|e2e) step "$1" ;;
  all) for s in test typecheck lint e2e; do echo "== $s $(date -u +%T)"; step "$s"; done ;;
  *) sed -n 2,9p "$0"; exit 2 ;;
esac
