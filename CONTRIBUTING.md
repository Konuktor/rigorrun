# Contributing

RigorRun is Early Access and built by one person, so the most useful contribution by a distance is
a report that it did not work for you.

## Reporting that it did not work

```bash
rigorrun doctor
rigorrun feedback export
```

`feedback export` writes a sanitised bundle to a file. Read it — it is yours — and attach it to
[an issue](https://github.com/Konuktor/rigorrun/issues). Nothing is uploaded by the command.

Say what system you connected, what your agent does, and what you expected the verdict to be. A
verdict you disagree with is more interesting than a crash.

## Security

Not through issues. See [.github/SECURITY.md](.github/SECURITY.md).

## Documentation

The public documentation is `apps/docs/src/content/docs/`, published at
[docs.rigorrun.xyz](https://docs.rigorrun.xyz). Every page has an "Edit this page" link that lands on
the right file. Corrections are welcome and easy to land — a wrong sentence in the documentation of a
product about not overclaiming is worth more to fix than most bugs.

## Code

Open an issue before a large change. This repository has strong opinions that are not obvious from
the diff — several gates exist because a specific claim turned out to be false, and the comments
explaining why are load-bearing.

```bash
pnpm install
pnpm release:verify     # everything, in order, on this machine
```

Individually: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm a11y`, `pnpm contrast`,
`pnpm domain`, `pnpm verify:package`.

Three rules that are not negotiable, because the product is about not overclaiming:

1. **No user-visible number is a literal.** Counts come from generated JSON checked in CI.
2. **Nothing claims a check that did not run.** `DECLARED` exists because `RESET` once meant
   "configured" rather than "observed".
3. **A limitation is documented, not omitted.** `untested` is a required field on a record for the
   same reason.
