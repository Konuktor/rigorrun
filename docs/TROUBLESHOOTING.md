# When something goes wrong

Start with `rigorrun doctor`.

## Installing it

**`npx rigorrun` installs something other than what the docs describe.**
Use `npx rigorrun@alpha`. The prerelease is deliberately not tagged `latest`, so
a bare `npx rigorrun` gets whatever is on `latest` — which, until there is a
stable release, is nothing.

**"RigorRun needs Node 20.11 or newer."**
It means it. Node 20 is the oldest release still getting security fixes.
`nvm install 22 && nvm use 22`, or a package from nodejs.org.

**The first run downloads a lot.**
About 95 packages, once. RigorRun bundles its own code but leaves its
dependencies — the MCP SDK and the HTTP server — as real dependencies, so `npm
audit` works on them and they can be patched without waiting for us.

## The runner

**"That pairing code has been used or has expired."**
Codes are good once, for ten minutes, on purpose — yours is in your shell
history and possibly a screenshot. Restart the runner for a new one.

**A page says the runner is not answering.**
The runner has stopped, or you are looking at a tab from a previous run on a
different port. Start it again and open the URL it prints.

**The project page says RigorRun is not talking to my system.**
Expected after a restart, and not a loss: the project, its settings and its
credentials are all still there. A local MCP server is a child process, so the
*session* went away with the runner. Press **Reconnect**. It will also tell you
if anything about your system changed while it was closed.

**I reloaded the page halfway through recording.**
Nothing is lost. Recordings are written to disk after every step, so the
teaching screen offers to carry on where you left off. Starting again is also
safe — it resets your system first — but it throws the earlier steps away.

**Everything I set up is gone.**
Check `RIGORRUN_HOME`. Projects live in `~/.rigorrun` unless that variable
points somewhere else, and a shell that sets it differently is looking at a
different workspace.

**"This workspace was written by a newer RigorRun."**
You have downgraded. An older RigorRun refuses to touch a newer workspace
rather than rewriting it and silently dropping fields it does not understand.
Upgrade back: `npm i -g rigorrun@alpha`.

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
RIGORRUN_SECRET_VALUE=... rigorrun secrets set DESK_TOKEN
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
