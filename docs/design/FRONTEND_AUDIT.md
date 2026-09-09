# Frontend audit

Taken against production `rigorrun.xyz` and the shipped `rigorrun@0.2.0` interface, before anything
was changed. Screenshots at 1440, 1280, 1024, 768 and 390.

The headline finding is architectural, not cosmetic: **the marketing site and the product interface
were the same build.**

---

## 1. One bundle, two products

`packages/cli/build.mjs` copied `apps/web/dist` into `packages/cli/ui/` and shipped it inside the npm
tarball. `apps/web/src/App.tsx` probed `GET /api/runner` on boot and, if a local runner answered,
silently swapped the landing page for the product.

Consequences, all of them real:

- Every visitor to rigorrun.xyz downloaded the entire product UI — a 306 kB main chunk containing
  `stages.tsx` (1362 lines) and `run.tsx` (996) — in order to read a landing page they could reach
  none of it from.
- Every person running `npx rigorrun` downloaded the landing page, the marketing copy and the
  evidence page, none of which the runner has a use for.
- **First paint of both was gated on a network request.** `runner === null` rendered a full-viewport
  spinner, and the footer was deliberately withheld until the probe resolved to avoid a 0.17 CLS —
  a workaround for a problem that only existed because of the fork.

Neither surface could be designed properly while this held.

## 2. There was one indexable URL

Routing was a hand-rolled hash router. `#/evidence`, `#/quickstart` and `#/demo` were fragments, so
`https://rigorrun.xyz/` was the only address that existed.

- `<title>` was set client-side in a `useEffect`, so every route served the same title to a crawler.
- There was no per-route `<meta name="description">` at all.
- No sitemap was possible, and none existed.
- The SPA fallback returned `index.html` with **200** for every path, so `/og.png`, `/security` and
  every misspelling looked like a real page to a crawler.
- The evidence page — the strongest asset the product has — could not be linked, indexed or shared
  with its own card.

## 3. No brand assets existed

Not "the brand assets need work". There were none.

- No logo file. The mark was an inline data-URI `<svg>` in `index.html` reading "RR" in the system
  monospace font, plus an independent re-creation as a CSS border in `primitives.tsx`. The two had
  already drifted: `#e7eaee` against a token of `#e9ecf1`.
- No favicon file, no apple-touch-icon, no manifest.
- **No `og:image`**, and `twitter:card` was `summary`, so every shared link rendered as bare text.
- No webfont. `--font-sans` was a system stack, so the wordmark rendered in a different typeface on
  every operating system.

## 4. Typography and hierarchy

- Body was 14px on a marketing page. Almost everything on the homepage was 13–16px, so the only
  hierarchy was `h1` versus the rest.
- `SectionLabel` rendered an `<h2>` at 11px uppercase. On the homepage that produced `h1` → `h2`
  (the eyebrow) → `h2` (the real title); on the evidence page it produced dozens of `<h2>` elements,
  one per table cell label.
- `--text-secondary` (13px) collided with `--color-secondary`. Tailwind generated a `text-secondary`
  utility for each and the colour won, so every default-size primary button rendered 1.6:1 —
  documented in `primitives.tsx` and worked around with `text-[length:var(...)]`, with two components
  carrying `text-secondary text-secondary`.

## 5. Layout and rhythm

- The homepage was **2574px tall at 1440** across 9 sections. Every section was the same dark
  bordered card; the page read as a column of rectangles.
- `--spacing-gutter` and `--spacing-section` were defined and had **no consumers**. Every page
  hardcoded `px-5` at all seven viewports.
- The hero's JSON panel clipped mid-string — `"Refund-EX…`, `"APR-900:` — which reads as broken
  rather than as styled.
- The 5-step pipeline was `sm:grid-cols-2 lg:grid-cols-5`, so at tablet width it wrapped 2 + 2 + 1.

## 6. Product clarity

- **The `rigorrun verify` feature occupied homepage slot two**, directly under the hero. That is the
  most valuable position on the page, and it was spent repositioning a product about agent
  acceptance testing as an MCP registry linter.
- "How it works" — the main explanation of the product — was driven entirely by the **synthetic**
  CRM, and said so honestly. Real third-party evidence was one hash-route away and unlinked from
  anywhere a crawler could follow.
- **There was no screenshot of the product anywhere on the site.** A visitor could not see what they
  were being asked to install.
- Verification strength — `AUTHORITATIVE` / `PARTIAL` / `OBSERVATIONAL`, one of the product's most
  credible differentiators — was buried inside a card in the middle of the page.

## 7. Trust and conversion

- Nav had three links: Evidence, Docs, GitHub. No product, no how-it-works, no security, no company,
  no pricing.
- **"Docs" pointed at a GitHub tree of raw markdown**, and the footer linked
  `docs/V1_GAP_AUDIT.md` — an internal audit document — from the public site.
- There was no company page, no named person, no contact address, and no legal pages. An investor or
  an accelerator reviewer landing here could not find out who built it.
- The footer was a single line of text.
- "Get started" appeared three times; "synthetic" or "invented" appeared six times on one page.

## 8. Responsive

No horizontal scroll at any viewport — this was already right and stayed right.

- The nav dropped "Docs" below 640px. That is not responsive design; it is deciding a phone visitor
  does not need documentation.
- "Get started" wrapped to two lines at 390px.
- There was no mobile menu of any kind.

## 9. Accessibility

Unusually well tended, and the parts that were right were kept:

- Skip link sized as a real 40px target in both states.
- `:focus-visible` ring for keyboard users, suppressed for pointer users.
- Scrollable `<pre>` blocks given `tabIndex={0}` and a label so keyboard users can scroll them.
- Status carried by glyph as well as colour.
- axe with `wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa` enforced in CI, and a per-route CLS budget of 0.1.

Real problems underneath that:

- Heading hierarchy broken by design, as above.
- Body copy navigated with `<button>` elements styled as links — not crawlable, no `href`, no
  middle-click. The nav had already been fixed for this; the body had not.
- No light theme existed; `color-scheme: dark` was hardcoded.

## 10. The product interface

- **The verdict was 22px**, inside a row of tags — smaller than the project title above it. It is the
  single most important word the product produces.
- The six-step flow rendered as identical rounded pills, so the current step looked like a selected
  tab and nothing showed how far through you were or what was done.
- "How does RigorRun talk to it?" was a `<select>` with three options reading
  "MCP — a server that publishes tools". That asks a first-time user to place their own system in a
  taxonomy they have not learned, on the first screen, before anything has paid off.
- The `OBSERVATIONAL` warning panel — well written — appeared before the user understood the value.
- The marketing footer ("Early Access · What is and is not built · Docs · GitHub") rendered inside
  the product.
- Full-page screenshots in `docs/external-user-run/` had the sticky header sitting across the four
  score metrics, which is the row somebody opens the screenshot to read.

---

## What was already right, and was kept

The writing. It is better than the design was, and most of it survived the redesign unchanged.

- "Not used to decide a verdict." on the agent's own claim.
- "Four servers we did not write." · "19 of 37 tools were exercised — 51%."
- "A fabricated 100% would be worth less than a measured 51% with the remainder itemised."
- "No market validation. Our own scan is not a user."
- "What the harness itself cannot do", carried on every record rather than collected in a footer.
- The verdict leading with `CONDITIONAL` rather than a green `PASS`, deliberately, with the reason
  written in the file.
- The provenance line under the evidence: script, commit, date, versions, duration, "re-run it and
  compare".

Also kept: the semantic token system with measured contrast ratios, the contrast gate, the CLS
budget, the axe gate, the skip link and focus handling, and the six-step model derived from project
state rather than tracked separately.

The problem was never the thinking. It was that the thinking had no visual system worthy of it.
