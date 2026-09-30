# MCP compatibility at the requalification's product under test

This is a compatibility check, not a migration: RigorRun's MCP client was not changed.

- **Product under test.** `7209dca`. Since the final qualification's product `a9edbec`:
  - `packages/mcp` has no change;
  - the only change in the result normaliser's files is a comment in `packages/connector/src/rows.ts`.

  The stage A connector change (`readsForVerdict`) decides which nominated reads are used. It does not change how a call is made or how a result is read.
- **Evidence.**
  - The preflight evidence is in `mcp/evidence/mcp-preflight/`, from `mcp/mcp-preflight.ts`, a path-only copy of the final qualification's script.
  - The per-target statements are in `mcp/evidence/mcp-preflight/targets.json`.
- **Method.** As in the final qualification, every check goes through RigorRun's own `McpConnection` (packages/mcp) and `normalizeCallResult` (packages/connector), with a raw JSON-RPC client as the reference.

**Preflight totals at `7209dca`:** 14 PASS, 5 LIMIT, 0 FAIL (`summary.json`). Every check has the same status as in the final qualification.

## What RigorRun supports

| Item | Status | Evidence |
| --- | --- | --- |
| MCP SDK | `@modelcontextprotocol/sdk` 1.30.0 (lockfile) | `sdk-versions.json` |
| Protocol versions | `LATEST_PROTOCOL_VERSION` (2025-11-25), 2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07, all through the `initialize` handshake | `sdk-versions.json` |
| **2026-07-28** | **UNSUPPORTED** (client side). The SDK does not contain the revision (`knows20260728: false`). A server that speaks only 2026-07-28 is refused at connect with a visible error, before any case exists. | `sdk-versions.json`, `modern-only-server.json` |
| Connection | SUPPORTED | `filesystem-connect.json` |
| `tools/list` | SUPPORTED for a single page: RigorRun saw 14 tools, and the raw client saw 14 on 1 page. **LIMIT:** `nextCursor` is ignored. | `filesystem-tools-list.json`, `tools-list-pagination.json` |
| `tools/call` | SUPPORTED | `filesystem-call.json`, `memory-structured.json` |
| Structured result | read as records | `normalisation-structured.json` |
| JSON inside a text block | read as records (R-8) | `normalisation-json-in-text.json` |
| Prose | never read as records | `normalisation-prose.json` |
| Errors | `isError` results and JSON-RPC errors are errors, never data | `errors.json`, `filesystem-error.json` |
| Timeout | a call past its timeout is an error, not an empty result | `timeout.json` |
| `resource_link` or image-only result | **LIMIT** | `normalisation-links-and-images.json` |
| Negotiated version recorded | **LIMIT:** a stdio server is recorded as `negotiated`; the raw handshake negotiated 2025-11-25 | `recorded-protocol-version.json` |
| Server stderr | **LIMIT:** a server writing 200 KB to stderr is not reliably answered | `stderr-flood.json` |
| Transport teardown | SUPPORTED | `filesystem-teardown.json`, `memory-teardown.json`, `teardown-local.json` |

The final qualification's `mcp-compatibility.md` explains why a 2026-07-28 mismatch cannot become an upstream finding. That reasoning rests on the same client behaviour, measured again here (`modern-only-server.json`, PASS), and is not repeated.

## The planned targets

| Target | Pinned package | Status | Provenance | Blocks the audit? |
| --- | --- | --- | --- | --- |
| Filesystem MCP | `@modelcontextprotocol/server-filesystem` 2026.8.31 (the installed copy) | **SUPPORTED** | measured again at `7209dca` | no |
| GitHub MCP | `github/github-mcp-server`, go-sdk v1.7.0 | **PARTIAL** | carried unchanged from the final qualification (`a011a64`), where it was read from the package source; not re-read here | no, given the preconditions |
| Playwright MCP | `@playwright/mcp` 0.0.80 | **PARTIAL** | carried unchanged from the final qualification (`a011a64`), where it was read from the package source; not re-read here | no, given the preconditions |

The preconditions before any finding is attributed upstream are unchanged and listed per target in `targets.json`:
- a raw handshake and a raw paged tool count;
- raw-client reproduction of every timeout, with the server's stderr volume measured;
- independent verifier reads for Playwright MCP;
- the stdio server with an environment token for GitHub MCP.

These are limits of RigorRun's MCP client, stated so they are not mistaken for defects in the targets.
