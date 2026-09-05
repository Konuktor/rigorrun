/**
 * Kept in step with package.json by a test, not by discipline.
 *
 * It appears in `--version`, in every feedback bundle and in every run
 * artefact, so a stale value here is a support conversation about the wrong
 * release.
 */
export const VERSION = '0.1.0-alpha.1';

export const HELP = `RigorRun ${VERSION} - acceptance testing for tool-using AI agents.

Connect your system. Show RigorRun how one job is done. Connect your agent.
RigorRun proves whether the agent can do the job safely - by reading the system
the agent changed, never by trusting what it said about itself.

USAGE
  rigorrun                 Start the runner and open the interface. This is
                           where you connect a system, teach a job and watch a
                           run. Everything below is for scripts and CI.

PROJECTS
  projects                 List the projects on this machine.
  run --project <id>       Run the project's suite against its agent.
  gate --project <id>      Same, but exit non-zero if it misses the bar.
  compare-runs --project <id> <runId>
                           Say what changed since the baseline run.
  secret list|set|remove   Credentials, which never leave this machine.

DIAGNOSTICS
  doctor                   Check this machine can do what RigorRun needs.
  feedback export          A sanitised bundle for a bug report. No credentials,
                           no tool arguments, no results, no names from your
                           business. Use -o to write it to a file.

THE BUNDLED EXAMPLE
  These work on material that ships inside RigorRun. They are how you see the
  shape of the thing without connecting anything; they are not the product.

  demo                     Run the example pipeline offline, end to end.
  workflows                List the example jobs.
  environments             List the environments registered in this build.
  inspect-environment <id> Show the records, links and actions an adapter has.
  init-environment <name>  Scaffold an environment adapter to edit.

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
  -o, --out <path>         Where to write output.
      --json               Machine-readable output.
      --quiet              Suppress progress.
  -h, --help               Help. Add to any command for its own options.
  -v, --version            Print the version.

RUN / GATE OPTIONS
      --agent <id>              Which agent. Defaults to the last connected.
      --min-success <0..1>      Minimum task success. Default 0.95.
      --min-policy <0..1>       Minimum policy compliance. Default 1.
      --max-unsafe <n>          Default 0.

COMPARE OPTIONS
      --baseline <runId>        Compare against this instead of the baseline.

EXIT CODES
  0  success, or the gate passed
  1  the benchmark failed, or the gate was not met
  2  configuration or runtime error

EXAMPLES
  rigorrun                                     start here
  rigorrun projects
  rigorrun run --project p_1a2b3c
  rigorrun gate --project p_1a2b3c --min-success 0.95
  rigorrun compare-runs --project p_1a2b3c run_9f8e7d

  rigorrun demo                                the bundled example
  rigorrun gate examples/refund-workflow/benchmark.json --agent reference

Your systems, your credentials and your recordings stay on this machine. There
is no account, and nothing is uploaded unless you ask for it.
`;

export const COMMAND_HELP: Record<string, string> = {
  demo: `rigorrun demo - run the complete offline demo

Compiles the bundled recorded refund workflow into a contract, generates the
17-case benchmark, runs Agent A and Agent B against it, and prints the
head-to-head comparison. Writes artefacts to .rigorrun/.

OPTIONS
  -o, --out <dir>    Artefact directory. Default .rigorrun
      --report <path>  Also write an HTML report.
      --json         Print the run result as JSON.
      --quiet        Suppress per-case progress.
`,
  gate: `rigorrun gate <benchmark.json> - fail a build on an unreliable agent

Runs one agent against a benchmark and applies release thresholds.
Exits 0 when every threshold is met, 1 when any is missed, 2 on a
configuration error.

OPTIONS
      --agent <id>                  Required. The agent to gate.
      --min-success <0..1>          Default 0.95
      --min-policy <0..1>           Default 1
      --max-policy-violations <n>   Default 0
      --max-unsafe <n>              Default 0
      --repeats <n>                 Attempts per case. Default 1.
      --report <path>               Also write an HTML report.
`,
  record: `rigorrun record - receive a trace from the Chrome recorder

Starts a loopback-only HTTP listener that accepts a single sanitised workflow
trace from the RigorRun recorder extension and writes it to disk. Nothing is
sent anywhere; the listener stops as soon as a trace arrives.

OPTIONS
      --port <n>     Port to listen on. Default 8787.
  -o, --out <path>   Where to write the trace. Default .rigorrun/traces/<id>.json
`,
};
