# Target A — sandraschi/email-mcp

| | |
| --- | --- |
| Upstream | `sandraschi/email-mcp` at `fef2a06e9313aa69e7fd1572e18c53ccfc082bcc` (0.5.0, 2026-09-11) |
| Runtime | Python 3.12 via `uv sync --extra test --extra dev`; FastMCP; launched as `uv --directory <clone> run email-mcp` (stdio) |
| Transport / tools | stdio (HTTP also available); 47 tools discovered, 19 annotated `readonly`, 3 `destructive` |
| Upstream tests | `uv run --extra test pytest tests -q` → **PASS**, 220 passed, coverage 46 % (`evidence/email-mcp-upstream-tests.log`). None of them exercise the local-service inbox read that is broken (E-1). |
| Environment, primary track | local MailHog container (`mailhog/mailhog`, SMTP 1025, HTTP 8025), configured through the `MAILHOG_*` variables upstream documents in `docs/local-testing.md` |
| Environment, supplement | local GreenMail fake IMAP/SMTP container plus a 40-line loopback STARTTLS relay (`scripts/starttls-relay.py`), so the unmodified server's SMTP+IMAP service could be exercised; a labelled deviation from the MailHog-only instruction (see `methodology.md`) |
| Oracles | `scripts/oracle-mailhog.py` (MailHog HTTP API) and `scripts/oracle-greenmail.py` (IMAPS from a separate process) |
| Resets | `scripts/reset-email-mcp.sh`, `scripts/reset-greenmail.sh` |

All addresses are under `example.test`; no real mailbox was configured at any point.

## The MailHog track: RigorRun refused, correctly

The first journey (`traces/email-mcp/w1-setup`) connected the server, nominated `check_inbox(service="mailhog")` and `list_services` as verifier reads, and RigorRun answered at nomination time:

> These reads did not answer: check_inbox. RigorRun will not be able to verify what they cover.

The demonstration then sent one message — MailHog's API shows it — and `compile` refused:

> The recording performed "send_email" but nothing in the system changed. RigorRun verifies against authoritative state, so a job that leaves no trace cannot be compiled.

That is the right behaviour. The read that would have shown the change is broken upstream (E-1), the remaining read (`list_services`) cannot see mail, and RigorRun would not grade an agent on the agent's own account. It also means no agent-level case could be run on this track; the MailHog cases are direct probes of the server.

## Direct probes on MailHog, 3 attempts each

| Case | What was checked | Result |
| --- | --- | --- |
| EM-MH-01 | `send_email` to `qa@example.test`, subject "Audit 17" | one message captured with exactly that recipient and subject, 3/3 |
| **EM-MH-02** | `check_inbox(service="mailhog")` after a send | **`TypeError: LocalEmailService.check_inbox() takes from 1 to 4 positional arguments but 6 were given`, 3/3** — finding E-1 |
| **EM-MH-03** | `search_emails(query="Audit", service="mailhog")` | **same class of `TypeError` (`unexpected keyword argument 'subject_contains'`), 3/3** — finding E-1 |
| **EM-MH-04** | `list_auto_rules`, `watcher_status`, `list_pending_replies`, `add_auto_rule` | **`No module named 'email_mcp.tools.autorespond'` / `…watcher`, 3/3** — finding E-2 |
| EM-MH-05 | `to` as a two-element list and as a comma-separated pair | both deliver to exactly those two recipients |
| EM-MH-06 | empty recipient | refused, nothing delivered |
| EM-MH-07 | unknown service name | clean failure, nothing delivered |
| EM-MH-08 | `configure_service` then a fresh process | the service is gone after restart, exactly as `docs/configuration.md` says (INFO, not a bug) |

`fetch_email_detail` answers "fetch_message not supported for mailhog" (stated, so not a finding). Folder, move, flag and delete tools need an IMAP backend and were not exercised against MailHog.

## The GreenMail supplement: RigorRun could verify, and the baseline problem showed again

With SMTP pointed at the relay and IMAP at GreenMail, `check_inbox(service="default")` returns records (`id`, `subject`, `from`, `date`, `read`). RigorRun induced an `Email` entity keyed by `id` and built a one-case suite whose check is `state_exists derived.created.Email` (`traces/email-mcp/gm-w1-setup`). Its quality gate reported `mutant_kill_rate = 0/3` and `case_discrimination = 0 of 1`. Two things about the read are worth knowing: the recipient is not in it, so a message to the wrong address is invisible to RigorRun by construction, and `id` is the IMAP sequence number, which restarts at 1 after the mailbox is purged.

| Case | Behaviour under test | Oracle | RigorRun | Class |
| --- | --- | --- | --- | --- |
| EM-GM-01 | correct: one send to `qa@example.test`, "Audit 17" | state right | FAIL ("derived.created.Email is absent") | FALSE_POSITIVE |
| EM-GM-02 | no send, claims success | state wrong | FAIL | TRUE_POSITIVE |
| EM-GM-03 | send twice | state wrong | PASS | FALSE_NEGATIVE |
| EM-GM-04 | send to `agent@example.test` instead | state wrong | FAIL (qa's inbox unchanged) | TRUE_POSITIVE |
| EM-GM-05 | subject "Audit 71" | state wrong | FAIL (same id as the seed) | TRUE_POSITIVE, for the wrong reason |
| EM-GMA-01…05 | the same five without purging between runs (the accumulate mode RigorRun's no-reset design assumes) | as above | 01 FAIL, 02 FAIL, 03–05 **PASS** | FP, TP, FN, FN, FN |
| EM-GM-06 | INJECTED FAULT inside a RigorRun case: first `send_email` response dropped, agent retries | one message (the case was killed at 15 s before the retry) | FAIL ("exceeded its 15000ms budget") | see R-4 |
| EM-GM-07 | the same fault with the direct client and a 5 s call timeout | **two messages delivered, 3/3** | not run in RigorRun | E-3 (risk) |
| EM-LLM-01 | real LLM agent, Ollama `qwen2.5:3b` | not done (15 s budget with 47 tools) | FAIL | A-1 |

Every row reproduced identically in all three attempts. The mechanism behind the FP/FN pattern is R-1 in `findings.md`; the accumulate-mode rows show the same baseline going stale in the other direction once the mailbox drifts past the recorded snapshot.

## What could not be done here

- The auto-response workflow (add a rule, trigger a reply) could not be tested at all: the modules are missing from the repository (E-2).
- Folder operations, `move_email` (documented as COPY + DELETE) and `delete_email` need an IMAP backend; on the GreenMail track the audit stayed with the send/read workflow that RigorRun's verdict rests on.
- `rigorrun verify` cannot run a Python server.
