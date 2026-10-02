# T-010 · Permissions (Phase 4): the matrix v0, a credential-aware MCP connection, `permissions draft`

- **Agent:** codex
- **Base branch:** phase4/prep
- **Worktree:** ~/RigorRun-agents/codex-T-010 (branch agent/codex/T-010)
- **Time box:** 120 min
- **Phase:** 4. Changes stay inside `packages/env-permissions/`.

## Read first

`AGENTS.md`, `docs/context/tasks/PHASE-4-DESIGN.md` (D1, D6), `packages/mcp/src/client.ts`
(`McpConnection.open`, `McpConfig` in `packages/mcp/src/config.ts`), `packages/env-helpdesk/src/`
for code style only.

## Goal

The first three pieces of `packages/env-permissions` (a generic package: the domain-leak gate
forbids domain nouns such as customer, ticket, order, patient in its source — every noun comes from
the user's matrix):

1. `src/matrix.ts` — the permission matrix v0: a zod schema, `parseMatrix(json)`, and
   `unconfirmed(matrix)`.
2. `src/connection.ts` — open an MCP connection as one side (agent or observer) with that side's
   credential applied, and call a tool expecting JSON.
3. `src/draft.ts` + `src/cli/draft.ts` — `rigorrun permissions draft`: connect as the agent, list
   the server's tools, and write a draft matrix for a person to edit and confirm.

## Files you may change

- `packages/env-permissions/src/**`, `packages/env-permissions/test/**`

## Do not touch

Everything else (no other package, no `package.json`, no CLI registration — Claude wires the
command into `packages/cli`). Do not run `pnpm install`.

## Details

**Matrix v0 (JSON).** All fields below; `?` = optional. Validate strictly (unknown keys rejected).

```json
{
  "version": 0,
  "unconfirmed": ["reads", "tenant.field"],
  "server": { "transport": "stdio", "command": "node", "args": ["server.js"] },
  "credentials": {
    "agent": { "secret": "A_KEY", "apply": { "header": "Authorization", "prefix": "Bearer " } },
    "observer": { "secret": "B_KEY", "apply": { "env": "SERVER_KEY" } }
  },
  "tenant": { "field": "org_id", "a": "alder", "b": "birch", "label": "organisation" },
  "labels": { "record": "order", "person": "client" },
  "reads": [{ "tool": "list_x", "args": {}, "rows": "items", "entity": "x" }],
  "reference": { "entity": "x", "field": "ref" },
  "person": { "entity": "y", "name_field": "name" },
  "fingerprint_fields": ["email", "phone", "notes"],
  "plant?": { "tool": "add_note", "args": { "id": "{{b.record}}", "text": "{{marker}}" } },
  "audit?": {
    "source": { "mcp": { "tool": "audit_log", "args": {} } },
    "rows": "rows",
    "owner_field": "row_org_id",
    "actor_field": "token",
    "actor": "tok_a"
  },
  "sinks?": [{ "tool": "send_message", "recipient_arg": "to" }],
  "forbidden?": [{ "tool": "delete_y", "ask": "delete the account of" }],
  "reset?": { "tool": "reset", "args": {} },
  "outside_address": "exfil@example.net",
  "policy": ["Act only for the requester's own records.", "…"]
}
```

- `server`: `{transport:"stdio", command, args[], env?}` or `{transport:"http", url}`.
- `credentials.*.apply`: exactly one of `{header, prefix?}` (HTTP) or `{env}` (stdio).
  `secret` is the **name** of an environment variable / stored secret, never a value.
- `audit.source`: exactly one of `{mcp:{tool,args}}` or `{http:{url, header?, prefix?, secret?}}`.
- `reads[].rows`: a dotted path to the row array in the tool's JSON result (`""` = the result
  itself is the array). `tenant.field` is a dotted path inside a row.
- `unconfirmed`: a list of dotted paths a person has not confirmed. `unconfirmed(matrix)` returns
  it; `assertConfirmed(matrix)` throws a readable error naming every path while it is non-empty.

**Connection (`src/connection.ts`).**
`openSide(matrix, side: 'agent' | 'observer', secretValue: string): Promise<McpConnection>`
builds the `McpConfig` from `matrix.server` and applies the credential: HTTP → header
`apply.header` with value `(apply.prefix ?? '') + secretValue`; stdio → env `apply.env`. A
mismatch (header on stdio, env on http) is an error. `callJson(connection, tool, args)` calls the
tool and returns its parsed JSON: structured content if present, else the first text part parsed as
JSON; an MCP error or non-JSON text throws an error naming the tool. Use the existing
`McpConnection` API — read it, do not reimplement MCP.

**Draft (`src/draft.ts`, pure).** `draftMatrix(tools: DiscoveredTool[], server, credentials)`
returns a matrix whose every guessed field is listed in `unconfirmed`:

- `reads`: tools annotated `readOnlyHint: true`, or named `list_*`, `get_*`, `search_*`, `find_*`,
  `export_*`, whose required arguments are none (args `{}`), `rows: ""`, `entity` = the name
  without its verb prefix.
- `sinks`: tools whose names contain `send`, `email`, `message`, `notify` or `share` and have an
  argument named `to`, `email`, `recipient`, `phone` or `address` (`recipient_arg` = that name).
- `forbidden`: tools whose names start with `delete`, `remove`, `purge`, `drop` or `export`, with
  `ask` = `"<verb> "` + a placeholder (`"TODO: what a requester would ask for"`).
- `reset`: a tool whose name contains `reset`, if exactly one.
- `tenant`, `labels`, `reference`, `person`, `fingerprint_fields`, `policy`: placeholders
  (`"TODO"`), always unconfirmed. `outside_address`: `"exfil@example.net"`, unconfirmed.

**CLI (`src/cli/draft.ts`).** `cmdDraft(argv): Promise<number>` with
`--mcp-command <cmd> [--mcp-arg <a>]…` or `--mcp-url <url>`, `--agent-secret <ENV_NAME>`,
`--apply-header <name> [--apply-prefix <p>]` or `--apply-env <name>`, `--out <file>` (default
`permissions.json`), `--json`. Reads the secret value from the environment variable named, never
prints it, lists tools as the agent, writes the draft, prints a short summary: the tools found,
what was guessed for each section, and "edit, then remove each path from `unconfirmed`". Export
`cmdDraft` and a `DRAFT_USAGE` string from `src/index.ts` with the other modules.

## Tests (`test/*.test.ts`, vitest; run from the repo root)

- matrix: a full valid matrix parses; unknown key rejected; header-and-env both set rejected;
  `assertConfirmed` lists the paths;
- draft: on a fixed `DiscoveredTool[]` (write it in the test) the guesses are exactly as specified;
- connection: `openSide` builds the right config for stdio env and http header (test the config
  builder as a pure function; a live stdio round-trip against
  `fixtures/external/mcp-venue-desk/src/stdio.ts` via `node --import tsx` if your sandbox can spawn
  processes, else say so);
- cli: `cmdDraft` against the venue-desk stdio server writes a file that `parseMatrix` accepts
  (skip with a reason if the sandbox cannot spawn).

## Acceptance (run these; all must pass)

```sh
pnpm vitest run packages/env-permissions
pnpm lint && pnpm typecheck && pnpm domain
```

## Report back

Files changed, each command and its result, tests skipped and why. Nothing outside
`packages/env-permissions/` may change.
