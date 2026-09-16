#!/usr/bin/env bash
# benchmark-v2, in remediation/baseline-manifest.json order (v2/PREREGISTRATION.md,
# "Run order"). One batch per invocation, so a host interruption costs one batch
# instead of the chain. The case lists, and therefore the run order, are the
# pre-registered ones; `verify` proves that against the manifest before any case runs.
#
# Lives outside v2/ on purpose: freeze-v2.py hashes every file under v2/ except
# freeze.json, evidence/ and __pycache__, so a driver written there breaks the freeze.
#
#   run-v2-chain.sh verify | order
#   run-v2-chain.sh em-gm | em-llm-01 | mh-wt-sqd | sq-llm-01 | sq-llm-02 | sq-w1
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
RQ=$(cd "$HERE/.." && pwd)
V2S="$RQ/v2/scripts"
LOGS="$RQ/v2/evidence/logs"
MANIFEST="$RQ/../remediation/baseline-manifest.json"

EM_GM="EM-GM-01-correct EM-GM-02-missing-action-false-claim EM-GM-03-duplicate
EM-GM-04-wrong-recipient EM-GM-05-wrong-subject EM-GM-06-retry-after-lost-response
EM-GM-07-retry-direct EM-GMA-01-correct EM-GMA-02-missing-action-false-claim
EM-GMA-03-duplicate EM-GMA-04-wrong-recipient EM-GMA-05-wrong-subject"

MH_WT_SQD="EM-MH-01-send-one EM-MH-02-check-inbox-crashes EM-MH-03-search-emails-crashes
EM-MH-04-auto-rule-modules-missing EM-MH-05-to-as-list-and-comma EM-MH-06-empty-recipient
EM-MH-07-unknown-service EM-MH-08-service-not-persisted-across-restart
WT-D-01-tasks-get-doubled-prefix WT-D-02-tasks-update-doubled-prefix
WT-D-03-tasks-complete-doubled-prefix WT-D-04-projects-get-archive-doubled-prefix
WT-D-05-tasks-create-500 WT-D-06-add-dependency-500 WT-D-07-time-log-500
WT-D-08-projects-create-500 WT-D-09-timer-start-stop WT-D-10-double-start-closes-first
WT-D-11-stop-with-nothing-running WT-D-12-key-too-long-rejected WT-D-13-nonexistent-task
SQ-D-01-readonly-denies-insert SQ-D-02-backup-under-deny-everything SQ-D-03-rows-changed-leak
SQ-D-04-transaction-across-calls SQ-D-05-column-deny-blocks-aggregate SQ-D-06-timeout-interrupts
SQ-D-07-multi-statement-rejected SQ-D-08-readonly-creates-missing-file SQ-D-09-retry-direct
SQ-D-10-backup-under-column-deny"

SQ_W1="SQ-W1-01-correct SQ-W1-02-missing-action-false-claim SQ-W1-03-duplicate
SQ-W1-04-wrong-value SQ-W1-05-wrong-entity SQ-W1-06-forbidden-extra-delete
SQ-W1B-01-correct SQ-W1B-02-missing-action-false-claim SQ-W1B-03-duplicate
SQ-W1B-04-wrong-value SQ-W1B-05-wrong-entity SQ-W1B-06-forbidden-extra-delete"

# The full sequence this driver covers, in the order it runs it.
order() {
  printf '%s\n' $EM_GM
  echo EM-LLM-01-qwen2.5-3b
  printf '%s\n' $MH_WT_SQD
  echo SQ-LLM-01-llama3.1-8b
  echo SQ-LLM-02-qwen2.5-3b
  printf '%s\n' $SQ_W1
}

# run-v2.py's --only is nargs="*": an empty list runs all 58 cases, and a misspelled
# id is skipped with exit 0. Refuse the first; `verify` catches the second.
batch() {
  local label=$1; shift
  [ "$#" -ge 1 ] || { echo "REFUSING: batch $label with no case ids" >&2; exit 2; }
  mkdir -p "$LOGS"
  echo "$(date -u +%FT%TZ) batch $label ($# cases); available MiB $(free -m | awk '/^Mem:/ {print $7}'); swap free MiB $(free -m | awk '/^Swap:/ {print $4}')" | tee -a "$LOGS/steps.log"
  python3 "$V2S/run-v2.py" --only "$@" >> "$LOGS/run-v2.$label.log" 2>&1
  local rc=$?
  echo "$(date -u +%FT%TZ) batch $label exit $rc" | tee -a "$LOGS/steps.log"
  return $rc
}

local_model() {
  mkdir -p "$LOGS"
  echo "$(date -u +%FT%TZ) local $1 ($2, $3 MiB); available MiB $(free -m | awk '/^Mem:/ {print $7}')" | tee -a "$LOGS/steps.log"
  bash "$V2S/run-local-model-v2.sh" "$1" "$2" "$3"
  local rc=$?
  echo "$(date -u +%FT%TZ) local $1 exit $rc" | tee -a "$LOGS/steps.log"
  return $rc
}

case "${1:-}" in
  order)  order ;;
  verify) order | python3 -c '
import json, sys
manifest = sys.argv[1]
want = [c["id"] for c in json.load(open(manifest))["cases"]]
got = [line.strip() for line in sys.stdin if line.strip()]
print("covers", len(got), "ids; equals manifest order:", got == want)
if got != want:
    missing = [i for i in want if i not in got]
    extra = [i for i in got if i not in want]
    if missing: print("  missing:", ", ".join(missing))
    if extra: print("  not in manifest:", ", ".join(extra))
    sys.exit(1)
' "$MANIFEST" ;;
  em-gm)      batch em-gm $EM_GM ;;
  em-llm-01)  local_model EM-LLM-01-qwen2.5-3b qwen2.5:3b 3000 ;;
  mh-wt-sqd)  batch mh-wt-sqd $MH_WT_SQD ;;
  sq-llm-01)  local_model SQ-LLM-01-llama3.1-8b llama3.1:8b 5000 ;;
  sq-llm-02)  local_model SQ-LLM-02-qwen2.5-3b qwen2.5:3b 3000 ;;
  sq-w1)      batch sq-w1 $SQ_W1 ;;
  *) sed -n '2,12p' "$0" >&2; exit 2 ;;
esac
