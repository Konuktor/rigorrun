<div align="center">

# RigorRun

**Your agent said it worked. RigorRun checks what it actually did.**

Show RigorRun a job once. It turns that into a repeatable acceptance suite and decides whether your
agent is safe to ship by reading the system it changed — never by trusting what it says about itself.

**Early Access · v0.2** — parts of it are honestly unfinished, and they are listed rather than hidden.

[rigorrun.xyz](https://rigorrun.xyz) · [Documentation](https://docs.rigorrun.xyz) · [Evidence](https://rigorrun.xyz/evidence) · [What is and is not built](https://rigorrun.xyz/what-is-built)

</div>

```bash
npx rigorrun
```

Open the URL it prints. Everything runs on your machine: there is no account, and no hosted
component to send your systems to.

---

## Why

An agent that reports success and an agent that achieved it are indistinguishable from the
transcript. They are trivially distinguishable from the database.

Evaluation harnesses score what the model wrote. RigorRun compares system state before and after,
through read operations you nominate, and asks the questions that have a fact behind them: does the
refund exist, is the amount right, is the ticket attached, was approval required, and did anything
change that should not have.

```
most tools:   you write the tests   →  the tool runs them
  RigorRun:   you do the job once   →  RigorRun writes the tests
```

## How

1. **Connect your system** — an MCP server you already run, an OpenAPI document, or a web
   application through a browser.
2. **Do the job once.** RigorRun reads your system before and after and derives what the rules must
   be.
3. **Rule on what it worked out.** It shows the evidence behind each proposed rule. A rule you
   reject cannot fail your agent.
4. **Connect your agent** — an HTTP endpoint, a local command, or your own loop pulling work.
5. **Run it.** A verdict, with how strongly each answer could be verified.
6. **Gate the next change** in CI.

Setting a project up happens in the local interface. Running, gating and comparing are also
available from the command line, which is the half CI needs.

```bash
rigorrun gate --project <id>     # exit 1 stops the build
```

## Verify a published MCP server

An MCP server can annotate a tool `readOnlyHint: true`. Nothing checks that, and agents use it to
decide whether a tool may be called without asking.

```bash
rigorrun verify npm:@modelcontextprotocol/server-memory@2026.8.31
```

Pins the server to the exact bytes the registry published, runs it in a container with no network
and no access to your machine, calls each tool with arguments derived from its own schema, and reads
the filesystem before and after. Needs a container runtime; nothing else does.

Run against four published servers, it exercised **19 of 37** tools. The other 18 are named, each
with the reason it was not reached — [see the records](https://rigorrun.xyz/evidence).

## What you should know before relying on it

- **A verdict against a real system is `PARTIAL`, by design.** RigorRun reads back what your
  nominated reads return and no more, and says so on every result.
- **A browser cannot verify itself.** A page saying "done" is a claim by the system that would have
  to be wrong for it not to be done, so a browser connection is `OBSERVATIONAL`. Attach a readable
  API or MCP connection for the same system to strengthen it.
- **Isolation is `DECLARED`, not `RESET`, when you nominate a reset tool** — RigorRun has not run it
  twice and compared.
- **Three of the six verification sources are not emitted yet.** Model-judged and human-review
  evaluators exist in the schema and are unreachable in practice.
- **No external team has used this yet.** There are no customers.

The full list is at [rigorrun.xyz/what-is-built](https://rigorrun.xyz/what-is-built), and the
version carrying how each line was checked is
[docs/V1_GAP_AUDIT.md](https://github.com/Konuktor/rigorrun/blob/master/docs/V1_GAP_AUDIT.md).

## Privacy

Your systems, your credentials and your recordings stay on this machine. There is no account, and
nothing is uploaded unless you ask for it.

Three things can make a network request, all because you asked: `rigorrun verify` downloads the named
package from the npm registry; connecting your own system sends requests to your own system; and an
LLM-backed agent, which exists only if you set a provider key, talks to that provider. None of them
reach RigorRun. [How it is built](https://rigorrun.xyz/security).

## Verifying what you installed

Published by a GitHub Actions workflow that holds no npm token, using npm trusted publishing, with a
SLSA build provenance attestation.

```bash
npm audit signatures
npm view rigorrun dist.integrity
```

## Requirements

Node 20.11 or newer. Docker only for `rigorrun verify`.

```bash
rigorrun doctor      # what this machine has, and what it does not
```

---

MIT · Built by Erbol Tahirov · [Report a problem](https://github.com/Konuktor/rigorrun/issues)
