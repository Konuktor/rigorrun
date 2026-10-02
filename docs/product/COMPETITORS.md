> Competitor facts below were gathered for the v0.2 positioning. Current positioning and the
> state-based testers and runtime-authorisation vendors added since: [`docs/context/POSITIONING.md`](../context/POSITIONING.md).

# Competitors

**Accessed:** 2026-10-01 (every URL below was fetched or seen in search results on this date).

**Method.** Every factual claim about another company links to the page it came from. Where a
page did not say something, the cell reads **unverified** or **not stated**, and nothing was
filled in from memory. Pages were read through a fetch tool that returns a model-written summary of
the page, so check any quoted sentence against the live page before it appears on the website.
Marketing numbers that vendors publish about themselves (for example "80% reduction in critical
failures") are reported as the vendor's claims, not as facts. YC batch is given only when a
`ycombinator.com` page, or a Launch HN or Product Hunt title, states it.

RigorRun's own row is sourced from this repository, not from the web.

---

## 1. Summary

| Company                             | What it does                                                                             | Judges success by                                                                                                                | Environment                                                                    | OSS / local                                                               | Source                                                                                                                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arga Labs** (YC Spring 2026)      | Sandboxes with stateful "twins" of third-party services, for testing and training agents | User-defined judging criteria (mechanism not stated); its own benchmark is "graded from trusted before-and-after state"          | Vendor-hosted simulated replicas (40+ services)                                | Hosted; requires `arga login`; on-prem only on Enterprise; OSS unverified | [yc](https://www.ycombinator.com/companies/arga-labs), [site](https://www.argalabs.com/), [bench](https://github.com/ArgaLabs/arga-twins-benchmark)                                                                             |
| **Archal** (YC Summer 2026)         | Stateful API sandboxes for agent and integration tests                                   | State snapshots and before/after diffs that the user's test asserts on                                                           | Vendor-built simulations ("not the provider's live service")                   | Hosted, billed per minute; CLI via `npx`; OSS unverified                  | [yc](https://www.ycombinator.com/companies/archal), [site](https://archal.ai/), [docs](https://docs.archal.ai/sandboxes/inspect-reset)                                                                                          |
| **Hue** (YC Fall 2026)              | Turns production agent runs into repeatable tests                                        | Scores each rerun; hosted model-graded scoring plus local scorers                                                                | Hosted simulated APIs/MCPs in stateful per-run "worlds"                        | SDK is MIT; simulation and model-graded scoring are hosted                | [yc](https://www.ycombinator.com/companies/hue), [site](https://hue.run/), [sdk](https://github.com/hue-run/hue-sdk)                                                                                                            |
| **Chronicle Labs** (YC Spring 2026) | Staging environments built by replaying production events                                | **unverified** (not stated on any page fetched)                                                                                  | Seeded sandboxes built from production history                                 | **unverified**                                                            | [yc](https://www.ycombinator.com/companies/chronicle-labs), [launch](https://www.ycombinator.com/launches/QFn-chronicle-labs-staging-environments-for-ai-agents), [site](https://chronicle-labs.com/)                           |
| **Salus** (YC Winter 2026)          | Runtime guardrails: checks agent actions before they execute                             | Pre-execution check against policy and session evidence                                                                          | Production, at runtime (not a test environment)                                | SDK via `pip`; self-host not stated                                       | [yc](https://www.ycombinator.com/companies/salus), [site](https://usesalus.ai/), [pricing](https://www.usesalus.ai/pricing)                                                                                                     |
| **Lemma** (YC Fall 2025)            | Production monitoring for AI agents                                                      | Automated audit of each trace against the agent's instructions; online evals                                                     | Production traffic                                                             | **unverified**                                                            | [yc](https://www.ycombinator.com/companies/uselemma), [site](https://www.uselemma.ai/)                                                                                                                                          |
| **Braintrust**                      | Evals and observability platform                                                         | Scorers: prebuilt autoevals, LLM-as-a-judge, custom code; online scoring of production traces                                    | Your app; offline datasets and production traces                               | `autoevals` is MIT; on-prem on Enterprise                                 | [scorers](https://www.braintrust.dev/docs/core/functions/scorers), [pricing](https://www.braintrust.dev/pricing), [autoevals](https://github.com/braintrustdata/autoevals)                                                      |
| **LangSmith** (LangChain)           | Tracing and evaluation platform                                                          | Human, code, LLM-as-judge, decision-model and pairwise evaluators; trajectories can be evaluated                                 | Offline datasets and online production traffic                                 | `openevals` is MIT; self-hosted and hybrid on Enterprise                  | [concepts](https://docs.langchain.com/langsmith/evaluation-concepts), [pricing](https://www.langchain.com/pricing), [openevals](https://github.com/langchain-ai/openevals)                                                      |
| **Patronus AI**                     | Evaluation models, trace-analysis copilot, simulated environments                        | LLM-as-a-judge and its own evaluator models (Glider, Lynx); Percival analyzes traces                                             | Traces; also "generative simulators"                                           | Lynx and Glider weights public; on-prem or VPC on Enterprise              | [products](https://www.patronus.ai/products), [pricing](https://www.patronus.ai/pricing), [lynx](https://www.patronus.ai/announcements/patronus-ai-launches-lynx-state-of-the-art-open-source-hallucination-detection-model)    |
| **Coval** (YC Summer 2024)          | Simulation and evaluation for voice and chat agents                                      | Five metric families incl. LLM judge and deterministic; an **API State** metric calls a configured endpoint after the simulation | Simulated conversations plus live production calls                             | Hosted; self-host not mentioned                                           | [yc](https://www.ycombinator.com/companies/coval), [metrics](https://docs.coval.ai/concepts/metrics/overview), [api-state](https://docs.coval.ai/concepts/metrics/types/deterministic), [pricing](https://www.coval.ai/pricing) |
| **HUD** (YC Winter 2025)            | Platform for building RL environments and evals                                          | Verifiers that inspect final environment state; LLM grading recommended only where programmatic checks fail                      | Docker environments (shell, MCP, browser, VNC)                                 | SDK is MIT; local `hud eval`; cloud billed per environment-hour           | [yc](https://www.ycombinator.com/companies/hud), [site](https://www.hud.ai/), [sdk](https://github.com/hud-evals/hud-python), [verifiers](https://www.hud.ai/resources/verifier-reward-design-rl-environments)                  |
| **Cekura** (YC F24)                 | Testing and monitoring for voice and chat agents                                         | LLM-based judges over the whole session                                                                                          | Synthetic users plus a mock tool platform; production monitoring               | VPC/on-prem on Enterprise                                                 | [launch hn](https://news.ycombinator.com/item?id=47232903), [pricing](https://www.cekura.ai/pricing)                                                                                                                            |
| **Halluminate** (YC Summer 2025)    | Data and RL environments for computer-use agents                                         | Error analysis by expert human annotators; proprietary benchmarks                                                                | Managed sandboxes modeled on Salesforce, Slack, ticketing tools                | **unverified**                                                            | [yc](https://www.ycombinator.com/companies/halluminate)                                                                                                                                                                         |
| **RigorRun**                        | Acceptance testing from one human demonstration                                          | State of the system the agent changed; a model is "a second opinion, never the arbiter"                                          | The user's own system: staging, a Stripe test account, an MCP server's backend | MIT; `npx rigorrun`; runs locally; no account                             | `README.md`, `docs/archive/v0.2/PRODUCT.md`, `docs/GETTING_STARTED.md`, `apps/docs/src/content/docs/agents/black-box.md`                                                                                                        |

---

## 2. Per company

### Arga Labs (YC Spring 2026)

- **What it does.** "Real-world sandboxes to test and train AI agents". Founded 2025
  ([yc](https://www.ycombinator.com/companies/arga-labs)). "Deploy simulation environments with
  stateful twins of the APIs, CLIs, and MCPs your agents use"
  ([site](https://www.argalabs.com/)). It also offers per-PR staging: "Only the services you change
  are redeployed; all other services are routed to prod"
  ([yc](https://www.ycombinator.com/companies/arga-labs)).
- **How it judges.** The site says users "Define judging criteria and grade performance for every
  commit or PR". Whether the grader is an LLM, rules or both is not stated
  ([site](https://www.argalabs.com/)). Arga's public benchmark runs tasks "against Arga-hosted
  service twins" and grades them "from trusted before-and-after state"
  ([ArgaBench](https://github.com/ArgaLabs/arga-twins-benchmark)). The CLI runs browser validation
  with user assertions on text, URL and visibility
  ([arga-cli README](https://github.com/ArgaLabs/arga-cli/blob/main/README.md)).
- **Environment.** Twins for 40+ services, including Stripe, Slack, GitHub, Gmail, Notion,
  Salesforce, HubSpot and Jira ([site](https://www.argalabs.com/)). The twins are hosted by Arga
  ([ArgaBench](https://github.com/ArgaLabs/arga-twins-benchmark)).
- **OSS / local.** The CLI requires `arga login`, which stores "a device-scoped API key locally"
  ([arga-cli README](https://github.com/ArgaLabs/arga-cli/blob/main/README.md)). Whether the product
  is open source: **unverified** (no licence was visible on the repos fetched).
- **Pricing.** Free $0/month; Pro $1,250/month; Team from $3,500/month; Enterprise custom, with
  "On-prem hosting if requested" ([pricing](https://www.argalabs.com/pricing)).

### Archal (YC Summer 2026)

- **What it does.** "API sandboxes, built for AI agents". Founded 2026
  ([yc](https://www.ycombinator.com/companies/archal)). "Test API integrations without test
  accounts, rate limits, or dirty state" ([site](https://archal.ai/)).
- **How it judges.** Archal exposes `archal state get` and `archal state diff`. The diff returns
  "before and after hashes, changed paths, and truncation metadata" and "compares with the file you
  supplied" ([docs](https://docs.archal.ai/sandboxes/inspect-reset)). The docs describe state
  inspection as letting "a test verify what an agent actually changed". _Interpretation:_ Archal
  supplies the state data and the user's own test decides pass or fail. No built-in grader was
  found in the docs index ([llms.txt](https://docs.archal.ai/llms.txt)).
- **Environment.** "Each environment is an independently built simulation of the service it
  represents, not the provider's live service" ([site](https://archal.ai/)). The docs index lists
  22 environments, including GitHub, Slack, Stripe, Jira, Linear, Supabase, HubSpot and Datadog
  ([llms.txt](https://docs.archal.ai/llms.txt)). Starting state is explicit JSON (SQL for
  Supabase), and Archal "does not rely on LLMs to generate hidden state"
  ([concepts](https://docs.archal.ai/concepts)).
- **OSS / local.** Setup uses `npx --yes archal@0.11.3 connect` ([site](https://archal.ai/)).
  Open source or self-host: **unverified**.
- **Pricing.** "Each environment costs $0.10 per minute", prorated by the second, plus $5 credit
  at signup and $15 when the first sandbox is ready ([site](https://archal.ai/)).

### Hue (YC Fall 2026)

- **What it does.** "Test agents in realistic worlds built from production usage". Founded 2026
  ([yc](https://www.ycombinator.com/companies/hue)). "Turn your users' requests into repeatable
  tests" ([site](https://hue.run/)).
- **How it judges.** "Score each rerun and compare performance across agent versions"
  ([site](https://hue.run/)). "Hosted model-graded scoring, trace storage and rendering, and
  scheduled evaluation runs are features of the Hue platform, not of these SDKs"
  ([sdk README](https://raw.githubusercontent.com/hue-run/hue-sdk/main/README.md)). The SDK can
  also run local scorers against frozen datasets ([sdk](https://github.com/hue-run/hue-sdk)). Code
  evaluators can run on long-running workers
  ([PR #85, search result](https://github.com/hue-run/hue-sdk/pull/85)). `hue eval` prints a
  PASS/FAIL table, and its example scenario is "Refund an eligible charge"
  ([PR #66](https://github.com/hue-run/hue-sdk/pull/66)).
- **Environment.** "Simulated APIs and MCPs that match the real ones, down to the edge cases".
  "Stateful environments: Each run gets its own world that keeps every change"
  ([site](https://hue.run/)). Local agents run "against a fresh hosted simulated world"
  ([sdk README](https://raw.githubusercontent.com/hue-run/hue-sdk/main/README.md)).
- **OSS / local.** The SDK is MIT. Tracing works without an account. Hosted evaluations need a
  project, and accounts are set up by the Hue team
  ([sdk README](https://raw.githubusercontent.com/hue-run/hue-sdk/main/README.md)). `hue eval`
  needs a Hue deployment ([PR #66](https://github.com/hue-run/hue-sdk/pull/66)).
- **Pricing.** Not public (`hue.run/pricing` returned 404).

### Chronicle Labs (YC Spring 2026)

- **What it does.** "Staging Environments for Enterprise AI Agents". Founded 2026
  ([yc](https://www.ycombinator.com/companies/chronicle-labs)). "Chronicle takes your existing
  operational history and turns it into seeded sandboxes with scenarios based on how your business
  really works" ([launch](https://www.ycombinator.com/launches/QFn-chronicle-labs-staging-environments-for-ai-agents)).
- **How it judges.** **unverified.** The site says only that it "replays them to determine whether
  your AI agents are ready for launch" ([site](https://chronicle-labs.com/)).
- **Environment.** Replay of captured production events into seeded sandboxes
  ([yc](https://www.ycombinator.com/companies/chronicle-labs)).
- **OSS / local / pricing.** **unverified**; none of the three pages fetched mentions them.
- **Vendor claims (not verified):** "30x production-derived scenario coverage", "12x more failure
  modes caught pre-launch", "80% reduction in critical failures" ([site](https://chronicle-labs.com/)).
- _Name note:_ `github.com/theagentplane/chronicle`, a record-and-replay project that appeared in
  search, is a separate project and is not covered here.

### Salus (YC Winter 2026)

- **What it does.** "Guardrails to validate your agent's actions before they execute". Founded 2026
  ([yc](https://www.ycombinator.com/companies/salus)). "Stop the wrong action before it reaches the
  provider" ([site](https://usesalus.ai/)).
- **How it judges.** Before execution, it grounds actions in evidence from prior tool outputs and
  conversation history and checks them against policies written "in YAML, markdown, or plain
  English". It also runs PII, budget/loop, idempotency and human-escalation checks
  ([yc](https://www.ycombinator.com/companies/salus)). Decision receipts record "policy, evidence,
  timing, verdict, and execution result" ([site](https://usesalus.ai/)). Whether an LLM makes the
  decision: **unverified**.
- **Environment.** Production, at runtime. Plans include "Shadow and enforcement modes"
  ([pricing](https://www.usesalus.ai/pricing)).
- **OSS / local.** Integration is "a pip install and a few lines of code"
  ([yc](https://www.ycombinator.com/companies/salus)). Self-host: not stated.
- **Pricing.** Pilot $500/month (10 agents, 200K action checks); Partner $2,500/month (50 agents,
  1.5M checks); Enterprise custom ([pricing](https://www.usesalus.ai/pricing)).
- _Name note:_ `salusapp.ai` (a privacy tokenization layer) and `salus.cloud` are different
  companies.

### Lemma (YC Fall 2025)

- **What it does.** "Production Monitoring for AI agents". Founded 2025
  ([yc](https://www.ycombinator.com/companies/uselemma)). Its domain is `uselemma.ai`.
- **How it judges.** "Lemma audits every trace against your agent's instructions and groups
  recurring failures into issues". After a fix ships, "Lemma creates an online eval"
  ([site](https://www.uselemma.ai/)). Whether the audit uses an LLM: **unverified** (not stated).
- **Environment.** "detects failed outcomes directly from live traffic"
  ([yc](https://www.ycombinator.com/companies/uselemma)).
- **OSS / local / pricing.** The site references a skill at `github.com/uselemma/skills`. Whether
  the platform is open source: **unverified**. Pricing is not public (`/pricing` returned 404).
- The note that Lemma's focus was "unknown" is resolved: it is production monitoring, not
  pre-deployment testing.

### Braintrust

- **What it does.** "The active observability platform for instrumenting, understanding, and
  improving agents" ([docs](https://www.braintrust.dev/docs)).
- **How it judges.** Three scorer types: autoevals, "LLM-as-a-judge", and "Custom code". Scorers
  run on experiments or "continuously with online scoring on production traces"
  ([scorers](https://www.braintrust.dev/docs/core/functions/scorers)).
- **Environment.** The user's application, on datasets and on production traces (same source).
- **OSS / local.** `autoevals` is MIT ([github](https://github.com/braintrustdata/autoevals)).
  "on-prem or hosted deployment" is listed under Enterprise
  ([pricing](https://www.braintrust.dev/pricing)).
- **Pricing.** Starter $0; Pro $249/month; Enterprise custom
  ([pricing](https://www.braintrust.dev/pricing)).
- **YC:** not stated in the sources fetched.

### LangSmith (LangChain)

- **How it judges.** Evaluator types: "Human, Code, LLM-as-judge, Decision model, Pairwise".
  Offline evaluation runs on curated datasets and online evaluation on live traffic. Agent
  evaluation can cover "correct tool selection and proper argument formatting or trajectory"
  ([concepts](https://docs.langchain.com/langsmith/evaluation-concepts)).
- **OSS / local.** `openevals`, "Readymade evaluators for your LLM apps", is MIT
  ([github](https://github.com/langchain-ai/openevals)). "Self-hosted and hybrid deployment
  options" are listed under Enterprise ([pricing](https://www.langchain.com/pricing)).
- **Pricing.** Developer $0/seat (up to 5k base traces/month); Plus $39/seat (up to 10k base
  traces/month); Enterprise custom ([pricing](https://www.langchain.com/pricing)).
- **YC:** not stated in the sources fetched.

### Patronus AI

- **What it does / how it judges.** LLM-as-a-judge, plus "Glider", a small evaluator model, and
  "Lynx", a hallucination-detection model. Percival is an "eval copilot that analyzes traces" and
  detects "20+ failure modes in agentic traces". Patronus also offers "World Models for Digital
  Workflows", including "Generative Simulators" ([products](https://www.patronus.ai/products)).
- **OSS / local.** Lynx was released as open source
  ([announcement](https://www.patronus.ai/announcements/patronus-ai-launches-lynx-state-of-the-art-open-source-hallucination-detection-model)).
  Glider is on Hugging Face ([hf](https://huggingface.co/PatronusAI/glider-gguf)). Enterprise
  offers "On-prem / dedicated VPC" ([pricing](https://www.patronus.ai/pricing)).
- **Pricing.** Developer: $10 of free credits, then $10 per 1k small evaluator calls, $20 per 1k
  large evaluator calls and $10 per 1k explanations; Enterprise custom
  ([pricing](https://www.patronus.ai/pricing)).
- **YC:** not stated in the sources fetched.

### Coval (YC Summer 2024)

- **What it does.** "Simulation & Evaluation that scales voice and chat AI agents". Founded 2024
  ([yc](https://www.ycombinator.com/companies/coval)). `coval.dev` redirects to `coval.ai`.
- **How it judges.** Five metric families: Deterministic, Statistical, ML Model, LLM Judge, and
  Trace ([metrics](https://docs.coval.ai/concepts/metrics/overview)). The deterministic
  **API State** metric calls "the configured endpoint" after the simulation and checks the response
  at a configured path. "MATCH means ... your system reached the intended state"
  ([deterministic](https://docs.coval.ai/concepts/metrics/types/deterministic)). Every plan
  includes human review ([pricing](https://www.coval.ai/pricing)).
- **Environment.** Simulated conversations and live-monitored production calls
  ([metrics](https://docs.coval.ai/concepts/metrics/overview)).
- **OSS / local.** Self-host is not mentioned on the pricing page
  ([pricing](https://www.coval.ai/pricing)).
- **Pricing.** Starter $100/month; Growth $500/month; Enterprise "Starting at $4,500/month"
  ([pricing](https://www.coval.ai/pricing)).

### HUD (YC Winter 2025)

- **What it does.** "Platform for building RL environments and evals"
  ([yc](https://www.ycombinator.com/companies/hud)). `hud.so` redirects to `hud.ai`.
- **How it judges.** "A verifier answers the binary question: did the agent complete the task?",
  for example by inspecting "final cell values, formulas, and sheet structure against an expected
  state". HUD advises: "Reserve model-based or LLM-based grading for dimensions that genuinely
  resist programmatic checking"
  ([verifiers](https://www.hud.ai/resources/verifier-reward-design-rl-environments)).
- **Environment.** Docker environments with SSH, MCP, browser (CDP) and VNC capabilities
  ([sdk](https://github.com/hud-evals/hud-python)). The site lists "100+ parallel environment
  instances" ([site](https://www.hud.ai/)).
- **OSS / local.** `hud-python` is MIT, and `hud eval` runs locally. "With `HUD_API_KEY` set,
  every rollout is recorded on hud.ai" ([sdk](https://github.com/hud-evals/hud-python)). Whether it
  works fully offline: **unverified**.
- **Pricing.** SDK + platform access free; Cloud $0.10 per environment-hour; Enterprise custom
  ([site](https://www.hud.ai/)).

### Cekura (YC F24), extra

- **What it does.** Testing and monitoring for voice and chat agents. It can "automatically extract
  test cases" from production conversations ([launch hn](https://news.ycombinator.com/item?id=47232903)).
- **How it judges.** "LLM-based judges evaluate whether it responded correctly - across the full
  conversational arc", using "structured conditional action trees"
  ([launch hn](https://news.ycombinator.com/item?id=47232903)).
- **Environment.** Synthetic users and mock tools. Its stated reason for mocking: "Running
  simulations against real APIs is slow and flaky"
  ([launch hn](https://news.ycombinator.com/item?id=47232903)).
- **Pricing.** Pay-as-you-go $0.25 per voice testing minute and $0.05 per monitored call; Startup
  $500/month; Enterprise custom with "VPC/on-prem hosting available"
  ([pricing](https://www.cekura.ai/pricing)).

### Halluminate (YC Summer 2025), extra

- **What it does.** "Data and RL environments to automate knowledge work". Founded 2024. It offers
  "fully managed, parallelizable environments modeled after popular systems (e.g., Salesforce,
  Slack, Ticketing Software, websites)" ([yc](https://www.ycombinator.com/companies/halluminate)).
- **How it judges.** "error analysis powered by expert annotators" and proprietary benchmarks
  (same source).
- **OSS / local / pricing.** **unverified**.

### Checked and excluded (appear to have pivoted)

- **Janus**, listed as "Janus (YC X25)" on
  [Product Hunt](https://www.producthunt.com/products/janus-3?launch=janus-yc-x25), did simulation
  testing with synthetic users and judge models. `withjanus.com` now redirects to `withkairos.co`,
  and `ycombinator.com/companies/janus` shows "Kairos", "Specialized AI for Critical Industries"
  ([yc](https://www.ycombinator.com/companies/janus)). Whether it is still an agent-testing product:
  **unverified**.
- **AgentHub** was evaluating agents in simulated sandboxes with "LLM, human-in-the-loop, and
  rule-based grading"
  ([launch](https://www.ycombinator.com/launches/O6a-agenthub-the-staging-environment-for-your-ai-agents)).
  Its YC jobs URLs use the slug `agenthub-2`, and that company page now shows "Panoptive", a
  clinical-trials product ([yc](https://www.ycombinator.com/companies/agenthub-2)). Likely pivoted:
  **unverified**.
- Not YC per the sources fetched, so out of scope: **Veris AI**
  ([docs](https://docs.veris.ai/)), simulation sandboxes with mocked enterprise tools, and
  **Mirrors** ([Show HN](https://news.ycombinator.com/item?id=48768200)), which replays production
  traces.

---

## 3. Where RigorRun's approach differs

Each bullet compares approaches. None of them ranks RigorRun above anyone.

1. **Whose system is read.** Arga ([site](https://www.argalabs.com/)), Archal
   ([site](https://archal.ai/)), Hue ([site](https://hue.run/)) and Halluminate
   ([yc](https://www.ycombinator.com/companies/halluminate)) run agents against vendor-built
   replicas or simulations. Cekura uses mock tools
   ([launch hn](https://news.ycombinator.com/item?id=47232903)). RigorRun runs the agent against
   the user's own system (staging, a Stripe test account, an MCP server's backend) and reads that
   system afterwards (`apps/docs/.../agents/black-box.md`, `docs/GETTING_STARTED.md`). **Overlap:**
   Coval's API State metric also queries a user-configured endpoint after a run
   ([deterministic](https://docs.coval.ai/concepts/metrics/types/deterministic)).
2. **What decides the verdict.** Braintrust, LangSmith and Patronus all list LLM-as-a-judge as a
   core scorer type ([scorers](https://www.braintrust.dev/docs/core/functions/scorers),
   [concepts](https://docs.langchain.com/langsmith/evaluation-concepts),
   [products](https://www.patronus.ai/products)). Cekura's verdicts come from LLM-based judges
   ([launch hn](https://news.ycombinator.com/item?id=47232903)). RigorRun decides from system
   state; a model is "a second opinion, never the arbiter" (`docs/archive/v0.2/PRODUCT.md`). **Overlap:**
   Archal (state diffs), Arga's benchmark (before-and-after state), HUD (state verifiers) and Coval
   (API State) also judge from state. In Archal, Arga and HUD that is the state of a simulated or
   containerized environment, not the user's live test-mode system.
3. **Where the tests come from.** Hue and Chronicle build tests from production runs
   ([hue yc](https://www.ycombinator.com/companies/hue),
   [chronicle launch](https://www.ycombinator.com/launches/QFn-chronicle-labs-staging-environments-for-ai-agents)).
   Cekura extracts them from production conversations or from a description of the agent
   ([launch hn](https://news.ycombinator.com/item?id=47232903)). RigorRun derives a suite from one
   human demonstration of the job (`docs/archive/v0.2/POSITIONING.md`). That works before any production traffic
   exists, but it depends on a person doing the job once.
4. **Where it runs.** Arga needs `arga login`
   ([cli](https://github.com/ArgaLabs/arga-cli/blob/main/README.md)). Hue's simulation and
   model-graded scoring are hosted
   ([sdk README](https://raw.githubusercontent.com/hue-run/hue-sdk/main/README.md)). Archal bills
   per environment-minute ([site](https://archal.ai/)). Self-hosting at Braintrust, LangSmith,
   Patronus, Arga and Cekura appears on Enterprise tiers only (pricing pages linked above).
   RigorRun is MIT, starts with `npx rigorrun` and runs as a local process with no account
   (`README.md`, `docs/GETTING_STARTED.md`). **Overlap:** HUD's SDK (MIT) runs `hud eval` locally
   ([sdk](https://github.com/hud-evals/hud-python)), and Hue's SDK (MIT) traces without an account.
5. **When it acts.** Salus blocks actions at runtime in production
   ([yc](https://www.ycombinator.com/companies/salus)). Lemma monitors live traffic
   ([site](https://www.uselemma.ai/)). RigorRun gates changes before production and does not watch
   production (`docs/archive/v0.2/POSITIONING.md`). These tools complement RigorRun rather than replace it.

### What competitors have that RigorRun does not

- **Replica breadth and no test accounts.** Arga lists 40+ service twins and Archal about two dozen
  environments, so an agent can be tested without credentials for, or rate limits from, the real
  provider ([argalabs.com](https://www.argalabs.com/), [archal.ai](https://archal.ai/)). RigorRun
  needs a reachable system that is safe to change (`docs/OPENAPI_ENVIRONMENT.md`).
- **Production monitoring and online evals**: Lemma, Braintrust, LangSmith, Coval and Cekura.
- **Runtime enforcement**: Salus, which blocks and corrects actions before they execute.
- **Tests mined from production traffic**: Hue, Chronicle and Cekura.
- **Hosted team dashboards, retention, RBAC/SSO and compliance**: for example, Coval lists SOC 2
  Type II, HIPAA and GDPR on every tier ([pricing](https://www.coval.ai/pricing)), and
  Braintrust/LangSmith list RBAC.
- **Voice agents**: Coval and Cekura, including audio and latency metrics.
- **Scale and parallelism**: HUD lists "100+ parallel environment instances"
  ([hud.ai](https://www.hud.ai/)).
- **RL training data and environments**: HUD and Halluminate.
- **Human expert review as a service**: Halluminate.
- **Maturity.** `docs/archive/v0.2/PRODUCT.md` calls RigorRun "An early MVP" whose shipped environment is
  synthetic. Several competitors publish named enterprise customers and paid tiers.

---

## 4. Safe claims for the website

Each claim is supported by the sources above. None of them says "only", "first" or "better".

1. "RigorRun runs on your machine — `npx rigorrun`, MIT-licensed, no account." (`README.md`,
   `docs/archive/v0.2/PRODUCT.md`)
2. "RigorRun tests your agent against your own system — staging, a test-mode account, your MCP
   server — not a replica of it." (`black-box.md`; replicas are described at argalabs.com and
   archal.ai)
3. "The verdict comes from the state of the system your agent changed, not from a model grading
   the transcript." (`docs/archive/v0.2/PRODUCT.md`, `docs/archive/v0.2/POSITIONING.md`)
4. "Show RigorRun the job once; it builds the acceptance suite from that demonstration."
   (`docs/archive/v0.2/POSITIONING.md`)
5. "RigorRun gates a change before production. Pair it with a monitor or a runtime guard if you
   need those." (`docs/archive/v0.2/POSITIONING.md`; see the Salus and Lemma rows)

## 5. Do not claim

- That RigorRun is the **only or first** tool to check state rather than transcripts. Archal,
  Arga's benchmark, HUD and Coval's API State metric all judge from state.
- That competitors **only** use LLM judges. Braintrust (custom code), LangSmith (code, human),
  Coval (deterministic), HUD (verifiers) and Arga (assertions) all offer non-LLM checks.
- That RigorRun is the **only open-source or local** option. The Hue SDK, HUD SDK, Braintrust
  `autoevals` and LangChain `openevals` are MIT. HUD runs `hud eval` locally. Several vendors
  offer on-prem on Enterprise.
- That replicas are "fake" or "inaccurate". Nothing fetched measures replica fidelity.
- Any comparative accuracy, safety or speed number. RigorRun has no head-to-head measurement
  against any vendor here.
- ~~That Stripe test mode is a shipped, tested integration.~~ **Resolved at 0.4.0:** the Stripe
  pack ships and was qualified on Stripe test mode (168 cells, no false pass or false fail,
  `reports/stripe-pack-2026-10`). It may be claimed as "qualified on Stripe test mode", with the
  verification strength PARTIAL; not as "verified" without that qualifier.
- Any vendor marketing number (Chronicle's "80%", Salus's τ²-bench figures, Lemma's "world's first")
  restated as fact.
- That Janus or AgentHub are current competitors. Both appear to have pivoted (unverified).
