# Cloudflare readiness

An engineering statement of what Cloudflare does and does not power in RigorRun,
written 10 September 2026. It is not an application, and nothing in it should be
quoted as a business claim.

Everything below was checked against the live account, not against memory.

---

## What Cloudflare powers today

**Pages, and DNS. Nothing else.**

| Project | Domains | What it serves |
| --- | --- | --- |
| `rigorrun` | `rigorrun.xyz`, `rigorrun.pages.dev` | The static site |
| `rigorrun-crm` | `rigorrun-crm.pages.dev` | Northstar Support, the synthetic example application |
| `rigorrun-ops` | `rigorrun-ops.pages.dev` | Four synthetic schema-driven systems |

Plus DNS for the `rigorrun.xyz` zone, which is required because Pages can only
attach an apex domain that is a Cloudflare zone. The registrar is Gen.xyz.

All three are static asset hosting on the free plan. There is no metered compute
anywhere in the product.

## What Cloudflare does not power

**The product.** RigorRun runs on the user's machine. It is a local process that
serves an interface and talks to the user's own systems, and there is no path by
which a recording, a credential or a system's state reaches anybody's
infrastructure. This is not a policy that could be changed by configuration; it
is the absence of a client.

Verified rather than asserted. Every external hostname in the shipped CLI
bundle, and none of them is ours:

```console
$ tar -xzOf dist/rigorrun-0.2.0.tgz package/dist/rigorrun.mjs \
    | grep -oE 'https://[a-zA-Z0-9./_-]{6,60}' | sort -u
https://api.groq.com/openai/v1
https://generativelanguage.googleapis.com/v1beta/models
https://registry.npmjs.org
https://rigorrun.xyz
```

`rigorrun.xyz` is a string in the manifest, not a call. `registry.npmjs.org` is
where `rigorrun verify` resolves an `npm:` reference and fetches the tarball it
then hashes. The two model endpoints are reached only if the user sets
`GEMINI_API_KEY` or `GROQ_API_KEY`; the default is offline and deterministic.

The same command finds no occurrence of `workers.dev`, `control-plane` or the
account subdomain. Neither does the deployed site bundle.

There is **no Worker, D1, R2, KV, Queue, Workflow or Durable Object source in
this repository**, and no `wrangler.toml` or `wrangler.jsonc` anywhere.
`wrangler` is a devDependency used for `wrangler pages deploy` and nothing else.

## The thing that is still deployed

**A Cloudflare Worker named `rigorrun` is live and its source does not exist.**

```console
$ curl -sS https://rigorrun.takhiroverbol.workers.dev/api/health
{"ok":true,"service":"rigorrun-control-plane","env":"production","time":"…",
 "note":"Metadata only. Traces, evidence and customer content never reach this service."}

$ curl -sS -o /dev/null -w '%{http_code}\n' https://rigorrun.takhiroverbol.workers.dev/api/runs
401
```

`/api/runs` accepts `GET, POST, DELETE`. The Worker is bound to a D1 database
named `rigorrun` (`197aef92-985a-41ec-a29a-87c318cb1345`) which currently has
**0 tables**.

The code was removed in commit `b1e121c` — "Delete the control plane nothing was
calling" — which deleted `apps/worker/`, its migrations and its 23 tests. The
deployment was never torn down.

**What this is and is not.** It is an orphan, not a leak. No part of the shipped
product references it: neither the published CLI bundle nor the deployed site
bundle contains its address, and both were grepped. It was called by nothing
before it was deleted, which is why it was deleted.

**Why it should still go.** It is a publicly reachable, unversioned endpoint
carrying the product's name, with write scope on a database, whose behaviour
nobody can review because the source is gone. Its own health response makes a
privacy claim — "traces, evidence and customer content never reach this service"
— that no one can now verify. And it makes "RigorRun has no hosted component"
require a footnote.

**Teardown, recorded and not run.** This was not authorised in this pass.

```bash
npx wrangler delete --name rigorrun
npx wrangler d1 delete rigorrun    # 197aef92-985a-41ec-a29a-87c318cb1345, 0 tables
```

`jobtrail-worker` and `sbfinance-license-server` are unrelated projects on the
same account and must not be touched.

## Security and privacy boundary

The boundary is architectural, and stating it precisely is the point:

- **Nothing leaves the machine unless a person exports it.** Recordings, tool
  arguments, credentials, system state and run results are files under
  `~/.rigorrun`.
- **Credentials live in the OS keychain** — macOS Keychain, libsecret, Windows
  DPAPI — with an owner-only file when none is present. The backend is chosen by
  a write-read-delete round trip rather than by platform name.
- **Publishing is an explicit, previewed, sanitising step.** A published report
  is structurally stripped of task inputs, tool arguments, evidence and agent
  prose.
- **`feedback export` refuses to write** if it finds a stored secret in what it
  assembled.

Any future hosted feature has to preserve all four. That is a design constraint,
not an aspiration: a local-only mode that still does everything must remain.

## What a future product need could legitimately use

Written as hypotheses, none of them built, none of them promised.

**Would genuinely benefit from Cloudflare:**

- **A public conformance registry.** `rigorrun verify` produces a canonically
  serialised, re-hashable record about a *public* artifact — an npm package at a
  known digest. Nothing in it is anyone's private data. Publishing those records
  for many servers is a read-heavy, globally-cached, static-shaped workload,
  which is what Pages and R2 are for. This is the one cloud feature the product
  actually points at.
- **Scheduled re-verification.** A server's digest changes when it is republished;
  a record is only true of the digest it names. Re-running on a schedule and
  diffing two records is a cron and a queue.
- **Sanitised CI summaries**, opt-in, carrying a verdict and counts and no tool
  arguments.

**Would not, and should not be built to look good:**

- Storing traces, evidence, tool arguments or system state. That inverts the
  product.
- A hosted runner. It cannot reach `http://127.0.0.1`, which is where the systems
  people want tested actually are.
- Multi-user, billing, an organisation model. Blocked behind the project's own
  Gate 3 — three independent organisations watching — and building them earlier
  is what that gate exists to prevent.

## Expected scaling shape, if the registry is built

Read-dominated and cacheable: records are immutable once written, keyed by
`(package, version, digest, harness version)`. Writes come from a verification
run, which is minutes of container work — so the write path is a queue, not a
request path. Nothing about it needs a database in the request path, and the
honest first version is object storage plus a static index.

## What would be dishonest to claim

- That RigorRun uses Cloudflare for anything beyond static hosting and DNS. It
  does not.
- That the deployed Worker is part of the product. It is not, and was not before
  it was deleted.
- That there is a control plane, a hosted console, sync, or multi-user support.
  None exists.
- That any of the above is close. The registry above is a design sketch with no
  code behind it.
- That Cloudflare costs are optimised. There is nothing to optimise: the product
  cannot generate a bill because no part of it runs on metered compute.
