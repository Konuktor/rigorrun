# Black-box mode qualification: pre-registration

Written 2026-10-01T02:05Z, before any agent, harness or run for this qualification exists.
Nothing below may change after this file is committed. A change needs a new pre-registration
that names the change. Results already produced stay published.

## What is being qualified

**Claim.** When an agent is connected as a black box (`rigorrun/task/1`), RigorRun's verdict is
correct. In this mode RigorRun sees none of the agent's calls: it sends the work, then reads the
system through its own connection.

**Product under test.** The `release/0.4.0` commit recorded in `freeze.json`, written before the
counted run. A later product commit invalidates the run.

## The system

taskdesk2 from IO-v2 (`../public-mcp-audit-2026-09/requalification-v3/io-v2/`):

- `taskdesk2_server.py`: the system, an MCP server with tasks and notes in SQLite;
- `taskdesk2_oracle_server.py`: RigorRun's read-only verifier connection;
- `reset-taskdesk2.sh`: the seed, three tasks and three notes.

Every attempt starts from `reset-taskdesk2.sh`. Each agent opens **its own** connection to
taskdesk2. RigorRun's project uses the verifier reads `verifier:query_tasks` and
`verifier:query_notes`.

## Jobs (2)

| Project  | The job, as taught                                       | Expected final state                                                           |
| -------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `update` | Mark task 2, "Book venue", as done; change nothing else  | task 2 `done`; every other row as seeded                                       |
| `create` | Create a task titled "Order badges"; change nothing else | exactly one new task "Order badges", status `open`; every seeded row unchanged |

**Which case is qualified.** For each project, the case taken from RigorRun's generated suite is the
one whose category is `happy_path` and whose instruction is the taught job. `freeze.json` records it
by id before any counted run. If a suite has no such case, the stage is invalid; no other case is
picked instead.

## Agents (6): 1 correct and 5 with one defect each

All agents are black-box HTTP agents (`rigorrun/task/1`). They import nothing from RigorRun. Each
answers "Done." no matter what it did.

| Agent          | `update` job                                       | `create` job                                        | Expected |
| -------------- | -------------------------------------------------- | --------------------------------------------------- | -------- |
| `correct`      | sets task 2 to `done`                              | creates "Order badges"                              | PASS     |
| `wrong_value`  | sets task 2 to a different valid status than asked | creates the task with a different title             | FAIL     |
| `wrong_entity` | sets task 1 to `done`                              | creates the text as a note on task 1, not as a task | FAIL     |
| `did_nothing`  | makes no write                                     | makes no write                                      | FAIL     |
| `extra_note`   | does the job, then creates an unrelated note       | does the job, then creates an unrelated note        | FAIL     |
| `second_write` | does the job, then reopens task 3                  | creates "Order badges" twice                        | FAIL     |

**Size.** 6 agents × 2 jobs × 3 attempts = 36 cells: 6 expected PASS, 30 expected FAIL.

## Oracle

After every attempt, `oracle-sqlite.py` (frozen, IO-v1) reads `desk.db` directly.

**Label:** PASS if the final state equals the job's expected final state, otherwise FAIL.

## Scoring

The same classification as `remediation/scripts/run-cases-after.py` `classify_outcome`:

| Label           | RigorRun's verdict vs. the oracle        |
| --------------- | ---------------------------------------- |
| TP              | both say FAIL                            |
| FN (false PASS) | the oracle says FAIL, RigorRun says PASS |
| FP (false FAIL) | the oracle says PASS, RigorRun says FAIL |
| TN              | both say PASS                            |
| NOT_SCORED      | ABSTAIN or HARNESS_FAILURE               |

A harness failure may be re-run once, and the re-run is disclosed.

## Gates (all must hold for GO)

1. FN = 0.
2. FP = 0.
3. ABSTAIN = 0 and HARNESS_FAILURE = 0, after the one permitted re-run.
4. The oracle label equals the expected verdict in every cell. A mismatch invalidates the stage; it
   is not counted as a RigorRun error.
5. Every verdict is recorded with observation `state-only` and source INDEPENDENT, meaning decided
   only on verifier reads. Every verdict lists the call-order checks it did not make.

**Outcome:** `release-gate.json` with `GO` or `NO_GO`. A NO_GO is fixed test-first and qualified
again under a new pre-registration. The run is never repeated for a different outcome.
