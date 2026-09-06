# Getting started

Connect your system. Show RigorRun how one job is done. Connect your agent.
RigorRun proves whether the agent can do that job safely — by reading the
system it changed, never by trusting what it said about itself.

This takes about ten minutes and runs on your machine.

## Why it runs locally

Your MCP server, your internal API and your staging box are usually not
reachable from the public internet, and a page served over `https` cannot fetch
`http://127.0.0.1` — Firefox and Safari refuse it as mixed content and Chrome
adds a preflight of its own. So a hosted interface could never see the systems
most people want tested.

RigorRun's interface is therefore served by a small local process. Your
credentials, your recordings and your systems never touch anybody's
infrastructure, because there is no path by which they could.

## 1. Start the runner

```bash
npx rigorrun
```

It opens your browser, and prints the URL it opened in case it could not:

```
RigorRun

  Open  http://127.0.0.1:41925/?code=RKBB-9E64

  Projects and credentials live in ~/.rigorrun, and stay there.
  Press Ctrl+C to stop.
  Lost the tab? Press Enter here for a new link.
```

The code is spent on first use, so the copy in your shell history is worthless,
and a page you did not open cannot drive the runner. If you lose the tab, press
Enter in that terminal for a fresh link — being at the terminal is the same
authority that read the first code off the screen.

On a server, in a container, or over SSH, add `--no-open` and use the printed
URL.

> **Early Access · v0.1.** It does what this page says and it is young. Every
> capability is marked WORKING, PARTIAL or MISSING in
> [V1_GAP_AUDIT.md](V1_GAP_AUDIT.md), with how each one was checked — read that
> before relying on it for something that matters.
>
> Working from a clone instead? `pnpm install && pnpm start`. `pnpm start`
> builds the interface and then starts the runner; `pnpm rigorrun` alone skips
> the build, which is what you want while developing and not what you want the
> first time.

## 2. Make a project

A project is one job you want an agent to do, in one of your systems. Give it a
name and one sentence describing the job — that sentence becomes the
instruction your agent is given, so write it the way you would explain it to a
new colleague.

## 3. Connect your system

RigorRun speaks [MCP](https://modelcontextprotocol.io). Point it at a server
either on this machine (a command it runs) or elsewhere (a URL).

It completes a real handshake and shows you what is there: every tool, its
arguments, and what it is likely to cost you. Two things then need your
judgement, because neither can be discovered:

**Which tools only read.** A server can annotate a tool `readOnlyHint: true`,
and RigorRun shows you that it did — labelled as the server's claim. It will
not act on it. The specification is blunt about why: *"Clients should never make
tool use decisions based on ToolAnnotations received from untrusted servers."*
A tool nobody has vouched for counts as writing.

**Which tools read the records you care about.** These are the calls RigorRun
makes *after* your agent finishes, to find out what actually happened. They are
the entire reason a verdict can rest on your system rather than on your agent's
account of itself. Pick at least one.

RigorRun then calls the ones you picked, before you do anything else. If they
answer in prose rather than in records — a directory listing, a formatted
summary — it says so there and then, because it reads structure and never prose,
and there is no point in you demonstrating a job it will not be able to check.
You can continue anyway; every verdict will say `OBSERVATIONAL`. See
[VERIFICATION.md](VERIFICATION.md).

You will also be asked which tool puts the system back, and what kind of system
this is. See [ENVIRONMENT_RESET.md](ENVIRONMENT_RESET.md) and
[SECURITY_MODEL.md](SECURITY_MODEL.md).

## 4. Do the job once

Press **Start recording** and do the job through your system's own tools.
RigorRun reads the system before you start and again when you finish, and works
out the rules from what changed — so a job that leaves no trace cannot be
learned.

Recording resets the system first, so the job starts where your tests will
start.

## 5. Review what it learned

RigorRun worked the records out from what your system handed back. It read the
*shape* of the data and never the names, which is what stops a business
vocabulary getting into the parts that are supposed to be general — and it
means some things it genuinely cannot know:

- **What a number is measured in.** It can see two decimal places; it cannot
  see pounds. The unit decides what "one more than the limit" means, so a
  boundary case cannot sit on the boundary until you answer.
- **Whether somebody outside your organisation can write a text field.** No
  amount of data can answer this, and it decides where injection payloads go.

Each question arrives with the observation that prompted it, so you can
disagree with the evidence rather than with an assertion.

## 6. Rule on the rules

RigorRun compiles what it watched into rules and enforces none of them. A rule
you do not confirm cannot fail your agent, which is why it proposes more than it
expects you to keep — saying no is cheap, and missing a real rule is not.

Then it builds the suite, and tells you what it could not cover here and why.

## 7. Connect your agent

Any agent that speaks MCP works as it is. RigorRun gives it one task at a time
and an MCP endpoint scoped to that task; your agent connects, works however it
normally works, and says when it is done. See [MCP_PROXY.md](MCP_PROXY.md) and
[HTTP_AGENT.md](HTTP_AGENT.md); if you would rather use the SDK, see
[TYPESCRIPT_AGENT_SDK.md](TYPESCRIPT_AGENT_SDK.md).

An agent is not connected because you typed a URL. RigorRun sends a probe and
waits for an answer, and until it gets one it says so.

## 8. Run it

The answer is **safe to ship? yes, conditional or no** — not a score. Conditional
is not a softer yes: it means every check passed and RigorRun could not see
enough to promise they mean what they look like, usually because the reads cover
part of your system rather than all of it. Beside it: how the verdict was
reached, what this system stopped RigorRun doing, and every case.

Ask any case what happened and you get the check that failed and which tier of
evidence decided it, what your agent actually called, what your system said
afterwards, and — separately, and never scored — what your agent said it did.
That last pairing is the point: an agent reporting success over a system that
says otherwise is the failure this exists to catch. See
[VERIFICATION.md](VERIFICATION.md).

Change your agent, run it again, and RigorRun tells you which case regressed —
not that a number moved. That is the part worth coming back for.

## Then: CI

```bash
rigorrun gate --project p_1a2b3c --min-success 0.95
```

See [CI.md](CI.md).

## Stopping and coming back

Everything is on disk as you go, written in a way that survives the process
being killed outright rather than asked politely. Closing the tab, reloading the
page, or the runner crashing does not lose your project, your settings, your
credentials, or a recording you were partway through — reopen it and carry on
where you left off. `e2e/restart.spec.ts` kills the runner with SIGKILL in the
middle of a recording and picks it up again.

If a file on disk is ever damaged anyway, the project stays in your list and
says what happened. It does not disappear, because a project that vanishes looks
exactly like a project that was never saved.

The one thing that does not survive is the live connection to your system. A
local MCP server is a child process, and it is gone when the runner stops. The
project page says so and offers **Reconnect**, which opens the session again and
tells you if anything about your system changed while it was closed — a tool
renamed, an argument that is now required, a read-only claim reversed. Your
suite would still run; whether it still means the same thing is a judgement
about your tools, so RigorRun reports it rather than deciding for you.

## If something goes wrong

[TROUBLESHOOTING.md](TROUBLESHOOTING.md), or `rigorrun doctor`.

If you want to send it to us:

```bash
npx rigorrun feedback export -o rigorrun-feedback.json
```

That file contains your operating system, Node and RigorRun versions, how far
you got, how long it took, what kind of connector you used, counts of tools and
cases, and the *classes* of anything that failed. It contains no credentials, no
tool arguments, no results, and no names from your business. Open it before you
send it — it is small and readable on purpose.
