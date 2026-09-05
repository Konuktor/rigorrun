# When something goes wrong

Start with `rigorrun doctor`.

## The runner

**"That pairing code has been used or has expired."**
Codes are good once, for ten minutes, on purpose — yours is in your shell
history and possibly a screenshot. Restart the runner for a new one.

**A page says the runner is not answering.**
The runner has stopped, or you are looking at a tab from a previous run on a
different port. Start it again and open the URL it prints.

**"forbidden host"**
Something reached the runner with somebody else's domain in the `Host` header.
If that was not you, it is worth knowing about: it is what DNS rebinding looks
like.

## Connecting a system

**"Could not reach the MCP server at …"**
Run the command yourself in a terminal first. A local server that fails to
start prints its reason to stderr; RigorRun does not put that on its own
standard output, because that channel is machine-readable.

**"This project needs DESK_TOKEN, which this machine does not have."**
Projects carry the names of their credentials and never the values, so a project
moved between machines needs its secrets set again:

```bash
RIGORRUN_SECRET_VALUE=... rigorrun secret set DESK_TOKEN
```

**"Refusing to run a command containing shell metacharacters."**
Give the binary and its arguments separately. `npx -y @example/mcp` is a
command and two arguments, not one string.

**Connected, but tools are missing arguments.**
RigorRun lists what it could not express and why — usually a nested object or a
list, which it cannot yet compare against. The tool still works; only assertions
about that argument are unavailable.

## Recording a job

**"Nothing was recorded."**
A demonstration needs at least one action that changes something. The contract
is derived from what changed, so a sequence of reads teaches nothing.

**"Nominate at least one read before recording."**
Without one there is no way to see what the job changed.

**The records have the wrong names.**
They are named from your system's own collection keys and are questions, not
decisions. Change them on the review screen.

## Building a suite

**"N rules are still waiting on a decision."**
Nothing RigorRun only inferred can fail an agent until you have confirmed it.
Answer yes or no to each.

**"No cases could be built."**
Your system cannot be seeded, so every case would have needed a starting state
RigorRun cannot install. Configure a reset that produces a world these rules can
be exercised against.

**Fewer cases than expected.**
Look at *Not covered, and why* on the result. It lists every rule the
environment enforces itself — nothing can be caught breaking those — and every
case shape that needed a world RigorRun could not build.

## Running an agent

**"… has not answered a connection test."**
RigorRun sends a probe your agent must answer without doing any work. See
[HTTP_AGENT.md](HTTP_AGENT.md).

**"Agent endpoint must be loopback"**
An agent under test usually holds credentials for the system being tested.
Pointing at a remote one is a decision you have to make explicitly.

**Everything failed, and the steps show `WRITE_REFUSED`.**
The environment is marked production, so writes are refused at the channel.
That is working as intended. Point at staging, or change the safety mode.

**The verdict says `OBSERVATIONAL`.**
Nothing could be read back, so RigorRun saw what your agent did and could not
check whether it worked. Nominate a read.

## Comparing runs

**"These two runs are not comparable."**
They used different benchmarks, so a difference between them is not necessarily
a difference in the agent. Re-run the baseline against the current suite.
