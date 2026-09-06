# Deploying for $0

RigorRun has **no hosted component**. There is nothing to deploy in order to use
it, no account to create, and no service that can send you a bill.

This page exists because there used to be more here, and because the static
demo sites are worth documenting.

## First: you almost certainly do not need this

The product runs on your machine:

```bash
npx rigorrun
```

That is the whole installation. It serves its own interface on `127.0.0.1`,
stores everything under `~/.rigorrun`, and talks to nothing on the internet
except the systems and agents you point it at. A page served over `https`
cannot reach `http://127.0.0.1`, which is the reason the product is local
rather than hosted — not a limitation being worked around.

## What was here before

A Cloudflare Worker plus a D1 database, described as an "optional control
plane". It was deployed, it was tested, and **nothing in the product ever
called it.** It was code, not a capability.

It was deleted rather than kept as an option, because a documented capability
that nothing uses is the same defect RigorRun exists to find in other people's
systems. It remains in git history if it is ever wanted.

There is no cloud sync, no shared history, no hosted runs, and no account
system. If those arrive, they will arrive as something somebody asked for.

## Static hosting for the demo sites

The landing page and the two demo apps build to static files and can go on any
free static host — Cloudflare Pages, GitHub Pages, Netlify:

```bash
pnpm build:web    # apps/web/dist    — landing page and the in-browser demo
pnpm build:crm    # apps/demo-crm/dist — Northstar Support, the recorded app
pnpm build:ops    # apps/demo-ops/dist — four schema-driven systems
```

The in-browser demo executes its benchmark in the browser, so a static host is
genuinely enough — there is no server behind it.

Currently deployed:

| | |
| --- | --- |
| Landing, quickstart and the bundled example | <https://rigorrun.pages.dev> |
| Northstar Support | <https://rigorrun-crm.pages.dev> |
| Four schema-driven systems | <https://rigorrun-ops.pages.dev> |

Deploy them with `pnpm deploy:web`, `pnpm deploy:crm`, `pnpm deploy:ops`, or all
three with `pnpm deploy:all`. Cloudflare Pages Free serves static assets with no
request limit and no card, and none of these three has a server component that
could cost anything.

## Custom domain

Not required and not configured. `pages.dev` is free and sufficient; nothing in
this repository assumes a domain, and none is purchased.

## Keeping it free

There is one guardrail and it is structural: **nothing here runs on metered
compute.** Static assets on Pages, and a CLI on your own machine.

See [COST_GUARDRAILS.md](COST_GUARDRAILS.md) for every remaining service —
which is now the optional model providers, GitHub Actions, and npm.
