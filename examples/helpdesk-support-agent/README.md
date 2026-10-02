# Example: a Larch Helpdesk support agent

An ordinary support agent: an HTTP endpoint that takes a `rigorrun/task/1` ticket, a model, and MCP
tools that call the helpdesk with **the agent's own bearer token**. RigorRun posts tickets here and
reads the helpdesk twin afterwards; it never sits between the agent and the helpdesk. Plain Node ≥
20, no npm dependencies, nothing imported from RigorRun.

| File         | What it is                                                                               |
| ------------ | ---------------------------------------------------------------------------------------- |
| `server.mjs` | The agent: prompt, MCP tool loop, `rigorrun/task/1` endpoint.                            |
| `mcp.mjs`    | Minimal streamable-HTTP MCP client (`fetch` only).                                       |
| `models.mjs` | Reused from `../stripe-support-agent/models.mjs` (Gemini or OpenAI-compatible chat API). |
| `test/`      | `node:test` against `rigorrun helpdesk twin` (run from source) and a scripted model.     |

## Token and scope

The helpdesk enforces **tenant filtering from the token**, not from the agent's code. With the scoped
support token (`tok_alder_support`), tools only see Alder Outdoor rows. With the service token
(`tok_service`), the same tool names can read and change **every** organisation — that is the
difference between an agent the helpdesk keeps in its lane and one it does not.

## Variants

| `VARIANT` | System prompt                                                                        |
| --------- | ------------------------------------------------------------------------------------ |
| `careful` | The base sentence plus: "Check whose record a ticket is about before you act on it." |
| `minimal` | The base sentence only.                                                              |

Tools are always whatever the helpdesk advertises over MCP (not trimmed by variant).

## Run against the twin

Start the Larch Helpdesk twin (from a clone of this repository):

```bash
npx rigorrun helpdesk twin    # MCP at http://127.0.0.1:12113/mcp
```

Scoped Alder support agent on a local OpenAI-compatible model:

```bash
HELPDESK_URL=http://127.0.0.1:12113/mcp HELPDESK_TOKEN=tok_alder_support \
  LLM_PROVIDER=openai OPENAI_BASE_URL=http://127.0.0.1:11434/v1 OPENAI_MODEL=llama3.1:8b \
  VARIANT=careful node examples/helpdesk-support-agent/server.mjs
```

Same agent with the **service** token (cross-tenant reads and writes are possible — use only to
demonstrate what a mis-scoped credential allows): the same command with
`HELPDESK_TOKEN=tok_service`.

Then hold it to the pack's six tickets. `try` uses the twin already running on port 12113:

```bash
npx rigorrun helpdesk try --agent http://127.0.0.1:8788/
```

Probe and metadata:

```bash
curl -s -X POST http://127.0.0.1:8788/ -H 'content-type: application/json' \
  -d '{"protocol":"rigorrun/task/1","probe":true}'
curl -s http://127.0.0.1:8788/meta
```

## Environment

| Variable                | Default                      | Meaning                                                 |
| ----------------------- | ---------------------------- | ------------------------------------------------------- |
| `PORT`                  | `8788`                       | Listens on `127.0.0.1` only.                            |
| `HELPDESK_URL`          | `http://127.0.0.1:12113/mcp` | Streamable HTTP MCP endpoint.                           |
| `HELPDESK_TOKEN`        | `tok_alder_support`          | Bearer token the agent uses for every tool call.        |
| `VARIANT`               | `careful`                    | `careful` or `minimal` (system prompt only).            |
| `LLM_PROVIDER`          | `gemini`                     | `gemini` or `openai`.                                   |
| `GEMINI_*` / `OPENAI_*` | (same as stripe example)     | Model, key, base URL, `TEMPERATURE`, `MIN_INTERVAL_MS`. |
| `MAX_TURNS`             | `12`                         | Stop after this many model tool rounds.                 |
| `TRANSCRIPT_DIR`        | `./transcripts`              | One JSONL file per ticket.                              |

## Tests

```bash
node --test examples/helpdesk-support-agent/test
```

They start `rigorrun helpdesk twin --port 0` (from source), the real `server.mjs`, and a fake model.
