# Product reality audit

What RigorRun can actually do for a person who has never seen this source.

> **This document has two halves.** The audit below was written first, against
> commit `e1ced9b`, and answered all twenty of its questions NO. The work that
> followed was aimed squarely at it. [What changed](#what-changed) at the bottom
> re-answers every question against the current build, and says which ones are
> still NO.
>
> The original answers are left exactly as written. A product audit that gets
> quietly edited as things improve is a product audit nobody can trust the next
> time it says something uncomfortable.

This document is written against the deployed build and the repository at
commit `e1ced9b`, not against intent. Every claim carries a file, a line or a
command whose output can be reproduced. Where the answer is NO, the current
behaviour is marked **DEMO-ONLY**, which means: it works, it is tested, and it
works only for material that ships inside RigorRun.

The pipeline in the middle of this product is real. The unit suite is green —
`pnpm test` reports **439 passing across 22 files** — and the sixth-domain
acceptance test (`packages/environments/test/unknownDomain.test.ts`) genuinely
proves the compiler has no business vocabulary in it. None of that is in
question here. What is in question is whether any of it is *reachable* by
someone outside this repository.

## Summary

**Twenty questions asked. Twenty answers are NO.**

The single sentence version: *there is no way to get material that did not ship
inside RigorRun into RigorRun.* Every entry point — the UI, the CLI, the
environment SDK, the agent registry — either has no input surface at all, or
resolves its input against a registry that is populated exclusively by the five
bundled demo workflows.

The two findings that matter most, because they are the ones that look solved
and are not:

1. **`rigorrun init-environment` scaffolds files that no RigorRun command can
   load.** The scaffolded README tells you to run
   `rigorrun inspect-environment <name>` next. That command resolves against a
   registry populated only by `import '@rigorrun/environments'`, so it fails:

   ```
   $ pnpm rigorrun inspect-environment my-system
   error Unknown environment "my-system". Registered environments:
   finance-invoice, it-access, ops-fulfillment, sales-lead, support-refund.
   ```

   The documented thirty-minute "point RigorRun at your own system" path
   (`docs/CONNECT_ENVIRONMENT_30_MINUTES.md`) is a dead end at its final step.
   The only way to finish it is to edit `packages/environments/src/registry.ts`
   — that is, to edit RigorRun.

2. **There is no input surface anywhere in the product UI.** `apps/web/src`
   contains zero `<input>`, `<textarea>` and `<select>` elements. There is
   nothing to type a URL, a command, an endpoint or a project name into.

## The twenty questions

| # | Question | Answer | Evidence |
| - | -------- | ------ | -------- |
| 1 | Can a new external user create a project? | **NO** | No project concept exists. `grep -rn '\bproject\b' apps/*/src packages/*/src` returns two hits, both incidental English in comments. **DEMO-ONLY** |
| 2 | Can they persist it? | **NO** | `apps/web/src` contains no `localStorage`, no `sessionStorage`, no `IndexedDB` and no `fetch`. The only cross-reload state is the URL hash; a refresh recomputes the pipeline from scratch (`apps/web/src/demo/useDemo.ts:357-408`). **DEMO-ONLY** |
| 3 | Can they connect their own MCP server? | **NO** | There is no MCP implementation. Repo-wide grep for `modelcontextprotocol` and `MCP` returns zero hits in code; the sole `pnpm-lock.yaml` match is a base64 integrity hash. No package depends on an MCP SDK. **DEMO-ONLY** |
| 4 | Can they connect a local MCP server? | **NO** | As above. No stdio transport, no subprocess spawning anywhere in `packages/`. **DEMO-ONLY** |
| 5 | Can they connect a remote MCP server? | **NO** | As above. No HTTP or SSE MCP transport. **DEMO-ONLY** |
| 6 | Can they connect an OpenAPI system? | **NO** | No OpenAPI parser, no spec ingestion, no operation mapping anywhere in the repository. **DEMO-ONLY** |
| 7 | Can they connect a browser application? | **NO** | `docs/ROADMAP.md:33` states it plainly: "No browser execution lane." `STATUS_ADVANTAGE.md` rows 13 mark it "not built". The Chrome recorder exists but its `host_permissions` are `http://localhost/*` and `http://127.0.0.1/*` only (`apps/extension/manifest.json`), so it structurally cannot record a customer's staging site. **DEMO-ONLY** |
| 8 | Can they connect their own agent? | **NO** | An HTTP agent adapter exists and is real (`packages/agents/src/http.ts:79`), but nothing exposes it. The CLI defines no endpoint flag (`packages/cli/src/main.ts:52-72`) and the UI has no input. The only route is to write TypeScript calling `availableAgents({ httpAgents })` (`packages/agents/src/registry.ts:37`) — i.e. inside this repository. **DEMO-ONLY** |
| 9 | Can they invoke their own agent from RigorRun? | **NO** | Same cause as 8. The web app never imports the HTTP adapter; its agents are hardcoded: `const agents = [naiveAgent, carefulAgent, createReferenceAgent(benchmark)]` (`apps/web/src/demo/useDemo.ts:216`). **DEMO-ONLY** |
| 10 | Can an existing MCP-based agent be evaluated without rewriting it? | **NO** | No MCP, and no proxy. The one external protocol that exists is harness-driven: RigorRun runs the loop and the agent must reply with one tool call at a time (`docs/AGENT_PROTOCOL.md`), which is a rewrite of any agent that owns its own loop. **DEMO-ONLY** |
| 11 | Can a user record their own workflow? | **NO** | The recorder captures real interactions and is well tested (`e2e/extension.spec.ts`), but only against localhost, and the resulting trace is unusable without a registered environment — `cmdCompile` calls `createEnvironment(trace.environmentId)` (`packages/cli/src/commands.ts:206`), which only resolves the five bundled ids. **DEMO-ONLY** |
| 12 | Can RigorRun infer a contract from THEIR workflow? | **NO** | Induction reads a declared `EnvironmentSchema` with semantic `role` annotations (`packages/environment/src/schema.ts:29`). Nothing derives such a schema from a real system; it must be hand-authored, and once authored it cannot be loaded (finding 1). **DEMO-ONLY** |
| 13 | Can RigorRun generate cases against THEIR system? | **NO** | `cmdGenerate` resolves the environment through `listEnvironments()` (`packages/cli/src/commands.ts:246`) and fails on anything not bundled. **DEMO-ONLY** |
| 14 | Can RigorRun reset THEIR environment between cases? | **NO** | `reset()` and `seed()` are required methods on `EnvironmentAdapter` (`packages/environment/src/adapter.ts:126-127`), satisfiable only by an in-process fake. There is no reset tool, endpoint, command or snapshot strategy for an external system, and no concept of an environment that cannot be reset. **DEMO-ONLY** |
| 15 | Can RigorRun inspect THEIR authoritative state? | **NO** | Verification reads `getState(): CanonicalState` (`adapter.ts:129`), which asks an environment to hand over its entire world keyed by id. No real system offers that, and there is no partial or designated-read alternative. **DEMO-ONLY** |
| 16 | Can RigorRun execute tests safely without touching production? | **NO** | There is no environment safety mode, no production/staging/local distinction, no write gating and no destructive-action confirmation anywhere in the codebase. The question has never had to be asked because every environment is an in-memory object. **DEMO-ONLY** |
| 17 | Can they run all of this from the public UI? | **NO** | Three routes exist — `home`, `demo`, `proof` (`apps/web/src/App.tsx:10-11`) — and zero input elements. The step labelled "Connect agent" (`useDemo.ts:69`) renders a progress bar over the three hardcoded agents. **DEMO-ONLY** |
| 18 | Can they run all of this from CLI/CI? | **NO** | The exit-code contract is real and usable (`packages/cli/src/main.ts:1-8`), and CI does gate on it — but only over bundled material. There is no flag to supply an environment, an agent endpoint or a project. **DEMO-ONLY** |
| 19 | Can they do it without editing RigorRun core? | **NO** | This is finding 1. The scaffolder writes to `environments/<slug>/`; the loader reads a registry populated by `packages/environments/src/registry.ts:60`. Nothing bridges the two. **DEMO-ONLY** |
| 20 | Can they get value without using Northstar or another bundled demo? | **NO** | Every path terminates in one of the five bundled workflows. The CLI's demo defaults to `'refund'` (`packages/cli/src/commands.ts:57`); the web app hardcodes `DEFAULT_WORKFLOW = 'refund'` (`useDemo.ts:81`) and offers no picker. **DEMO-ONLY** |

## Three shipped surfaces that are not true

These are separate from the twenty questions. They are places where the product
currently asserts something that is false, which is worse than a missing
feature.

**The landing page publishes counts that contradict the pipeline.**
`apps/web/src/pages/Landing.tsx:11-37` hardcodes "18 sanitised events",
"5 observed · 7 inferred", "17 cases · 10 categories" — under the sentence
"every count is what the live demo produces when you run it"
(`Landing.tsx:124-127`). The pipeline produces 7 trace steps, 3 observed facts,
19 proposed rules, 22 cases and 9 categories (`apps/web/src/proof.json`). The
copy appears to be pinned to `examples/refund-workflow`, which is itself stale.

**The CI benchmark gate is broken and has been reported as green.**
`.github/workflows/ci.yml:94` and `:100` invoke `--agent demo-robust` and
`--agent demo-weak`. Those ids do not exist:

```
$ pnpm rigorrun agents
naive    Agent A (naive)
careful  Agent B (careful)
```

`resolveAgent` throws on an unknown id (`packages/agents/src/registry.ts:45`),
so both steps exit 2 rather than the expected 0 and 1. Separately,
`examples/refund-workflow/benchmark.json` declares `"environment": "northstar"`,
an id that no longer exists in the registry. `STATUS.md`'s claim that every
gate is green does not hold for CI.

**`/proof` is a static snapshot presented as evidence.** The page renders a
committed JSON file stamped `"commit": "bb92b06"`
(`apps/web/src/proof.json`), four commits behind HEAD. It is generated by
running the real pipeline (`scripts/build-proof.mjs`), so it is not fabricated —
but it is regenerated only by `pnpm release:verify`, which CI does not run.

`STATUS.md` also reports "403 passing across 20 files"; the current figure is
439 across 22.

## What is real

Stated for balance, because the list is not short and none of it needs
rewriting:

- The compiler, generator, projection engine, verifier, scoring and benchmark
  self-grading, exercised by 439 passing tests.
- The domain-blindness claim. `pnpm domain` is a genuine enforced constraint,
  and `unknownDomain.test.ts` compiles a domain that exists only inside a test
  file, with no product changes.
- The demo's arithmetic. The six-step journey really does execute the same
  packages the CLI uses, in the browser, at click time.
- The Cloudflare control plane: real D1 schema, hashed bearer tokens,
  per-query ownership filtering, tested against real SQL. It is called by
  nothing in this repository — the CLI contains no `fetch` at all — but it works.
- The HTTP agent adapter's hardening: SSRF guard, redirects refused, response
  size capped (`packages/agents/src/http.ts:55-150`).
- The recorder's credential handling, and the redaction module behind it.

## Conclusion

RigorRun is a correct and well-tested engine with no way in. Every one of the
twenty capabilities a new user needs is either absent or reachable only by
editing this repository. Passing 439 internal tests is evidence that the engine
works on material RigorRun already had; it is not evidence that the product is
usable, and it should not be reported as such.


---

<a id="what-changed"></a>

## What changed

Re-answered against the current build. The evidence for every YES is a test
that runs in CI, named beside it.

| # | Question | Then | Now | Evidence |
| - | -------- | ---- | --- | -------- |
| 1 | Create a project? | NO | **YES** | `e2e/external-user.spec.ts` creates one in a browser |
| 2 | Persist it? | NO | **YES** | `packages/daemon/test/store.test.ts` |
| 3 | Connect their own MCP server? | NO | **YES** | `packages/mcp/test/connect.test.ts` — a real handshake with a separate package |
| 4 | Local MCP server? | NO | **YES** | stdio transport; the fixture is spawned as a child process |
| 5 | Remote MCP server? | NO | **YES** | streamable HTTP transport; `packages/mcp/test/safety.test.ts` covers the guards |
| 6 | OpenAPI system? | NO | **NO** | Not built. Deferred on purpose; see `docs/ROADMAP.md` |
| 7 | Browser application? | NO | **NO** | Not built. Still the largest gap for anybody with no API |
| 8 | Connect their own agent? | NO | **YES** | `packages/daemon/test/externalAgent.test.ts` |
| 9 | Invoke their own agent? | NO | **YES** | Same test; the agent is a separate process |
| 10 | Evaluate an existing MCP agent without rewriting it? | NO | **YES** | `packages/proxy/test/proxy.test.ts` drives it with the SDK's own client |
| 11 | Record their own workflow? | NO | **YES** | Through the MCP operator, in the browser |
| 12 | Infer a contract from *their* workflow? | NO | **YES** | `packages/mcp/test/induce.test.ts`, including the renamed-fields test |
| 13 | Generate cases against *their* system? | NO | **YES** | `packages/daemon/test/freshUser.test.ts` |
| 14 | Reset *their* environment? | NO | **YES** | A nominated reset tool; without one it says `ISOLATION: NONE` |
| 15 | Inspect *their* authoritative state? | NO | **YES** | Nominated verifier reads; labelled `PARTIAL` because it is |
| 16 | Execute safely without touching production? | NO | **YES** | Safety modes; writes refused at the channel and recorded |
| 17 | All of it from the UI? | NO | **YES** | `e2e/external-user.spec.ts`, with screenshots in `docs/external-user-run/` |
| 18 | All of it from CLI/CI? | NO | **PARTLY** | Running and gating a project: yes. Connecting and teaching are interface-only |
| 19 | Without editing RigorRun? | NO | **YES** | Both dogfood fixtures import nothing from RigorRun but the public agent SDK |
| 20 | Value without Northstar? | NO | **YES** | Northstar is not on any product path |

**Sixteen YES, two NO, one PARTLY, one that needs qualifying.**

### The ones that are still NO

**OpenAPI and browser connectors do not exist.** MCP is the only way to connect
a system. That was a deliberate choice — depth on one path over breadth across
four — but it means anybody whose system has no MCP server has to write one.

**Connecting and teaching are interface-only.** `rigorrun run --project` and
`rigorrun gate --project` work from a build server with no interface and no
person. Setting a project *up* still needs the interface, because both steps are
interactive by nature: you are looking at what came back. A headless setup path
is not built.

### The ones that need qualifying

**Nothing is published to npm.** Every doc says `pnpm dlx rigorrun`, and every
one of them also says it is a clone today. That is the single largest piece of
friction between this and a stranger actually using it.

**Discovery and recordings live in the runner's memory.** Reloading the page in
the middle of connecting or recording loses them. The interface says so and
offers the way back rather than looking broken, but a person who reloads at the
wrong moment repeats a step.

**The verdict a real system produces is `PARTIAL`, not `AUTHORITATIVE`.** That
is correct rather than a shortcoming — RigorRun reads back what the nominated
reads return and no more — but it means a verdict from a real system is a
weaker claim than one from the bundled example, and that is stated on every
result rather than smoothed over.

**The control plane is still called by nothing.** It is deployed, tested, and
unused by the product.

### What the technical gates now measure, and what they do not

`pnpm verify` still measures whether RigorRun works on material that ships
inside RigorRun. The gate that measures whether a stranger can use it is
`pnpm e2e:external`, and it runs as its own CI job. A release where only the
first is green is not a release.
