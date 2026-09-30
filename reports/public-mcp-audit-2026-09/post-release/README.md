# Post-release regression

Requalification v3 (`../requalification-v3/`) returned GO at product `28e8ec3`, and 0.3.0 shipped
from it. Every release after that re-runs v3's three regression inputs at the release commit and
compares them, case by case, with v3:

| Suite | Runner (imported unmodified) | What it checks |
| --- | --- | --- |
| IO-v1 | `final-qualification/scripts/io/run-io.py` | 12 cases against an independent oracle |
| IO-v2 | `requalification-v3/io-v2/run-io-v2.py` | 9 cases over two kinds of record and a read that changes state |
| Held-out, in process | `remediation/heldout/inprocess/heldout.inprocess.test.ts` | 23 known-good and known-bad cases |

The wrappers here replace only where evidence and project homes go, and how the product is
identified: the committed HEAD, nothing uncommitted under `packages`, `apps/app` or `fixtures`, and a
`packages/cli/package.json` version equal to the release being checked. Freezes, cases, oracles,
expectations and attempt counts are the committed ones.

```
python3 io_v1.py <version> setup && python3 io_v1.py <version> run && python3 io_v1.py <version> aggregate
python3 io_v2.py <version> setup && python3 io_v2.py <version> run && python3 io_v2.py <version> aggregate
./heldout.sh <version>
python3 hygiene.py <version> redact && python3 hygiene.py <version> scrub
python3 compare.py <version>     # <version>/comparison.json; exit 1 on any changed case
```

A release whose comparison is not `UNCHANGED` either explains each changed case in its own
`<version>/NOTES.md` before it ships, or does not ship.

## Releases

| Release | Commit | IO-v1 | IO-v2 | Held-out | Against v3 |
| --- | --- | --- | --- | --- | --- |
| 0.3.1 | `57515c2` | 12 cases, 36 attempts, no gate failing | 9 cases, 27 attempts, no gate failing | 23/23 as expected, 6 abstentions | UNCHANGED (`0.3.1/comparison.json`) |
