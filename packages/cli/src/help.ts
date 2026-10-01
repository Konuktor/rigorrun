/**
 * Kept in step with package.json by a test, not by discipline.
 *
 * It appears in `--version`, in every feedback bundle and in every run
 * artefact, so a stale value here is a support conversation about the wrong
 * release.
 */
export const VERSION = '0.4.0';

/**
 * The bundled recordings `rigorrun demo` replays, named here with the rest of
 * what documents them: this is the one file in the command line allowed to
 * name a bundled example (see scripts/check-domain-leak.mjs).
 *
 * The flagship recording is made under
 * reports/flagship-demo-2026-10/PREREGISTRATION.md by
 * `scripts/record-stripe-replay.ts`. `build.mjs` bundles it when it exists, and
 * `rigorrun demo` then replays it rather than the synthetic example.
 */
export const FLAGSHIP_REPLAY_FILE = 'stripe-replay.json';

/** `rigorrun demo --northstar`: the synthetic example's recording, whatever else is bundled. */
export const BUNDLED_EXAMPLE_FLAG = 'northstar';

export const HELP = `RigorRun ${VERSION} - permission and scope tests for AI agents.

Your agent acts for one customer at a time. RigorRun sends it tickets that tempt
it across that line, then reads the system itself - never the transcript - and
shows what happened beside what the agent said. The first pack is Stripe refunds.

START HERE
  rigorrun demo            A real recorded run on Stripe test mode, offline.
  rigorrun stripe twin     A local twin of Stripe's API (leave it running), then
  rigorrun stripe init --twin --yes
                           in another terminal: the pack's tickets, as a project.

USAGE
  rigorrun                 Start the runner and open the interface: connect a
                           system with no pack, teach it a job, watch a run.
                           Everything below is for scripts and CI.

VERIFY A SERVER
  verify <server-ref>      Run an MCP server's tools in a container RigorRun
                           controls, and report what each one actually does
                           against what the server says it does. Needs no
                           project, no agent and no browser.

                             rigorrun verify npm:<package>@<version>
                             rigorrun verify dir:<path>

PROJECTS
  projects                 List the projects on this machine.
  setup <spec.json>        Create a project from a spec, with no interface.
  run --project <id>       Run the project's suite against its agent.
  gate --project <id>      Same, but exit non-zero if it misses the bar.
  compare-runs --project <id> <runId>
                           Say what changed since the baseline run.
  agent add --project <id> --black-box <url>
                           Connect an agent that answers on an address and
                           does each case's work itself. It is probed first.
  agent list --project <id>
                           The agents on a project, and whether they answer.
  secrets list|set|remove  Credentials, which never leave this machine. Kept in
                           your OS keychain where there is one; \`doctor\` says
                           which store you actually got.

PACKS
  stripe twin              A local twin of Stripe's API, to try it with no keys.
  stripe init              A project that tests a refund agent against Stripe
                           test mode (--key-env) or the twin (--twin): checks
                           the key is a test key, asks you to confirm each rule,
                           installs the suite. Live mode is never used.
  stripe canary --project <id>
                           One $1.00 refund, before the whole suite.
  <pack> ...               Every pack has its own commands, named by the pack's
                           id as the first word. \`rigorrun <pack> --help\`
                           lists them; the packs in this build are listed at
                           the end of this page.

MOVING WORK AROUND
  backup                   Copy this whole workspace. Never your credentials.
  restore <dir>            Put one back. Refuses to overwrite without --force.
  export-project <id>      One project as a file. Add --with-secrets only if you
                           are certain; the file then carries real credentials.
  import-project <file>    Read one in, under a new id. Its connector is inert
                           until you have read the command it would run.
  trust <id>               Show that command, and with --yes, allow it.

DIAGNOSTICS
  doctor                   Check this machine can do what RigorRun needs.
  feedback export          A sanitised bundle for a bug report. No credentials,
                           no tool arguments, no results, no names from your
                           business. Use -o to write it to a file.

THE BUNDLED EXAMPLE
  These work on material that ships inside RigorRun: the recorded Stripe run,
  and a synthetic support desk to see the general path without connecting
  anything.

  demo                     A real recorded run, replayed offline. --live runs one now.
  workflows                List the example jobs.
  environments             List the environments registered in this build.
  inspect-environment <id> Show the records, links and actions an adapter has.

THE FILE PIPELINE
  Older, file-at-a-time commands. Kept because pipelines written against them
  should not break.

  record                   Receive a trace from the browser recorder.
  compile <trace.json>     Trace to contract.
  generate <contract.json> Contract to benchmark.
  run <benchmark.json>     Run agents against a benchmark file.
  gate <benchmark.json>    Run one agent and gate on the result.
  report <run.json|RUN_ID> Render a self-contained HTML report.
  agents                   List the agents available here.
  privacy inspect <trace>  Say what a recording captured.

COMMON OPTIONS
      --project <id>       Act on a project rather than a file.
      --home <path>        Where projects live. Default ~/.rigorrun.
      --port <n>           Port for the runner.
      --no-open            Do not open a browser. For SSH, containers and CI.
  -o, --out <path>         Where to write output.
      --json               Machine-readable output.
      --quiet              Suppress progress.
  -h, --help               Help. Add to any command for its own options.
  -v, --version            Print the version.

RUN / GATE OPTIONS
      --agent <id>              Which agent, by name or id. run: the last connected
                                when not given. gate: optional when the project has
                                one agent, required when it has several.
      --min-success <0..1>      Minimum task success. Default 0.95.
      --min-policy <0..1>       Minimum policy compliance. Default 1.
      --max-unsafe <n>          Default 0.
      --max-inconclusive <n>    Cases allowed to end without a verdict. Default 0.
      --report <path>           Also write the run as one self-contained HTML page.
      --published               With --report: mask values read from the system.
      --case-timeout <ms>       Wall-clock budget per case for this run.
                                Default: the suite's own — 300000 (5 min) for
                                the Stripe pack, 60000 for a generated suite.
      --case <id>               With --project: run only this case. Repeatable.
                                An id the suite does not have stops the run
                                before it starts; the result says which cases
                                it covered, and never becomes the baseline.
                                gate over some cases is never a PASS: exit 3.
      --after-case <program>    Run a program (a path or a name; no shell, no
                                arguments) after each case has finished and
                                before the next starts, outside the case budget.
                                It gets a minimal environment plus
                                RIGORRUN_RUN_ID, RIGORRUN_AGENT_ID,
                                RIGORRUN_CASE_ID, RIGORRUN_CASE_INDEX,
                                RIGORRUN_CASE_OUTCOME and RIGORRUN_CASE_CATEGORY;
                                its output goes to stderr. A non-zero exit, or
                                not finishing within 10 minutes, stops the run
                                with exit 2.

COMPARE OPTIONS
      --baseline <runId>        Compare against this instead of the baseline.

VERIFY OPTIONS
      --max-undetermined <n>    Undetermined findings tolerated. Default 0.
      --min-exercised <n>       Tools that must have been exercised. Default 1.
      --strict                  Treat minor contradictions as failures too.
      --needs-credential <tool> A tool that needs a credential. Repeatable. Never inferred.
  -o, --out <file>              Where to write the record.
      --json                    Print the record and nothing else.

EXIT CODES
  0  success, or the gate passed
  1  the benchmark failed, the gate was not met, or a declaration was
     contradicted by what the server was observed to do
  2  configuration or runtime error
  3  it ran, but established too little to be worth much: verify found too
     little, or run/gate had too many cases end without a verdict (abstained
     for lack of evidence, or lost to a harness failure)

EXAMPLES
  rigorrun                                     start here
  rigorrun projects
  rigorrun run --project p_1a2b3c
  rigorrun gate --project p_1a2b3c --min-success 0.95
  rigorrun run --project p_1a2b3c --case case_one
  rigorrun stripe twin                         then, in another terminal:
  rigorrun stripe init --twin --yes
  rigorrun agent add --project p_1a2b3c --black-box http://127.0.0.1:8080/task
  rigorrun compare-runs --project p_1a2b3c run_9f8e7d

  rigorrun verify npm:@modelcontextprotocol/server-memory@2026.8.31

  rigorrun demo                                a recorded run, replayed
  rigorrun demo --live                         the bundled pipeline, run now
  rigorrun run examples/refund-workflow/benchmark.json --agent naive

Your systems, your credentials and your recordings stay on this machine. There
is no account, and nothing is uploaded unless you ask for it.
`;

export const COMMAND_HELP: Record<string, string> = {
  verify: `rigorrun verify <server-ref> - find out what a server's tools do

Fetches the server, pins it to the exact bytes the registry published, runs it
in a container with no network and no access to this machine, calls each tool
with arguments derived from its own schema, and reads the container's
filesystem before and after to see what actually changed.

Then it compares that against what the server declared. A tool annotated
readOnlyHint: true that writes is reported CONTRADICTED, because that
annotation decides whether an agent may call it without asking.

Nothing it could not establish is reported as a fact. A tool it could not
exercise safely is listed, with the reason.

REFERENCES
  npm:<package>@<version>   A published server. Pinned by the registry's digest.
  dir:<path>                A server on this machine.

OPTIONS
      --max-undetermined <n>  Undetermined findings tolerated. Default 0.
      --min-exercised <n>     Tools that must have been exercised. Default 1.
      --strict                Treat minor contradictions as failures too.
      --needs-credential <tool> A tool that needs a credential. Repeatable. Never inferred.
  -o, --out <file>            Where to write the record.
      --json                  Print the record to stdout and nothing else.

EXIT CODES
  0  nothing contradicted
  1  a declaration was contradicted
  2  the verification could not be run at all
  3  it ran, but established too little to be worth much

REQUIRES
  A container runtime. Run \`rigorrun doctor\` to see whether you have one.`,

  demo: `rigorrun demo - see what RigorRun catches, in a few seconds

By default, replays a real recorded run, offline: no key, no model, no
network. Each recording carries a hash of the run it holds and is refused if
it does not match, and says which model, when and at which commit.

When this build carries the flagship recording, that is the one replayed: the
reference support agent, in two variants, on the Stripe pack's seven cases
(Stripe test mode, or the local twin, labelled simulated), recorded under
reports/flagship-demo-2026-10/PREREGISTRATION.md, with the model's
temperature. It shows the headline case that document's rule picks — the
ticket, what the agent said, what Stripe shows, the verdict — then every case
for both variants. Otherwise, and always
with --northstar, it replays a real model working the bundled synthetic
support system (Northstar Support).

--live runs the whole pipeline now instead: compiles the bundled recorded
workflow into a contract, generates the benchmark, runs the demo agents and the
reference implementation against it, and writes artefacts to .rigorrun/.

OPTIONS
      --northstar      Replay the synthetic example's recording, even when the
                       flagship recording is bundled.
      --live           Run the pipeline now rather than replay a recording.
      --report <path>  Also write an HTML report of every case.
      --published      With --report: a copy with identifiers masked.
      --json           Print the recording (or, with --live, the run) as JSON.
  -o, --out <dir>      With --live: artefact directory. Default .rigorrun
      --workflow <key> With --live: which bundled job. Implies --live.
      --agent <id>     With --live: which agents. Implies --live.`,
  setup: `rigorrun setup <spec.json> - create a project with no interface

Drives the same steps the interface does, from a JSON spec: connect, nominate
reads, demonstrate the job, answer schema questions, compile, decide rules,
build the suite, optionally check it, register agents. Prints the project id.

A spec names the environment variable each secret comes from ("secrets":
{"API_TOKEN": "MY_TOKEN_VAR"}); values are never read from the spec. A rule
RigorRun only inferred is confirmed only when a "review.confirm" pattern
matches its statement; every other inferred rule is rejected.

OPTIONS
      --home <dir>   Where the project store lives.
      --json         Print a summary instead of the project id.
      --quiet        Suppress progress.
`,
  gate: `rigorrun gate --project <id> - fail a build on an unreliable agent

  rigorrun gate --project <id> [--agent <name>] [--report report.html]
  rigorrun gate <benchmark.json> --agent <id>      the older file pipeline

Runs one agent against the project's suite and applies release thresholds.
Exits 0 when every threshold is met, 1 when any is missed, 2 on a
configuration error, 3 when too many cases reached no verdict.

OPTIONS
      --project <id>                The project whose suite and agent to gate.
      --agent <id>                  The agent to gate, by name or id. With --project:
                                    optional when the project has one agent; when it
                                    has several, required, and the gate refuses to
                                    guess. With a benchmark file: required.
      --allow-reference             Permit --agent reference. It is handed the
                                    answer, so the gate passes by construction
                                    and measures the suite, not an agent.
      --min-success <0..1>          Default 0.95
      --min-policy <0..1>           Default 1
      --max-policy-violations <n>   Default 0
      --max-unsafe <n>              Default 0
      --max-inconclusive <n>        Cases allowed to end without a verdict. Default 0
      --case-timeout <ms>           Wall-clock budget per case. Default: the suite's
                                    own — 300000 (5 min) for the Stripe pack, 60000
                                    for a generated suite. Slow models need minutes.
      --case <id>                   With --project: only this case. Repeatable.
      --after-case <program>        Run a program (no shell, no arguments) after each
                                    case, before the next. A failure stops the run
                                    with exit 2.
      --repeats <n>                 Attempts per case. Default 1.
      --report <path>               Also write an HTML report.
`,
  agent: `rigorrun agent add|list --project <id> - the agents on a project

agent add connects a black-box agent: one that answers on an address and does
each case's work itself, wherever it runs, while RigorRun reads the system
afterwards through its own connection. It is sent the rigorrun/task/1 envelope
(or your --body-template) and probed before it is called connected.

  rigorrun agent add --project <id> --black-box <url> [options]
  rigorrun agent list --project <id>

ADD OPTIONS
      --black-box <url>         Required. Where the agent answers. Loopback over
                                http or https; anything else over https, and
                                only a host named with --allow-host.
      --name <name>             What to call it in results.
      --allow-host <host>       A host outside this machine the work may be sent
                                to. Exact names only. Repeatable.
      --body-template <file>    A JSON body with {{caseId}}, {{task.text}},
                                {{task.instruction}}, {{task.policyBrief}} or
                                {{inputs.<name>}} inside strings, instead of the
                                envelope.
      --completion <how>        When the agent's work counts as done:
                                  response  when it answers (default); a 202 is not done
                                  poll      when the statusUrl it answers with says so
                                  settle    --settle seconds after it answers
      --claim-path <path>       Where its final message is in its answer, as a
                                dotted path. Default output.
      --header <Name=secret>    A header whose value comes from the named secret
                                on this machine, never typed here. Repeatable.
      --settle <s>              With --completion settle: how long to wait after
                                it answers, for work it finishes afterwards.
                                Default 5.
      --json                    Print the stored agent.

EXIT CODES
  0  added, and it answered the probe
  1  added, but it did not answer; the reason is printed
  2  refused, and nothing was stored: no such project, an address RigorRun
     will not send work to, or a header secret that is not set`,

  stripe: `rigorrun stripe twin|init|canary - test a refund agent against Stripe

The Stripe pack's own commands. \`rigorrun stripe --help\` and
\`rigorrun stripe <command> --help\` describe each in full.

  rigorrun stripe twin                     A local twin of Stripe's API. No keys;
                                           any sk_test_… key works against it.
  rigorrun stripe init --twin --yes        A project against the twin.
  rigorrun stripe init --safety staging    A project against your test mode, with
                                           the key in $STRIPE_TEST_KEY (--key-env).
  rigorrun stripe canary --project <id>    One $1.00 refund, before the suite.

Keys must be test-mode keys (sk_test_…, rk_test_…), and Stripe confirms the
mode before anything is stored. The key lives in this machine's secret store,
never in the project. Each case creates its own customer and payments, and
RigorRun reads them back with its own key; a verdict says PARTIAL, with what
the reads covered.`,

  record: `rigorrun record - receive a trace from the Chrome recorder

Starts a loopback-only HTTP listener that accepts a single sanitised workflow
trace from the RigorRun recorder extension and writes it to disk. Nothing is
sent anywhere; the listener stops as soon as a trace arrives.

The trace it writes is a record of what happened in a page. It is not a
contract, and "rigorrun compile" cannot read it — compiling needs the state
your system held before and after the job, and a browser recording of an
uninstrumented application does not carry that. To build a suite, connect the
system through the interface and do the job there.

OPTIONS
      --port <n>     Port to listen on. Default 8787.
  -o, --out <path>   Where to write the trace. Default .rigorrun/traces/<id>.json
`,
};
