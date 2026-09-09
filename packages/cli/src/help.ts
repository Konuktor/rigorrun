/**
 * Kept in step with package.json by a test, not by discipline.
 *
 * It appears in `--version`, in every feedback bundle and in every run
 * artefact, so a stale value here is a support conversation about the wrong
 * release.
 */
export const VERSION = '0.1.1';

export const HELP = `RigorRun ${VERSION} - acceptance testing for tool-using AI agents.

Connect your system. Show RigorRun how one job is done. Connect your agent.
RigorRun proves whether the agent can do the job safely - by reading the system
the agent changed, never by trusting what it said about itself.

USAGE
  rigorrun                 Start the runner and open the interface. This is
                           where you connect a system, teach a job and watch a
                           run. Everything below is for scripts and CI.

VERIFY A SERVER
  verify <server-ref>      Run an MCP server's tools in a container RigorRun
                           controls, and report what each one actually does
                           against what the server says it does. Needs no
                           project, no agent and no browser.

                             rigorrun verify npm:<package>@<version>
                             rigorrun verify dir:<path>

PROJECTS
  projects                 List the projects on this machine.
  run --project <id>       Run the project's suite against its agent.
  gate --project <id>      Same, but exit non-zero if it misses the bar.
  compare-runs --project <id> <runId>
                           Say what changed since the baseline run.
  secrets list|set|remove  Credentials, which never leave this machine. Kept in
                           your OS keychain where there is one; \`doctor\` says
                           which store you actually got.

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
  These work on material that ships inside RigorRun. They are how you see the
  shape of the thing without connecting anything; they are not the product.

  demo                     Run the example pipeline offline, end to end.
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
      --agent <id>              Which agent. Defaults to the last connected.
      --min-success <0..1>      Minimum task success. Default 0.95.
      --min-policy <0..1>       Minimum policy compliance. Default 1.
      --max-unsafe <n>          Default 0.

COMPARE OPTIONS
      --baseline <runId>        Compare against this instead of the baseline.

VERIFY OPTIONS
      --max-undetermined <n>    Undetermined findings tolerated. Default 0.
      --min-exercised <n>       Tools that must have been exercised. Default 1.
      --strict                  Treat minor contradictions as failures too.
  -o, --out <file>              Where to write the record.
      --json                    Print the record and nothing else.

EXIT CODES
  0  success, or the gate passed
  1  the benchmark failed, the gate was not met, or a declaration was
     contradicted by what the server was observed to do
  2  configuration or runtime error
  3  verify only: it ran, but established too little to be worth much

EXAMPLES
  rigorrun                                     start here
  rigorrun projects
  rigorrun run --project p_1a2b3c
  rigorrun gate --project p_1a2b3c --min-success 0.95
  rigorrun compare-runs --project p_1a2b3c run_9f8e7d

  rigorrun verify npm:@modelcontextprotocol/server-memory@2026.8.31

  rigorrun demo                                the bundled example
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
  -o, --out <file>            Where to write the record.
      --json                  Print the record to stdout and nothing else.

EXIT CODES
  0  nothing contradicted
  1  a declaration was contradicted
  2  the verification could not be run at all
  3  it ran, but established too little to be worth much

REQUIRES
  A container runtime. Run \`rigorrun doctor\` to see whether you have one.`,

  demo: `rigorrun demo - run the complete offline demo

Compiles the bundled recorded refund workflow into a contract, generates the
benchmark from it, runs Agent A and Agent B against it, and prints the
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
      --allow-reference             Permit --agent reference. It is handed the
                                    answer, so the gate passes by construction
                                    and measures the suite, not an agent.
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
