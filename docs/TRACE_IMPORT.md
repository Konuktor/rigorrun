# Turning a production failure into a permanent case

RigorRun's argument is that it works *before* there is traffic: somebody
demonstrates a job once and gets a suite. Then traffic arrives, and something
goes wrong in a way nobody thought to generate.

That failure should stop being a bug report somebody closes.

## What RigorRun takes from the trace, and what it does not

**It takes the situation.** What the agent was working on — the arguments of the
job it got wrong.

**It works out the rest.** What *should* have happened is computed from your
confirmed rules, by the same hypothetical completion every generated case uses:
reset, install the starting position, execute the plan the rules imply, look at
what that produced, roll back.

This matters more than it sounds. The obvious design is to record what happened
and assert it must not happen again — and a case built that way passes as soon
as the agent avoids that exact sequence, which is not the same as the agent
being right. It also freezes one incident's details as the definition of
correct, so the case stops meaning anything the first time the job changes.

A trace is the agent's own record of what it sent. Believing it would mean
adding the agent's account of itself to the thing that exists to check the
agent's account of itself.

## Reading is a separate step from deciding

Importing happens in two requests, on purpose. RigorRun reads the trace and
shows you what it found — the calls, in order, with their arguments; what
failed, in the words the trace used; and **how many spans it did not
understand**. Nothing is added until you say so.

## What it can read

OTLP as a collector's JSON exporter writes it (`{"resourceSpans":[…]}`), the
flatter `{"spans":[…]}` several SDKs write, and a bare array of spans.
Attributes as OTLP's typed key/value list, or as a plain object.

Tool calls are recognised under four conventions — `gen_ai.tool.name`,
`tool.name`, `mcp.tool.name`, `rpc.method` — and from the span name alone, which
is the oldest convention and still common. No particular framework is required
and none is assumed: the GenAI semantic conventions are the newest and least
settled thing in OpenTelemetry, and an importer that insisted on today's
spelling would stop working on your next upgrade.

A trace from a runtime this reader has never seen produces a **partial** answer
with a count of what it skipped, rather than an error. The people with a failure
to explain are not the people who already use whichever framework an importer
was written against.

## What it refuses

- **A window of traffic.** Export the one trace you want to turn into a case.
- **A failure the rules cannot explain.** If your confirmed rules admit no way
  to complete the request and no single rule says why, RigorRun will not build
  the case. Guessing at an expected outcome would produce a case that passes for
  the wrong reason. The rules need reviewing first, and it says so.

## What is not built yet

- **No importing RigorRun's own run artefacts.** A failure from a previous run
  is already in that run's evidence; making it a case is a separate step nobody
  has needed yet.
- **No starting state from a trace.** A case starts from wherever your reset
  leaves the system, because telemetry describes what an agent did and never
  what the system held — and inferring one from the other is exactly the kind of
  quiet assumption a verdict should not rest on.
