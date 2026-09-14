# Environment

Captured at the start of the final qualification, 2026-09-14T17:12Z, by `scripts/capture-env.sh phase0`. The raw captures are in `evidence/env/phase0/`. Later captures sit beside them, one directory per label, and each local-model case records its own preflight in `evidence/local-model/<case>/`.

## Repository

| Item | Value |
| --- | --- |
| Branch | `redesign/brand-site-product` (46 commits ahead of origin, not pushed) |
| HEAD at start | `a9edbec98ea9056bf1b6a3773cc3fa9ba2692d01` |
| Working tree at start | clean (then only the new `final-qualification/` directory) |
| Package version | 0.2.0 |
| Product commit under test | see `product-under-test.json` |

## Toolchain

| Item | Version |
| --- | --- |
| Node | v22.22.2 |
| pnpm | 11.7.0 |
| Python | 3.13.12 |
| Docker | 28.5.2+dfsg4 |
| Ollama | 0.23.2 |
| MCP SDK in the product | `@modelcontextprotocol/sdk` 1.30.0 (the only installed copy) |

## Host

| Item | Value |
| --- | --- |
| OS | Kali GNU/Linux Rolling 2026.1, kernel 6.19.14+kali-amd64, x86_64 |
| CPU threads | 12 |
| RAM | 15 657 MiB total; 9 366 MiB available at capture |
| Swap | 16 050 MiB partition; 12 919 MiB free at capture |
| GPU | NVIDIA GeForce GTX 1650, 4 096 MiB, 6 MiB in use, driver 550.163.01 |
| Disk | 354 G, 71 G free |
| Largest processes | desktop Chrome renderers and Claude Code sessions, each 0.35–0.59 GB resident |

## Containers and models at start

- **Running:** `agent-gauntlet-db` (postgres:17-alpine) and `mad_devs-reminder-worker-1`. Both are unrelated to the audit and were left running.
- **Stopped:** nine `emotomo-*` containers. They were not touched.
- **Audit containers:** none. The stacks are recreated by Phase 2.
- **Ollama:**
  - no model was loaded at start;
  - installed models include `qwen2.5:3b` (1.9 GB) and `llama3.1:8b` (4.9 GB), the two the frozen local-model cases use.

## Conditions that changed during the run

Each is recorded where it happened, in `progress.md`.

- **npm registry stall (Phase 0):** requests to the npm registry from this host timed out or were reset for about ten minutes, and one sandbox test file failed because its host `npm install` did not finish. The file was re-run after the registry answered normally.
- **Modified file in the email-mcp clone:** `src/drafts.json`, the server's runtime draft store, was already modified before this run. AFTER-2's recreate log records the same state. It was left as found.
