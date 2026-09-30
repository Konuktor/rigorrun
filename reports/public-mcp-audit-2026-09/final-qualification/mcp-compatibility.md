# MCP compatibility preflight

This is a compatibility check, not a migration: RigorRun was not changed.

- **Sources:**
  - the preflight evidence in `evidence/mcp-preflight/`, from `scripts/mcp/mcp-preflight.ts`;
  - the per-target statements in `evidence/mcp-preflight/targets.json`;
  - the MCP specification revision 2026-07-28 (changelog and versioning pages at modelcontextprotocol.io).
- **Method:** every check went through RigorRun's own `McpConnection` (packages/mcp) and `normalizeCallResult` (packages/connector). A raw JSON-RPC client written for the preflight was the reference.

## What RigorRun supports

| Item | Status | Evidence |
| --- | --- | --- |
| MCP SDK | `@modelcontextprotocol/sdk` 1.30.0, the only installed copy | `sdk-versions.json` |
| Protocol versions | 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07, all through the `initialize` handshake | `sdk-versions.json` |
| **2026-07-28** | **UNSUPPORTED** (client side). The SDK does not contain the revision, and there is no `server/discover` and no per-request `_meta` version. | `sdk-versions.json` |
| Transports | stdio, Streamable HTTP. HTTP+SSE, deprecated, is not used. | `packages/mcp/src/client.ts` |
| Connection | SUPPORTED | `filesystem-connect.json` |
| Capability and discovery path | `initialize` handshake → `tools/list`. Server capabilities and instructions are not read. | `packages/mcp/src/client.ts` |
| `tools/list` | SUPPORTED for a single page. **LIMIT:** `nextCursor` is ignored, so a tool on a second page was invisible. | `filesystem-tools-list.json`, `tools-list-pagination.json` |
| `tools/call` | SUPPORTED | `filesystem-call.json`, `memory-structured.json` |
| Structured result (`structuredContent`) | read as records | `normalisation-structured.json`, `filesystem-call.json` |
| JSON inside a text block | read as records (R-8) | `normalisation-json-in-text.json` |
| Prose | never read as records | `normalisation-prose.json` |
| Errors | `isError: true` and JSON-RPC errors are both errors, never data | `errors.json`, `filesystem-error.json` |
| Timeout | a call past its timeout is an error (20 s default, `toolCallMs` configurable) | `timeout.json` |
| `resource_link` or image-only result | **LIMIT:** normalises to `empty`; never followed or read | `normalisation-links-and-images.json` |
| Negotiated version recorded | **LIMIT:** stdio servers are recorded as the literal `negotiated` (the raw handshake showed 2025-11-25) | `recorded-protocol-version.json` |
| Server stderr | **LIMIT:** piped and never read. After 200 KB of stderr, both calls timed out. | `stderr-flood.json` |
| Transport teardown | SUPPORTED: the child ends on `close()`, also after a blocked call | `filesystem-teardown.json`, `memory-teardown.json`, `teardown-local.json` |

**Preflight totals (second run):** 14 PASS, 5 LIMIT, 0 FAIL. The first run ended early because a `close()` never settled in the preflight script; `progress.md` records it and the corrections.

## 2026-07-28 and why a mismatch cannot become an upstream finding

The 2026-07-28 revision removes the `initialize` handshake and sessions. The version travels in each request's `_meta`, and servers must implement `server/discover`.

Under the specification's compatibility matrix:

- a legacy client (RigorRun) works with a dual-era or a legacy server;
- it fails against a server that speaks only 2026-07-28.

The preflight's modern-only server shows how that failure surfaces in RigorRun. It is a connect error, before any case exists: "Could not reach the MCP server … initialize is not supported: this server speaks MCP 2026-07-28 only" (`modern-only-server.json`). No verdict, FAIL or TIMED_OUT is produced, so a protocol mismatch cannot be reported as a reliability defect of the target.

No 2026-07-28 smoke test could be run, because the installed SDK does not implement the revision. RigorRun was not upgraded.

## The planned targets

| Target | Pinned package | Server era | Status | Blocks the audit? |
| --- | --- | --- | --- | --- |
| Filesystem MCP | `@modelcontextprotocol/server-filesystem` 2026.8.31 | legacy (SDK ^1.30.0, latest 2025-11-25) | **SUPPORTED** (measured) | no |
| GitHub MCP | `github/github-mcp-server`, go-sdk v1.7.0 | dual-era (go-sdk supports 2026-07-28 and answers `initialize`, capped at 2025-11-25) | **PARTIAL** (compatible by source, not measured here) | no, given the preconditions |
| Playwright MCP | `@playwright/mcp` 0.0.80 | legacy (bundled SDK declares 2025-11-25) | **PARTIAL** (compatible by source, not measured here) | no, given the preconditions |

### Preconditions before any finding is attributed upstream

Each audit must do the following against its pinned server:

1. **Record the negotiated version from a raw handshake.** RigorRun records `negotiated` for stdio servers.
2. **Compare tool counts.** Check RigorRun's discovered tool count against a raw paged `tools/list`. RigorRun ignores `nextCursor`; go-sdk's default page size is 1000.
3. **Reproduce every timeout with a raw client before calling it an upstream failure.** Measure the server's stderr volume too, because a server that logs heavily to stderr can stall RigorRun's calls.
4. **For Playwright MCP, rest verdicts on an independent verifier read.** Its results are prose snapshots and images, which normalise to text or empty and are not records. Raise `toolCallMs` for slow browser actions, keeping `caseMs >= toolCallMs + 5000`.
5. **For GitHub MCP, prefer the stdio binary or container** with the token in the environment. An HTTP bearer token only works as a secret named `Authorization`, and every project secret is handed to every connector, the verifier included.

These are limits of RigorRun's MCP client, stated so they are not mistaken for defects in the targets. They are not the independent-oracle blockers recorded in `release-gate.json`.
