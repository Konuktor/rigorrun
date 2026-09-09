# The sandbox, and what it does not do

`rigorrun verify` runs code written by somebody else, on purpose. That makes the
container the highest-risk subsystem in the product, and this page describes the
boundary rather than advertising it.

**The headline, first, because it belongs at the top rather than in a footnote:**

> RigorRun does not claim to prevent a container escape. On a rootful Docker
> daemon — the common installation, and the one this was developed against — a
> process that escapes its container is on the host as root. What the harness
> does is reduce blast radius and make the boundary checkable.

That sentence is not only here. It is in `harness.caveats` of every verification
record, in the machine-readable part, so a reader who never opens this page
still gets it.

---

## What runs where

| Step | Where | Can the target's code run? |
|---|---|---|
| Resolve the reference | host, network | no |
| Fetch the tarball, check its digest | host, network | no |
| Install dependencies | host, network | **no** — `--ignore-scripts` |
| Build the image | host, no network | **no** — the Dockerfile has no `RUN` |
| Run the server | container, no network | yes, and only here |

Two of those rows are the design. Nothing else on this page matters as much.

**`npm install --ignore-scripts` is not a hardening option, it is the point.**
A `postinstall` on an untrusted package is arbitrary code executing as the
operator, on the host, with the operator's home directory and credentials,
before any container exists. Every install RigorRun performs carries the flag,
and there is a test that greps for it.

**The generated Dockerfile contains no `RUN` instruction**, so there is no point
during image construction at which the target's own code executes. That is also
a test, and it is an assertion about a generated artifact rather than a promise.

A package that genuinely needs a build step therefore fails to stage, loudly,
rather than being built quietly. That is a worse experience and a better
default.

---

## The container

```
docker run --rm -i
  --name rigorrun-verify-<id> --label rigorrun.harness=1
  --network none
  --read-only
  --cap-drop ALL
  --security-opt no-new-privileges
  --user 65532:65532
  --pids-limit 256
  --memory 512m --memory-swap 512m
  --cpus 1
  --tmpfs /work:rw,nosuid,nodev,size=256m,mode=1777
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777
  <image>
```

The literal argv is recorded in `harness.runArgv` of every record, so the
posture can be checked rather than believed. `packages/sandbox/test/posture.test.ts`
asserts each property from the argv, and needs no container runtime to run — the
boundary is reviewable on a machine that cannot start a container at all.

| Flag | Threat |
|---|---|
| `--network none` | Exfiltration, callbacks, dependency-confusion fetches at run time |
| `--read-only` | Persisting anything into the image layer |
| `--cap-drop ALL` | Everything capability-gated, including `CAP_CHOWN` and `CAP_DAC_OVERRIDE` |
| `--security-opt no-new-privileges` | A setuid binary regaining what was dropped |
| `--user 65532` | Running as root inside the namespace |
| `--pids-limit` | Fork bombs |
| `--memory`, `--memory-swap` | Memory exhaustion, and walking around the limit via swap |
| `--cpus` | CPU exhaustion |
| tmpfs only | Filesystem exhaustion; and every byte dies with the container |
| no `-v`, no `--mount` | Host filesystem access |
| no docker socket | The container starting containers |
| no `-e` | Inheriting the operator's environment, tokens included |

`/work` is deliberately **not** `noexec`: a native addon is `dlopen`ed and would
fail. `/tmp` is `noexec`.

`assertPostureIntact` scans every argv for `--privileged`, `--cap-add`,
`--device`, host namespaces, any bind mount, and any mention of a runtime
socket, and refuses. Every argv is built from constants and validated tokens
already, so this is belt and braces — but the failure it prevents is a container
running with the host's filesystem attached.

---

## Cleanup

The process RigorRun spawns is the **docker client**, not the container.
Killing it does not reliably stop the container, so cleanup never keys on a pid:

- every container carries `--name` and `--label rigorrun.harness=1`
- the session removes its container in a `finally`, on success and on failure
- `verify` reaps every container carrying the label **before** starting, so a
  previous run killed outright leaves nothing behind for long

A container left running with a stranger's code in it is the same class of
problem as the orphaned stdio server the daemon already learned about, and it is
handled the same way — except that a label cannot be recycled the way a pid can.

---

## What is observed, and how much it is worth

| Surface | Read by | Strongest claim |
|---|---|---|
| `container_fs` | `sha256sum` over `/work` and `/tmp` | `PARTIAL` |
| `process_table` | `/proc` walk | `PARTIAL` |
| `server_reads` | the server's own tools | `OBSERVATIONAL` |
| `container_diff` | `docker diff` | posture control only |

`container_fs` is **`PARTIAL`, not `AUTHORITATIVE`**, and the distinction is
deliberate. With no network, a read-only root and tmpfs mounts, the enumeration
is complete over *durable* state — there is nowhere else to persist a byte. It
is blind to state a process holds only in memory, which does survive between
tool calls within one container. A heap is part of the system of record, and we
cannot read it, so the label says so.

**`docker diff` is not used to observe state, and that is load-bearing.** Under
`--read-only` every write lands on a tmpfs mount, and `docker diff` reports only
the container layer — so it comes back empty and looks exactly like proof that
nothing was written. Using it as the state surface would manufacture a false
clean verdict for every tool on every server, which is the worst failure this
harness could have. It is used only to check that the read-only posture held.

**The server's own read tools may corroborate a contradiction and may never
establish one.** The server that might be misdeclaring a tool is the same server
answering the read.

---

## Threats, and what is actually done about each

| Threat | Position |
|---|---|
| Container escape | **Not solved, not claimed.** Rootful daemon means an escape reaches the host as root. Rootless is preferred where available and is recorded per run. |
| Host filesystem access | No bind mounts, no volumes. Asserted from the argv. |
| Container runtime socket | Never mounted; any argv mentioning it is refused. |
| Network exfiltration | `--network none`. Egress is not opt-in today; when it becomes so it is recorded in the record. |
| Resource exhaustion, fork bombs | pids, memory, swap, CPU and tmpfs size all capped. |
| Malicious install scripts | `--ignore-scripts` on every install. A package needing a build fails loudly. |
| npm lifecycle scripts at build | Impossible: no `RUN` in the generated Dockerfile. |
| Artifact substitution between resolve and run | The tarball is fetched once, hashed, and compared to the registry's `dist.integrity` before anything unpacks. A mismatch stops the run with nothing staged. |
| Malicious MCP schemas | The argument planner walks with hard depth, node and property caps, and refuses rather than recursing. |
| Huge outputs | The MCP transport's read buffer is bounded; a breach is a runtime failure, never a behavioural one. |
| Terminal escape sequences in tool output | Tool output reaches the record, not the terminal, and the record is JSON. |
| Secret leakage | The container is given no environment at all. No credentials are passed to any target today. |
| Cross-target contamination | One container per tool, destroyed after. Nothing is shared between targets. |
| Symlink traversal out of the container | Bounded by the container, not by us; nothing outside is mounted for a symlink to reach. |

---

## What would strengthen this

Honestly, in order of how much each would buy:

1. **A rootless runtime.** The single largest change available. Rootless Podman
   or rootless Docker turns an escape into an unprivileged user on the host
   rather than root. The harness already detects and records which it got; it
   does not yet require one.
2. **A user namespace with a mapped subuid range**, for the same reason.
3. **A seccomp profile narrower than the default.**
4. **gVisor or a microVM**, which is the only thing on this list that would let
   anyone say the word "solved" about escape.

None of these are implemented. They are written down because a threat model that
lists only what was done is a marketing page.
