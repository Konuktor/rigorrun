# Deploying for $0

RigorRun is usable with nothing deployed at all. This page covers the optional
control plane, and the deliberate limits on what it will accept.

## First: you probably do not need this

| You want to…                                            | Deploy anything? |
| ------------------------------------------------------- | ---------------- |
| Run the demo                                            | No               |
| Benchmark your own agent                                | No               |
| Gate a build in CI                                      | No               |
| Export and email a report                               | No               |
| Keep a shared index of workflows and runs across a team | Yes              |
| Share a sanitised report by link                        | Yes              |

## What gets deployed

A single Cloudflare Worker (Hono) with a D1 database, holding **metadata only**:
names, hashes, counts, scores, outcomes. There is no endpoint that accepts a
trace, a tool argument, an agent report or any page content — enforced by
schema, not by policy.

## Deploy it

```bash
# 1. Authenticate (opens a browser; free account is enough)
pnpm exec wrangler login

# 2. Create the database — D1 Free, no card required
pnpm exec wrangler d1 create rigorrun
#    Copy the printed database_id into apps/worker/wrangler.toml

# 3. Apply migrations
pnpm -F @rigorrun/worker db:remote

# 4. Deploy
pnpm -F @rigorrun/worker deploy
```

You get `https://rigorrun.<your-subdomain>.workers.dev`. Check it:

```bash
curl https://rigorrun.<your-subdomain>.workers.dev/api/health
```

**Never accept a prompt to enable Workers Paid.** Nothing here needs it.

## Run it locally first

No Cloudflare account required — this runs the real Workers runtime with a real
local D1:

```bash
pnpm -F @rigorrun/worker db:local
pnpm -F @rigorrun/worker dev          # http://127.0.0.1:8787

curl -X POST http://127.0.0.1:8787/api/workspaces
```

## Using it

```bash
# Create a guest workspace — the token is shown exactly once
curl -X POST https://<your-worker>/api/workspaces

export RIGORRUN_API_URL=https://<your-worker>
export RIGORRUN_WORKSPACE=ws_…
export RIGORRUN_TOKEN=…
```

Only the token's SHA-256 is stored server-side, so a database leak does not
yield usable credentials.

## API

| Method   | Path                    | Auth   | Purpose                                   |
| -------- | ----------------------- | ------ | ----------------------------------------- |
| `GET`    | `/api/health`           | —      | Liveness and what the service stores      |
| `POST`   | `/api/workspaces`       | —      | Create a guest workspace (10/hour per IP) |
| `POST`   | `/api/workflows`        | Bearer | Upsert workflow metadata + case index     |
| `GET`    | `/api/workflows/:id`    | Bearer | Read it back                              |
| `DELETE` | `/api/workflows/:id`    | Bearer | Delete it and its cases                   |
| `POST`   | `/api/runs`             | Bearer | Register a run                            |
| `POST`   | `/api/runs/:id/results` | Bearer | Attach per-case outcomes                  |
| `GET`    | `/api/runs/:id`         | Bearer | Run plus per-agent aggregates             |
| `POST`   | `/api/publish`          | Bearer | Publish a sanitised report                |
| `GET`    | `/api/reports/:id`      | —      | Read a published report                   |

Auth is `Authorization: Bearer <token>` plus `X-RigorRun-Workspace: <id>`.

## Static hosting for the apps (optional)

Both apps build to static files and can go on any free static host — Cloudflare
Pages, GitHub Pages, Netlify:

```bash
pnpm build:web    # apps/web/dist
pnpm build:crm    # apps/demo-crm/dist
```

The dashboard executes the benchmark in the browser, so a static host is
genuinely enough — there is no server to run.

## Keeping it free

| Guardrail             | How                                                        |
| --------------------- | ---------------------------------------------------------- |
| No paid binding       | `wrangler.toml` declares only Workers + D1                 |
| No unbounded storage  | Metadata only; published reports expire after 30 days      |
| No table scans        | Every filtered column is indexed; D1 Free meters rows read |
| No oversized payloads | Requests are capped at 256 KB before parsing               |
| No abuse              | Fixed-window rate limits per IP and per workspace          |

See [COST_GUARDRAILS.md](COST_GUARDRAILS.md) for the full table.

## Custom domain

`workers.dev` is free and sufficient. A custom domain (`rigorrun.xyz`, say)
requires you to own the domain; nothing in this repository assumes one, and
none is purchased or configured.

## Troubleshooting

| Symptom                                 | Cause                    | Fix                                                  |
| --------------------------------------- | ------------------------ | ---------------------------------------------------- |
| `Not logged in… could not be refreshed` | Expired OAuth session    | `pnpm exec wrangler login`                           |
| `D1_ERROR: no such table`               | Migrations not applied   | `pnpm -F @rigorrun/worker db:remote`                 |
| `database_id` placeholder error         | Step 2 not completed     | Paste the real id into `wrangler.toml`               |
| 401 on every call                       | Missing workspace header | Send both `Authorization` and `X-RigorRun-Workspace` |
