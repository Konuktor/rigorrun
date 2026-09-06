# Third-party dogfood

RigorRun has been used successfully by the people who built it. That proves
almost nothing: we know where every rough edge is, and we route around them
without noticing we are doing it.

This document is the protocol for finding out whether anybody else can use it.

## What the first clean-room run already found

Before asking anybody, RigorRun was pointed at
[`@modelcontextprotocol/server-filesystem`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem)
— unmodified, from npm, in a throwaway directory. Nobody here chose its tools,
its argument names, its annotations or the shape of what it returns.
`packages/mcp/test/thirdParty.test.ts` and `packages/daemon/test/thirdParty.test.ts`
are that run, kept as tests.

**What worked.** Discovery, argument schemas, and risk classification, against a
server nobody designed for. It annotates carefully — `readOnly` on all eight of
its reads, `destructive` on write, edit and move — and RigorRun refused to act
on any of it: every tool counted as writing until a person said otherwise. A
server that annotates well is indistinguishable, from the client side, from one
that annotates conveniently, which is exactly what the specification says to
assume.

**What did not, and it matters.** Its reads answer in prose. `list_directory`
returns `[FILE] q3-plan.md`, not a record. RigorRun reads structure and never
prose, so there was nothing to compare before against after: **this system can
be watched and cannot be verified.**

That is a real limit and it is stated on the box. The bug was what RigorRun did
about it. It connected happily, accepted the reads, let the whole job be
demonstrated, and only then refused — with "the recording performed `write_file`
but nothing in the system changed". The recording was fine. The person was sent
to fix the wrong thing, at the latest possible moment.

Now the reads are tried when they are nominated, and if they come back as text
RigorRun says so before anybody does twenty minutes of work, says which of the
two problems it is, and offers to continue anyway with every verdict marked
`OBSERVATIONAL`. **Expect a tester to hit this.** A large share of MCP servers
in the wild return text, and "I connected it and it says it cannot check my
system" is a legitimate finding rather than a failure of the tester.

## And the whole journey, against a second public server

`@modelcontextprotocol/server-memory` answers its reads in records —
`{"entities":[…],"relations":[…]}` — so the rest of the loop could be run
against it, and was. `packages/daemon/test/publicServerJourney.test.ts`
connects to it unmodified from npm, teaches it a job, and gets a verdict.

What RigorRun induced from it, from structure alone and never from the names of
its fields:

    Entitie(name, entityType, observations)   Relation(from, to, relationType)

Two record types out of a knowledge graph, which is not one of the six bundled
workflows nor the dogfood fixture's business. Then a contract, a suite, an agent
run, and a verdict reading `verified: PARTIAL` and `isolation: NONE` — because
that server publishes no way to put itself back, and pretending otherwise would
be worth less than saying so.

Writing that test found one more thing, and it is the same class as the first.
An **empty** system and a system that answers in **prose** both induce no
records, and RigorRun reported them identically — so connecting a fresh server
with nothing in it yet produced a warning about an unfixable problem. It now
tells them apart: nothing in this system yet is "fine, it will work them out
from your demonstration", and that is not the same finding at all.

## The rule

**A tester gets two things: an install command, and `docs/GETTING_STARTED.md`.**

They do not get an architecture explanation, a walkthrough, the fixture source,
or a nudge when they hesitate. If they get stuck, that is the finding. Helping
them past it converts the most valuable thing this exercise produces — a real
person's confusion, in real time — into a pleasant conversation that teaches us
nothing.

The one exception is a hard block: something crashes, or a bug makes it
impossible to continue. Note it, unblock them, and record that the run was
assisted from that point. An assisted run still tells us about the steps after
it; it just cannot be counted as an unassisted completion.

## Who to ask

Somebody who already has an MCP server for a system they care about, and an
agent that works against it. Not somebody who would have to build both first —
that is a different test, of a different thing, and it will take them a day.

Three testers, because the first will find things so obvious that they drown
out everything else, the second will confirm which of those were real, and the
third is the first honest reading.

Ask them to use a **staging or scratch system**, with a way to reset it.
RigorRun refuses to write against anything marked production, but the point of
the exercise is to watch somebody run a real test, not to watch them read a
refusal.

## What to send them

Exactly this, and nothing else:

> RigorRun is an early tool for testing whether an AI agent can do a real job
> in a real system. I would like to watch you try it cold — I have not sent you
> anything else on purpose, because what I need to know is where it stops making
> sense without me.
>
> You will need Node 20 or newer, an MCP server for something you can safely
> break, and an agent that works against it.
>
> ```
> npx rigorrun
> ```
>
> Documentation: <link to docs/GETTING_STARTED.md>
>
> Please keep the worksheet below open while you go, and write down the moment
> you feel stuck rather than after you have solved it. If something goes wrong,
> `npx rigorrun feedback export -o rigorrun-feedback.json` produces a file that
> contains no credentials and no data from your system — send me that.
>
> Take as long as it takes. I am timing the tool, not you.

## The worksheet

Give them this, and ask them to fill it in as they go.

### Getting it running

1. Did `npx rigorrun` work first time? If not, what did it say?
2. How long from typing that to seeing something in a browser?
3. Did anything about the pairing code seem odd or annoying?

### Understanding it

4. Before connecting anything: in your own words, what did you think
   **"Connect your system"** was going to do?
5. Was that what it did?
6. Did any word on any screen mean nothing to you? Write down the word.

### Connecting

7. Could you connect your MCP server without asking anybody anything?
8. Were the tools it found the ones you expected?
9. It asks which tools "only look" and which to "check with". Did you know what
   to tick? Were you confident, or guessing?
10. Did you understand what happens without a way to put your system back?

### Teaching it

11. Could you do the job through RigorRun's screen?
12. Did anything about recording feel risky — did you at any point worry about
    what it might be doing to your system?
13. If you reloaded the page or stopped partway, did you get back to where you
    were?

### What it worked out

14. Did the questions it asked make sense?
15. Was there a question you could not answer? Which?
16. Did you agree with the rules it proposed? How many did you say no to?
17. Did you understand that saying no was safe?

### Running

18. Could you connect your agent?
19. Did it tell you clearly whether your agent was reachable?
20. Did the run do what you expected?
21. Did the verdict make sense? Could you tell **why** it passed or failed?
22. Did you believe the verdict?

### After

23. Would you run this again after changing your agent?
24. Would you put it in CI?
25. If something went wrong in production next month, would you come back and
    add it to this suite? What would stop you?
26. What is the single thing that would most make you not bother?

## What we record, per tester

| | |
| --- | --- |
| Time to first verdict | Wall clock, project created → pass or fail. RigorRun measures this itself and shows it; ask them to send the number. |
| Stuck points | Every moment they paused, in order, with what they were looking at. |
| Assistance | Which steps needed help, and what the help was. |
| Words that meant nothing | Verbatim. |
| Where they stopped | If they did not finish, exactly where and why. |
| Their feedback bundle | `rigorrun feedback export` — machine, versions, stages, error classes, no data. A real one is in [examples/feedback-bundle.json](examples/feedback-bundle.json); show it to them if they hesitate. |

## How to run the session

**Watch, do not narrate.** If you are in the room or on a call, say nothing
except "what are you thinking?" when they go quiet. Every explanation you give
is a piece of documentation you have just proven is missing.

**Write down the timestamp when they hesitate**, not just when they fail.
Hesitation is where the interface is unclear; failure is where it is broken, and
the first is more common and easier to fix.

**Do not defend anything.** The instinct to explain why something is that way is
the instinct that keeps a product unusable. Write it down and move on.

**Ask question 26 last and take it seriously.** "What would most make you not
bother" is the only question that gets at the thing they are too polite to say.

## What counts as a pass

For this milestone, RigorRun is ready to be shown more widely when:

- **at least two of three testers reach a verdict unassisted**, and
- **no tester hits the same P0 stuck point**, and
- **the median time to first verdict is under thirty minutes.**

Thirty rather than ten. Ten minutes is what the machinery takes; a person has
to read, decide, find their server's details and get one thing wrong. Claiming
ten before measuring a human is how a product ends up with an onboarding number
nobody can reproduce.

If a tester stops before a verdict, the milestone has not passed, however good
the reason. The reason is the finding.

## What this does not measure

Whether anybody wants it. Three people successfully using a tool you asked them
to try tells you it works, not that it matters. That question belongs to a
later milestone and to different evidence — people who came back without being
asked.
