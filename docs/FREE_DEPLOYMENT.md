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
pnpm build:site   # apps/site/dist   — the public website
pnpm build:app    # apps/app/dist    — the interface the runner serves
pnpm build:docs   # apps/docs/dist   — docs.rigorrun.xyz
pnpm build:crm    # apps/demo-crm/dist — Northstar Support, the recorded app
pnpm build:ops    # apps/demo-ops/dist — four schema-driven systems
```

The in-browser demo executes its benchmark in the browser, so a static host is
genuinely enough — there is no server behind it.

Currently deployed:

| | |
| --- | --- |
| Landing, quickstart and the bundled example | <https://rigorrun.xyz> |
| Northstar Support | <https://rigorrun-crm.pages.dev> |
| Four schema-driven systems | <https://rigorrun-ops.pages.dev> |

Deploy them with `pnpm deploy:web`, `pnpm deploy:crm`, `pnpm deploy:ops`, or all
three with `pnpm deploy:all`. Cloudflare Pages Free serves static assets with no
request limit and no card, and none of these three has a server component that
could cost anything.

## Custom domain

`rigorrun.xyz` is the canonical production domain. Cloudflare hosts its DNS —
required, because Pages can only attach an apex domain that is a Cloudflare zone
— while the registrar stays Gen.xyz.

This adds nothing to the bill beyond the registration itself. The zone and
Universal SSL are free-plan features.

Two things this file used to claim, both checked on 10 September 2026 and both
untrue:

- **`rigorrun.pages.dev` does not redirect.** It answers 200 with byte-identical
  content, because both hostnames are attached to the same Pages project. That is
  duplicate content, and what resolves it is the `<link rel="canonical">` in
  `apps/web/index.html` pointing at the apex. A 301 would need a redirect rule
  that does not exist; the canonical tag is what is actually deployed.
- **`www.rigorrun.xyz` does not resolve.** There is no record and no redirect
  rule. Nothing links to it, so nothing is broken, but the rule described here
  was never created.

```console
$ curl -sS -o /dev/null -w '%{http_code} %{num_redirects}\n' -L https://rigorrun.pages.dev
200 0
$ curl -sS -I https://www.rigorrun.xyz
curl: (6) Could not resolve host: www.rigorrun.xyz
```

## Keeping it free

There is one guardrail and it is structural: **nothing here runs on metered
compute.** Static assets on Pages, and a CLI on your own machine.

See [COST_GUARDRAILS.md](COST_GUARDRAILS.md) for every remaining service —
which is now the optional model providers, GitHub Actions, and npm.
