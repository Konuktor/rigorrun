---
title: Connect a web application
description: RigorRun can drive a browser and watch what your agent does. It cannot use the page to check its own work, and every verdict says so.
---

RigorRun drives a real browser to the page a person would open first, and watches your agent work.

:::caution[A browser cannot check its own work]
A page saying "done" is a claim by the same system that would have to be wrong for it not to be
done. So a browser connection has a state-read capability of `none`, every verdict from one says
`OBSERVATIONAL`, and the type refuses to let a browser be its own verifier.

That is the honest ceiling, not a gap to close.
:::

## Making it stronger

Attach an MCP server or an OpenAPI document for the *same* system. Then the clicking is watched in
the page while the verdict comes from records, and the run is `PARTIAL` rather than
`OBSERVATIONAL`. Most systems that look API-less have something that can be read.

## Playwright is not bundled

`playwright-core` is roughly 300 MB once its browsers are installed, and most projects never need
one, so it is not a dependency. A tool people try with `npx` in ten minutes cannot open with that
download.

```bash
npm i -D playwright-core && npx playwright install chromium
```

Missing, it produces a sentence rather than a module-not-found.

## It stays on the site you named

A page can link anywhere, and following one off-site would mean driving a browser to an address you
never named. RigorRun does not leave the origin you gave it.

## Recordings are not contracts

`rigorrun record` writes a record of what happened in a page. `rigorrun compile` cannot read it:
compiling needs the state your system held before and after the job, and a browser recording of an
uninstrumented application does not carry that.
