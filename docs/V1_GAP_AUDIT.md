# v1 gap audit

Written against commit `7ef0750` on 6 September 2026 by walking the product
rather than by reading its tests, and re-answered at `v0.1.0` against what the
public registry serves. **Revised 10 September 2026 at `v0.2.0`**, after a
due-diligence pass that found six shipped behaviours claiming more than they
had checked. Those are recorded privately; the rows here are
updated to match.

**A test passing is not evidence a capability exists.** A test proves that a
path works when called the way the test calls it. Half the entries below were
marked down after doing the thing by hand and finding a step nobody had ever
had to take — the install command that 404s is the largest, and it is green in
a test that asserts the *documentation* says it.

So each row names what was actually done. Where the evidence is a command, it
is one you can run.

| Mark | Means |
| --- | --- |
| **WORKING** | A person outside this repository can do this, against their own system. Checked by doing it. |
| **PARTIAL** | Real, reachable, and narrower than the sentence describing it. The narrowing is named. |
| **DEMO-ONLY** | Works, and only for material that ships inside RigorRun. |
| **BROKEN** | Documented, reachable, and does not work. |
| **MISSING** | Not built. |

---

## The thing that was broken

**Installing it. Was BROKEN. Now WORKING.**

For the whole of this project's life, every install instruction in it pointed
at a package that did not exist. That is fixed:

```console
$ npm view rigorrun version
0.1.0
$ npm view rigorrun dist-tags
{ latest: '0.1.0' }
```

Checked the way it matters — a clean `HOME`, a clean npm cache, a directory
that is not this repository, nothing linked:

```console
$ npx --yes rigorrun --version
0.1.0
```

The cache that run created holds
`https://registry.npmjs.org/rigorrun/-/rigorrun-0.1.0.tgz` with the same
integrity hash the registry publishes, so that command genuinely fetched the
public artifact rather than anything local.

**The SDKs are still BROKEN, for the original reason.** All seventeen workspace
packages remain `private: true`. `docs/TYPESCRIPT_AGENT_SDK.md` opens with an
`npm i @rigorrun/agent-sdk` that resolves only inside this checkout. The Python
SDK is standard-library only and can be vendored by copying one file, which is
the only SDK anybody outside can use today.

---

## Verifying a server nobody wrote

| Capability | Mark | How it was checked |
| --- | --- | --- |
| One command says whether a published server's tools do what it declares | **WORKING** | `rigorrun verify npm:@modelcontextprotocol/server-memory@2026.8.31`, from a tarball installed into a directory that had never seen RigorRun with a `HOME` that did not exist. `pnpm gate1`, eight checks, 14.9s of machine runtime. |
| Pin a server to the exact bytes the registry published | **WORKING** | The sha512 the registry serves is taken before anything unpacks and the run is refused if the download does not hash to it. The digest is in every record. |
| Run it without letting it reach anything | **WORKING** | No network, no mounts, no capabilities, no environment, non-root user, read-only root. The literal container argv is recorded. Lifecycle scripts are disabled during install, because a postinstall on an untrusted package is arbitrary code with your credentials before any container exists. |
| Measure whether reset actually resets | **WORKING** | Two containers started from the same image and their initial states hashed and compared, which is why isolation can say `PARTIAL` here. |
| Catch a server whose annotation contradicts its behaviour | **PARTIAL** | Demonstrated on a fixture written to contain one (`fixtures/external/mcp-attested-lookup`, exits 1). **No third-party server tested has contradicted anything**, and that is a fact about four servers from one publisher, not about the population. |
| Exercise a server's whole surface | **PARTIAL** | 19 of 37 tools across four real servers — 51%. `server-filesystem` is 2 of 14: nine of its tools want a real path and the planner will not generate a string containing a path separator, because that is the shape that turns a benign call into a traversal. Every unreached tool is named with a reason in the record's mandatory `untested` array. |
| Verify anything that is not an npm package or a directory | **MISSING** | An OCI image, a git ref and a remote endpoint are refused rather than half-supported. Only stdio servers. |
| Run without Docker | **MISSING** | It is the boundary. Without a container runtime the command exits 2 saying so. |
| Sign a record | **MISSING** | Records are hashed and re-hashable from the file on disk. No HMAC, Ed25519, sigstore or attestation. |

---

## Getting to a verdict

| Capability | Mark | How it was checked |
| --- | --- | --- |
| One command starts a runner, which prints a URL and opens a browser | **WORKING** | `npx rigorrun` from the public registry, in a clean `HOME` and cache; it prints a paired URL and serves an interface. A headless box gets the URL printed, which is the only fallback that works everywhere. |
| Connect an MCP server on this machine (stdio) | **WORKING** | Against `@modelcontextprotocol/server-filesystem` and `server-memory` from npm, unmodified — software nobody here wrote. `docs/THIRD_PARTY_DOGFOOD.md`. And, from the registry-installed package, against a lending desk written for the occasion in a business RigorRun has never seen: seven tools discovered, four rules learned from one demonstration, a verdict, and a regression caught. |
| Connect a remote MCP server (streamable HTTP) | **WORKING** | Against a server in its own process over real HTTP. |
| Sign in to an MCP server that requires OAuth | **WORKING** | Against an authorization server that issues metadata, registers dynamically, and checks the PKCE challenge, with the MCP server behind a gateway that answers 401 the way a resource server must. Tokens land in the credential store; a second connection opens no browser. |
| Connect an HTTP API from an OpenAPI 3 document | **WORKING** | JSON natively, YAML when the optional dependency is present. No discovered write endpoint is ever called during setup. |
| Connect a web application through a browser | **PARTIAL** | Works, and a browser cannot verify itself: without a readable system attached, every verdict from one says `OBSERVATIONAL`, and the type refuses to let a browser be its own verifier. That is the honest ceiling, not a gap to close. |
| Teach one job by doing it, and have it survive a reload | **WORKING** | Demonstrated in a browser, page reloaded mid-recording, resumed. A read-only recording resumes too — that took a fix, because "no entries yet" had been read as "no recording". |
| A contract compiled from that job, with every rule traceable | **WORKING** | Each rule names the step it came from; unconfirmed rules explore and do not gate. |
| Counterfactual cases, and checks synthesised from confirmed rules | **WORKING** | Produced from one demonstration against a system RigorRun did not author. How many of the ten categories appear depends on what the job touched: nine for the bundled refund workflow, fewer for a job of two steps. |
| A verdict that leads with the decision | **WORKING** | `SAFE TO SHIP? YES / CONDITIONAL / NO`, where CONDITIONAL is the common case against a real system, because verification is `PARTIAL` and it says so on the same line as the answer. |
| Per-failure evidence a person can act on | **WORKING** | The task, what the agent saw, what it did, what changed, which rule failed, what should have happened, and which tier verified it. The agent's own account is shown separately and never scored. |
| Break the agent, see which case regressed | **WORKING** | Driven in a browser end to end, and from the command line. |
| Gate a build on it | **WORKING**, and it used to be unfailable | `rigorrun gate --project …` with exit codes 0 passed, 1 the agent failed, 2 the setup is wrong. Until 0.2.0 the documented example gated on the reference implementation, which is handed the answer, so the documented way to gate a build was a guaranteed pass. `gate` now refuses `--agent reference` without `--allow-reference`, and `run` requires an agent rather than silently using the oracle. |

---

## Trusting the verdict

| Capability | Mark | How it was checked |
| --- | --- | --- |
| Say how strongly a run was verified | **WORKING** | `AUTHORITATIVE` / `PARTIAL` / `OBSERVATIONAL`, computed from what the connected system can actually read back, and shown beside the verdict rather than in a log. |
| Say whether cases were isolated | **WORKING**, and it used to overclaim | `RESET`, `PARTIAL`, `DECLARED` or `NONE`. It reported `RESET` — which means the cases were *observed* to start from the same state — whenever any reset was configured, and nothing had ever run the reset twice and compared. It now says `RESET` only where the reset is RigorRun's own machinery (an in-process snapshot, a container thrown away) and `DECLARED` where it is a tool the operator nominated. A system with no reset is still refused repeat mutating cases rather than quietly running them. |
| Refuse to write against production | **WORKING** | A project marked production cannot have its suite quality-checked (that runs it several times, and most of those runs write) and cannot mutate at all. |
| Annotations treated as claims, not permissions | **WORKING** | `readOnlyHint` and friends are shown with their source named and never enforced against. When a tool claimed read-only and state changed anyway, that is recorded as a mismatch. |
| Measure whether the suite would catch a worse agent | **WORKING** | Mutation testing with a `must_survive` control, reported as kill rate and independent kill rate, in the interface where somebody deciding whether to trust the suite is looking. |
| The evidence hierarchy | **PARTIAL** | `STATE`, `EVENT`, `OUTPUT`, `HUMAN`, `MODEL` exist and the tier is shown beside every check. Only `STATE` and `EVENT` are ever emitted: nothing produces a `model_judged` or `human_review` evaluator, so three of the five tiers are unreachable today. The same is true one layer down — of fourteen assertion kinds, generated suites only ever emit the four that read state; and of four container state surfaces, only `container_fs` is ever produced, which makes one branch of the conformance judge unreachable. |
| A verdict against a real system is AUTHORITATIVE | **PARTIAL, by design** | It is `PARTIAL`. RigorRun reads back what the nominated reads return and no more, and says so. Claiming otherwise would be the single most damaging thing this product could do. |

---

## Keeping the work

| Capability | Mark | How it was checked |
| --- | --- | --- |
| Work survives a restart | **WORKING** | The runner is killed with SIGKILL mid-flow and restarted; the project, the recording and the suite are all there. |
| A damaged file is reported, not silently dropped | **WORKING** | A project file corrupted on purpose comes back as a broken project naming the file, rather than the project vanishing from a product whose promise is that your work survives. |
| Writes cannot be half-applied | **WORKING** | Every write is to a temporary file, fsynced, renamed, and the directory fsynced. |
| Back up, restore, export and import a project | **WORKING** | `rigorrun backup`, `restore`, `export-project`, `import-project`. Secrets are excluded from an export unless asked for. |
| An imported project is inert until somebody agrees to it | **WORKING** | A connector that arrived in a file is a command to run or a URL to open with your credentials. It is refused until somebody has seen it in full and said yes — a refusal, not a warning, because opening it *is* the harmful act. |
| Credentials in the OS keychain | **WORKING** | macOS Keychain, libsecret, Windows DPAPI, with an owner-only file when none is present. The backend is chosen by a write-read-delete round trip rather than by platform name, and `rigorrun doctor` says which one you got. |
| No command prints a secret | **WORKING** | There is deliberately none. `rigorrun secrets set` refuses a value on the command line, because that is shell history. |
| Orphaned servers are cleaned up | **WORKING** | Measured, not assumed: four children survived `kill -9` of the runner. The next runner finds and ends them. |

---

## Ways in for an agent

| Capability | Mark | How it was checked |
| --- | --- | --- |
| An HTTP endpoint | **WORKING** | The agent answers one JSON request per case. |
| A command on this machine | **WORKING** | One line of JSON in, one out. Only a command a person typed at this machine can run — never one from a benchmark file, tool output, remote config or an imported trace. |
| A TypeScript SDK | **PARTIAL** | Ten lines, real, and not installable — see the broken row at the top. |
| A Python SDK | **WORKING** | Standard library only; an agent exception becomes a failed case, not a transport error. |
| An agent RigorRun does not launch, pulling cases and pushing results | **WORKING** | A driver holding that agent's key asks for work, does it through the MCP endpoint it is handed, and posts a result. Driven end to end against the booking agent, over HTTP, with the key proven not to authorise anything else. `docs/DRIVEN_AGENT.md`. |

---

## Living with it

| Capability | Mark | How it was checked |
| --- | --- | --- |
| Turn a production failure into a permanent case | **WORKING** | An OpenTelemetry trace becomes a case: only the *situation* comes from the trace, and what should have happened is computed from the confirmed rules. |
| Infer state from telemetry | **MISSING, deliberately** | Telemetry describes what an agent did and never what the system held. Reading authoritative state out of it would be a guess wearing a verdict's clothes. |
| Reconnect after the runner stops | **PARTIAL** | Discovery and an open connection do not survive the runner stopping; reconnecting reports anything that changed about the tools while you were away. |
| Set a project up from the command line | **MISSING** | Connecting and teaching are interface-only. Running, gating and comparing are not — which is the half CI needs. `rigorrun verify` needs no project at all. |
| Turn a browser recording into a contract | **BROKEN, and now said so** | `rigorrun record` printed `Next: rigorrun compile <file>`, and compile fails on it: `record` writes a workflow trace and `compile` reads a canonical trace, which names an environment and carries the state before and after the job. Checked by running it. The command now says what the file is instead of naming a command that errors. The bridge exists (`core/src/traceNormalize.ts`) and is called only from tests. |
| Rules from a real system are as strong as from a bundled one | **PARTIAL** | On a live system `SystemEnvironment.getActions()` returns `mutates: []`, so the `scopeContainment` template emits no rules and the primary-action resolver falls through to "last non-read-only action". And `seed: 'none'` drops every world-changing mutation, which lands in `benchmark.notTestable`. Real-system contracts are strictly weaker than the bundled ones, and nothing in the interface says so. |
| Confidence numbers mean something | **PARTIAL** | The figures beside each proposed rule are hardcoded priors in `compiler/src/induce.ts`, not calibrated against outcomes. They order rules sensibly and should not be read as probabilities. |
| More than one demonstration per contract | **MISSING** | Rules come from a single recording. |
| More than one person | **MISSING** | The runner is one person's process on one machine. |
| Cloud sync | **MISSING, and now deliberately so** | The control plane was deployed and called by nothing, so it was deleted rather than shipped. There is no cloud sync and no hosted component. Recoverable from git history. |
| Induction proposes only rules worth confirming | **PARTIAL** | It over-produces: roughly a quarter of proposed rules get discarded during review. Reviewing is the point, and this is still more work than it should be. |
| OAuth for the OpenAPI connector | **PARTIAL** | `client_credentials` works: the token endpoint is read out of the document, the token is exchanged once and replaced when the API refuses it. A flow that ends in a browser is not built there, because it is the flow an API under test almost never uses. |

---

## How to reproduce any of this

```bash
pnpm gate1            # pack, install into a HOME that does not exist, verify a real server
pnpm verify:package   # build, pack, install clean, run, fresh-user journey, audit, SBOM
pnpm e2e:external     # a stranger, in a browser, own system, own agent, regression, CI gate
pnpm e2e:restart      # SIGKILL the runner mid-flow; resume; corrupt a file on purpose
pnpm test             # unit and integration, including two public MCP servers from npm
pnpm domain           # no business noun in generic code

node scripts/build-evidence.mjs      # regenerate the public evidence from four real servers
node scripts/build-proof.mjs --check # the example's counts still match the pipeline
```

`gate1` and `build-evidence.mjs` need Docker. The rest do not.

The screenshots in `docs/external-user-run/` are what the person in
`pnpm e2e:external` actually saw, regenerated at the commit they document.
