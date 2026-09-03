export const VERSION = '0.1.0';

export const HELP = `RigorRun ${VERSION} - Do the job once. Test every agent forever.

Turns a recorded human workflow into a private executable benchmark, runs AI
agents against it, and verifies the outcome by inspecting the system the agent
changed - never by trusting the agent's own claim of success.

USAGE
  rigorrun <command> [options]

COMMANDS
  demo                     Run the full pipeline offline: trace -> contract ->
                           benchmark -> Agent A vs Agent B -> report.
  record                   Receive a workflow trace from the Chrome recorder on
                           a loopback-only port.
  compile <trace.json>     Compile a recorded trace into a workflow contract.
  generate <contract.json> Generate a benchmark from a contract.
  run <benchmark.json>     Run one or more agents against a benchmark.
  compare <benchmark.json> Run several agents and print a head-to-head table.
  gate <benchmark.json>    Run an agent and exit non-zero if it misses the bar.
  report <run.json|RUN_ID> Render a self-contained HTML report.
  agents                   List the agents available in this environment.
  doctor                   Show environment and provider status.

COMMON OPTIONS
  -o, --out <path>         Where to write the command's output.
      --json               Print machine-readable JSON to stdout.
      --quiet              Suppress progress output.
  -h, --help               Show help. Add to any command for its own options.
  -v, --version            Print the version.

RUN / COMPARE / GATE OPTIONS
      --agent <id>         Agent to run. Repeat for several agents.
      --repeats <n>        Attempts per case, enabling pass@k. Default 1.
      --report <path>      Also write an HTML report.

GATE OPTIONS
      --min-success <0..1>          Minimum task success rate. Default 0.95.
      --min-policy <0..1>           Minimum policy compliance. Default 1.
      --max-policy-violations <n>   Default 0.
      --max-unsafe <n>              Default 0.

REPORT OPTIONS
      --published          Render the sanitised version intended for sharing.

EXIT CODES
  0  success, or the gate passed
  1  the benchmark failed, or the gate was not met
  2  configuration or runtime error

EXAMPLES
  rigorrun demo
  rigorrun compile examples/refund-workflow/trace.json -o contract.json
  rigorrun generate contract.json -o benchmark.json
  rigorrun compare benchmark.json --agent demo-weak --agent demo-robust
  rigorrun gate benchmark.json --agent demo-robust --min-success 0.95
  rigorrun report .rigorrun/runs/run_abc123.json -o report.html

RigorRun runs entirely offline by default. No account, no API key, no cost.
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
