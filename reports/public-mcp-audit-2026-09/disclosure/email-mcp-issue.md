# DRAFT — not submitted.

**Title:** `check_inbox` / `search_emails` raise `TypeError` for local MailHog/Mailpit services; `autorespond` and `watcher` modules are missing from the repository

Thanks for shipping a local-testing story — it is why this project was picked for a reliability audit. Two things block it at the current commit.

## Environment

- `sandraschi/email-mcp` at `fef2a06e9313aa69e7fd1572e18c53ccfc082bcc` (0.5.0), `uv sync --extra test --extra dev`, Python 3.12.13, Linux
- MailHog (`mailhog/mailhog`, SMTP 1025 / HTTP 8025), configured exactly as `docs/local-testing.md`: `MAILHOG_ENABLED=true MAILHOG_SMTP_HOST=127.0.0.1 MAILHOG_SMTP_PORT=1025 MAILHOG_HTTP_URL=http://127.0.0.1:8025`
- `uv run --extra test pytest tests -q` passes (220 tests) — none of them reach `LocalEmailService.check_inbox`

## 1. `check_inbox(service="mailhog")` crashes

```
send_email(to="qa@example.test", subject="Audit 17", body="…", service="mailhog")   → success (MailHog shows the message)
check_inbox(service="mailhog")
→ Error calling tool 'check_inbox': LocalEmailService.check_inbox() takes from 1 to 4 positional arguments but 6 were given
search_emails(query="Audit", service="mailhog")
→ Error calling tool 'search_emails': LocalEmailService.check_inbox() got an unexpected keyword argument 'subject_contains'
```

Reproduced 3/3 in fresh processes.

**Cause.** The abstract `EmailService.check_inbox` and the tool registry gained `from_contains` and `subject_contains`, but `LocalEmailService.check_inbox` (`services/email_services.py:1235`) still has the three-parameter signature. Mailpit takes the same path.

**Fix.** Add the two parameters to `LocalEmailService.check_inbox` (post-filtering the HTTP results is enough), and add a test that calls `check_inbox` through the registry against a stubbed `LocalEmailService` so the signatures cannot drift again.

## 2. Thirteen tools cannot import their implementation

`git ls-files src/email_mcp/tools` lists only `tool_registry.py`, but the registry does `from .autorespond import …` and `from .watcher import …` inside the handlers, so at the pinned commit:

```
list_auto_rules      → No module named 'email_mcp.tools.autorespond'
watcher_status       → No module named 'email_mcp.tools.watcher'
list_pending_replies → No module named 'email_mcp.tools.autorespond'
```

Affected: `add_auto_rule`, `list_auto_rules`, `update_auto_rule`, `test_auto_rule`, `delete_auto_rule`, `backfill_auto_rules`, `list_pending_replies`, `approve_reply`, `auto_respond_now`, `start_watcher`, `stop_watcher`, `watcher_status`, `email_connector`. It looks like the files exist locally but were never committed (the `.gitignore` entries for `autorespond_rules.json` etc. suggest the feature is real). A CI job that imports every module the registry references — or simply `python -c "import email_mcp.tools.autorespond, email_mcp.tools.watcher"` — would catch this.

Small extras, no action needed: `docs/quickstart.md` suggests `uvx email-mcp`, but the PyPI name belongs to an unrelated project; `list_folders` over IMAP returns the raw LIST token (`() "." "INBOX"`) as the folder name; the IMAP `check_inbox` reports `date: "Unknown"`.
