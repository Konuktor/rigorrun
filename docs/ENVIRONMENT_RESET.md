# Putting the system back

Running the same mutating case twice without restoring the world in between
measures the wreckage of the first attempt. RigorRun therefore treats reset as
a capability a system either has or does not, and says which on every result.

## Configuring one

Nominate a tool your system publishes that restores it to a known state. In the
bundled fixture that is `reset_desk`; in a real system it might be a fixture
loader, a database restore endpoint, or a tenant reset.

RigorRun calls it before recording your demonstration, and before every case.

## What a reset buys

**Isolation.** Every case starts from the same place, so results are
independent and a failure belongs to the case that produced it.

**Reproducibility.** The same suite run twice against the same agent gives the
same answer, which is the whole basis for saying anything changed.

**A known starting world.** RigorRun cannot install a state into your system,
but a reset that always produces the same one is nearly as good: the fixture
every case starts from is whatever your reset restores.

## Without one

RigorRun still runs. It does not pretend:

- The result is labelled `ISOLATION: NONE`.
- Repeated attempts per case are refused rather than performed, and the reason
  is written into the result: *"Asked for 5 attempts per case, ran 1: without a
  reset every attempt after the first would start from the last one's
  leftovers."*
- The limit appears on screen with what would lift it.

This is a real degradation and it is stated rather than absorbed. A suite that
quietly ran five dependent attempts and averaged them would be worse than one
that ran one and said so.

## What RigorRun will not do

It will not invent a reset by undoing what it saw. Replaying inverse operations
against somebody's system is a plausible-sounding idea that goes wrong in
exactly the situations where it matters — a partially applied job, a tool with
a side effect nobody mentioned, a record another process touched in between.

It will not run anything that writes against a system you marked production,
reset or no reset. See [SECURITY_MODEL.md](SECURITY_MODEL.md).
