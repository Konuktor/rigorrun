# UX audit — RigorRun, production

**Audited:** <https://rigorrun.pages.dev> and <https://rigorrun-crm.pages.dev>
**Method:** Playwright driving real Chromium against the deployed build. Nine
viewports (360×800, 390×844, 430×932, 768×1024, 820×1180, 1024×768, 1280×800,
1440×900, 1920×1080), seven screens each, full-page screenshots, plus scripted
probes for overflow, contrast ratios, tap-target size, typography spread, DOM
semantics, focus behaviour and Core Web Vitals.
**Commit audited:** `0356a48`

## Summary

The product _works_. It does not yet _read_ as a funded infrastructure company.
The engine, the honesty of the statistics and the evidence model are genuinely
strong; the presentation layer is where the gap is.

| Severity | Count | Theme                                                                       |
| -------- | ----- | --------------------------------------------------------------------------- |
| Critical | 6     | Modal accessibility, mobile overflow, unreadable verdict on mobile          |
| High     | 11    | Contrast, typography spread, contract screen legibility, evidence hierarchy |
| Medium   | 9     | Density, tap targets, copy, navigation affordance                           |
| Low      | 5     | Polish                                                                      |

What is already good and must not be lost: zero console errors at every
viewport; LCP 192 ms, CLS 0, TTFB 40 ms; a visible focus ring; the
observed-vs-inferred distinction; the Wilson interval shown next to every
percentage; "cost unavailable" instead of an invented number.

---

# CRITICAL

## C1 — The evidence drawer is not a dialog

**Screen:** Verdict → evidence drawer (the single most important selling screen)

**Problem.** Probed live, the drawer has `role=null`, no `aria-modal`, no
accessible name. Focus does not move into it when it opens (`focusInside:
false`). There is no focus trap. **Escape does not close it.** Body scroll is
not locked (`overflow: visible`). Focus is not returned to the opener on close.

**Why it hurts.** A keyboard or screen-reader user cannot reach the content that
carries the entire product argument, and a mouse user who presses Escape — the
universal reflex — sees nothing happen. Behind the overlay, background content
still scrolls, which reads as broken.

**Fix.** Render as a real dialog: `role="dialog"`, `aria-modal="true"`,
`aria-labelledby` pointing at its title. Move focus to the panel on open, trap
Tab/Shift+Tab inside it, close on Escape, restore focus to the triggering cell,
and lock body scroll while open.

## C2 — Horizontal overflow on the benchmark screen at every phone width

**Screen:** Benchmark

**Problem.** Measured overflow: **110 px at 360×800**, **80 px at 390×844**,
**40 px at 430×932**. The four-column case table is wider than the viewport and
pushes the whole page sideways.

**Why it hurts.** The page rocks horizontally on every scroll. It is the
clearest possible signal that nobody tested the product on a phone — and a
reviewer opening the link on a phone hits it within ten seconds.

**Fix.** Below `sm`, stop rendering the case list as a table. Render each case
as a structured row (name, then category and check count as secondary metadata).
Keep the table for `sm` and up, inside a scroll container that never widens the
page.

## C3 — The verdict is unreadable on mobile

**Screen:** Verdict, ≤430 px

**Problem.** The comparison table clips mid-header — the visible text ends at
`UNSA…`. **Unsafe actions, median, p95, steps, cost and gate are all off-screen**
with no scroll affordance. The case matrix wraps case names to four and five
lines each, so seventeen rows become a very long column of ragged text, and the
Agent B column is cut off.

**Why it hurts.** "Zero unsafe actions versus five" is the punchline of the whole
demo, and on a phone it is invisible. The reviewer sees two similar percentages
and a wall of grey text.

**Fix.** On mobile, replace the comparison table with a stacked pair of agent
cards, each leading with the verdict-relevant numbers. Replace the case matrix
with a compact list keyed by outcome. Reserve the table for ≥`md`.

## C4 — CRM overflows horizontally on phones

**Screen:** Northstar order page

**Problem.** 62 px overflow at 360×800, 32 px at 390×844, caused by the
line-items table.

**Why it hurts.** The demo CRM is the "real application" in the story. If it
looks broken, the premise looks broken.

**Fix.** Wrap the table in an `overflow-x-auto` container with `min-w-0` on its
grid parent, and drop the SKU column below `sm`.

## C5 — The verdict makes you read a table before you know who won

**Screen:** Verdict

**Problem.** The order is: page title → two paragraphs → verdict box containing
four bullet lines of rationale → comparison table → case matrix. The single fact
a person came for — _Agent B wins, and here is the one number that decides it_ —
is delivered as prose inside a bordered box, in the same weight as everything
around it.

**Why it hurts.** §10 of any good product review: the payoff must land in three
seconds. Currently it takes fifteen and a scroll.

**Fix.** Lead with a result banner: winner, then the three deciding numbers at
display size (task success, policy compliance, unsafe actions), with the losing
agent shown alongside for contrast. Demote rationale and the Wilson explanation
to a supporting line beneath. Table follows.

## C6 — The `dim` text token fails WCAG AA everywhere

**Screen:** All

**Problem.** `rgb(107,116,130)` on `#0b0d10` measures **3.91:1** against a
required 4.5:1, and it is used **595 times** across the product. Worse: disabled
step-navigation items combine that token with `opacity: 0.6`, landing at
**1.08:1** — effectively invisible. In the CRM, table headers at
`rgb(148,163,184)` on white measure 2.39–2.56:1, the demo banner 1.18:1, and
status pills 1.08:1.

**Why it hurts.** Metadata, hashes, captions and every explanatory line under a
metric are the parts that make the product feel rigorous, and they are the parts
that are hardest to read. On a laptop in a bright room, most of them disappear.

**Fix.** Re-derive the neutral ramp so the muted step clears 4.5:1 and the
dimmest step clears 4.5:1 for its actual use. Never stack opacity on an already
low-contrast token — express "disabled" through a dedicated token that still
meets 4.5:1, plus a non-colour cue.

---

# HIGH

## H1 — Typography has no scale

**Screen:** All

**Problem.** Between 15 and 18 distinct font-size/weight combinations per
screen, expressed as arbitrary pixel values scattered through the markup:
`text-[10.5px]`, `text-[11px]`, `text-[11.5px]`, `text-[12px]`, `text-[12.5px]`,
`text-[13px]`, `text-[14px]`, `text-[15px]`, `text-[17px]`. Half-pixel steps are
invisible as hierarchy but very visible as inconsistency.

**Why it hurts.** Nothing is confidently the most important thing on any screen,
and the eye cannot learn the system. This is the single largest contributor to
the "capable prototype" feeling.

**Fix.** A named scale of seven steps with fixed line-heights, used semantically
(`display`, `title`, `section`, `body`, `secondary`, `meta`, `mono`). Collapse
11/11.5/12/12.5 into two steps. Remove every arbitrary pixel size from
components.

## H2 — The contract screen is a wall of near-identical blocks

**Screen:** Contract — the strongest product moment in the demo

**Problem.** Twelve rules render as twelve visually similar rows. Observed and
inferred differ only by a small badge colour. The confidence is shown as
`inferred 0.60`, which is developer output, not product. The only action offered
is **Reject** — there is no Confirm and no Edit, so a rule the user agrees with
gets no acknowledgement, and the meaning of "approve" is buried in a button at
the very bottom. Nothing explains what confirming or rejecting will _do_.

**Why it hurts.** This screen carries the wedge: _RigorRun separates what it saw
from what it guessed, and asks._ Presented as an undifferentiated list, the idea
does not land.

**Fix.** Two visually distinct groups with their own framing. Each inferred rule
becomes a card: the rule as a statement, confidence as a percentage with a
meter, the evidence it came from, a one-line consequence (_"Not enforced until
confirmed"_ / _"Enforced — 3 cases depend on it"_), and three explicit actions:
Confirm, Edit, Reject. Confirmed rules move into the confirmed group with a
state change the user can see.

## H3 — Evidence opens with a log, not a verdict

**Screen:** Evidence drawer

**Problem.** The first thing in the drawer is `What the agent did` — a raw tool
timeline. The facts that matter (`refund.amount 500`, `manager_approval null`,
expected `≤ 50 OR approval exists`) sit far below the fold, inside a table.

**Why it hurts.** The drawer is opened to answer one question — _why did this
fail?_ — and it answers with a transcript first.

**Fix.** Lead with a failure header: the policy name, a plain-language statement
of what went wrong, then a two-column Observed / Expected block with the deciding
values at readable size. Timeline, agent claim and full check list follow.

## H4 — Agent claim and reality are not visually confronted

**Screen:** Evidence drawer

**Problem.** _"I refunded $500.00…"_ and the system state that contradicts its
permissibility are two separate panels stacked vertically with equal weight, and
the disclaimer is a grey caption.

**Why it hurts.** _"Don't ask the agent if it succeeded. Check the system it
changed."_ is the product's sharpest line, and the UI does not stage it.

**Fix.** Put the claim and the observed state side by side, with the claim
visibly marked as excluded from scoring.

## H5 — Case matrix cells are 24×24 px

**Screen:** Verdict

**Problem.** The primary interaction on the payoff screen is a 24 px square.
Measured across viewports; 34 of them.

**Why it hurts.** Below every touch-target guideline, and easy to miss with a
mouse. Nothing else signals the row is interactive.

**Fix.** Make the whole cell a ≥40 px hit area with a hover/focus state; add a
per-row affordance so the interaction is discoverable.

## H6 — Status is communicated by colour and glyph density alone

**Screen:** Verdict, benchmark, run log

**Problem.** `✓` / `✕` / `!` differ mainly by colour. `!` (unsafe) and `✕`
(failed) are both red.

**Why it hurts.** A red/green colour-blind reviewer cannot separate pass from
fail, and cannot separate "failed" from "did something dangerous" — which is the
distinction the product exists to draw.

**Fix.** Distinct shapes plus text labels in the accessible name, and separate
unsafe from failed with a different mark and a different tone.

## H7 — Step navigation is disabled-looking and unreadable

**Screen:** All demo steps

**Problem.** Future steps render at 1.08:1 contrast. On mobile the five steps are
a cramped horizontal scroller with no indication that it scrolls. Completed
steps look identical to future ones.

**Fix.** Three explicit visual states — done, current, upcoming — each meeting
contrast requirements, with a completion mark on done. On mobile, show a compact
"Step 3 of 5" with the current label, not a squeezed strip.

## H8 — Run experience skips its own progress

**Screen:** Run

**Problem.** Measured production run → verdict is 2,383 ms, of which roughly 1.9 s
is a fixed 55 ms-per-case display delay. The screen shows a thin progress bar and
a list, with no phase language, and jumps to the verdict on completion.

**Why it hurts.** It is simultaneously _too slow_ (an added delay for its own
sake, which §9 rules out) and _too opaque_ (no sense of what is happening).

**Fix.** Cut pacing to roughly one animation frame per case so the reveal is a
rendering constraint rather than an invented delay, and state the real phases —
seeding, executing, verifying, scoring — driven by actual progress events. State
the true elapsed time when it finishes.

## H9 — No loading, empty, or failure states

**Screen:** All

**Problem.** There is no skeleton or busy state anywhere; a thrown error in the
run leaves a red bar but the step navigation still reads "running"; there is no
network-failure path; navigating to an unknown hash silently shows the landing
page.

**Fix.** A shared busy state on primary actions; an explicit error panel with a
retry that actually retries; a real not-found view.

## H10 — No skip link, and the first tab stop is the logo

**Screen:** All

**Problem.** Keyboard users traverse the header on every page with no way past
it. No `skip to content` link exists.

**Fix.** A visually hidden skip link as the first focusable element, and `id`
targets on the main region.

## H11 — Copy is long where it should be sharp

**Screen:** Contract, benchmark, run

**Problem.** Each step opens with a two-to-three sentence paragraph, which on
mobile is five to seven lines before any content. Landing body copy uses the
failing `dim` token.

**Fix.** One sentence of framing per step, at readable contrast. Move the
reasoning into the place it explains.

---

# MEDIUM

| #   | Screen    | Problem                                                                     | Fix                                                                   |
| --- | --------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| M1  | Verdict   | Publish… and Export report sit above the verdict, competing with the result | Move to a quieter position beside the section, after the result lands |
| M2  | Benchmark | `SCENARIO` column exposes internal ids (`boundary-50`) with no reader value | Replace with the check count and a private-verifier indicator         |
| M3  | Benchmark | 17 rows with no grouping or filtering                                       | Group by category with counts; allow filtering                        |
| M4  | Benchmark | Rows are clickable with no affordance                                       | Add a disclosure indicator and hover state                            |
| M5  | Contract  | Stat cards (5/7/6) are three full-width blocks on mobile                    | Inline as a compact summary strip                                     |
| M6  | All       | Buttons render 26–28 px tall                                                | Minimum 32 px control height, 40 px for primary                       |
| M7  | Verdict   | Hashes shown in full, wrapping across lines                                 | Truncate with a copy action                                           |
| M8  | CRM       | Table headers, banner and status pills all fail contrast                    | Re-derive the light palette against the same rules as dark            |
| M9  | Run       | Button is not disabled during a run; a second click can start another       | Disable while running and guard the handler                           |

# LOW

| #   | Screen   | Problem                                                           | Fix                                       |
| --- | -------- | ----------------------------------------------------------------- | ----------------------------------------- |
| L1  | All      | Footer repeats on every step, adding noise to a working screen    | Show once on landing; compress in the app |
| L2  | Evidence | Correlation id wraps to three lines                               | Truncate with copy                        |
| L3  | Landing  | "Early MVP · runs entirely offline" is ambiguous on a hosted page | "Runs entirely in your browser"           |
| L4  | All      | Panel radii vary between 8, 10 and 12 px                          | One radius scale                          |
| L5  | Run log  | Monospace column widths shift as ids change length                | Fixed-width columns                       |

---

## Performance (production, already good)

| Metric         | Measured     | Budget    | Verdict    |
| -------------- | ------------ | --------- | ---------- |
| LCP            | 192 ms       | ≤ 2500 ms | Pass       |
| CLS            | 0            | ≤ 0.1     | Pass       |
| FCP            | 192 ms       | —         | Pass       |
| TTFB           | 40 ms        | —         | Pass       |
| JS transferred | ~121 KB gzip | —         | Acceptable |

No optimisation work is warranted. The one performance-adjacent defect is the
artificial per-case delay in H8, which is a correctness issue rather than a
speed one.

## What this audit did not cover

Firefox and WebKit were not exercised in this pass — Chromium only. Cross-browser
verification is part of the hardening work that follows, not of this audit.

---

# Resolution

Every issue above was addressed in the hardening pass. Recorded here so the
audit stays a document of what was found _and_ what was done, and so the claims
are checkable against the suites that now enforce them.

| #     | Status | How it was resolved                                                                                                                                                                                                                                                                                                    | Enforced by                                                                          |
| ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| C1    | Fixed  | A single `Dialog` primitive: `role="dialog"`, `aria-modal`, `aria-labelledby`, focus moved in on open and returned to the opener on close, Tab trapped in both directions, Escape closes, body scroll locked                                                                                                           | `prod.spec.ts` "evidence dialog" (4 tests), `a11y.spec.ts`                           |
| C2    | Fixed  | Benchmark cases render as structured rows rather than a table; the expanded detail's grid children get `min-w-0` so code blocks scroll inside themselves                                                                                                                                                               | `expectNoOverflow` through the whole journey at 390/820/1440                         |
| C3    | Fixed  | Verdict leads with a result banner and two agent cards carrying task success, policy compliance and unsafe actions at display size; the table follows                                                                                                                                                                  | `prod.spec.ts` responsive journey, visual regression                                 |
| C4    | Fixed  | Northstar line items scroll inside a labelled region; SKU column hidden below `sm`; header row wraps                                                                                                                                                                                                                   | `demo.spec.ts` "no overflow on a small phone" (360px)                                |
| C5    | Fixed  | Result before table: winner, then the three deciding numbers, then rationale, then the comparison                                                                                                                                                                                                                      | Visual regression baselines                                                          |
| C6    | Fixed  | Palette re-derived against measured contrast. Worst text token is now 5.2:1; the old 3.91:1 and 1.08:1 tokens are gone. Northstar's light palette re-derived the same way                                                                                                                                              | `pnpm contrast` (45 pairs) in the release gate, `pnpm a11y`                          |
| H1    | Fixed  | Seven-step type scale with fixed line heights, applied semantically. Arbitrary pixel sizes removed from components                                                                                                                                                                                                     | Design tokens in `styles.css`, documented in `DESIGN_SYSTEM.md`                      |
| H2    | Fixed  | Observed and inferred are separate panels; each inferred rule is a card with the rule, a confidence meter and percentage, the question RigorRun cannot answer, Confirm / Reject, and a line stating the consequence                                                                                                    | `prod.spec.ts` contract tests, `demo.spec.ts`                                        |
| H3    | Fixed  | Evidence opens with a failure headline, then Observed as a key/value fact list (`refund.amount $500.00`, `manager_approval none`) beside Expected in plain language                                                                                                                                                    | `prod.spec.ts` injection tests                                                       |
| H4    | Fixed  | Agent claim and system state sit side by side, with the claim marked "Not used to decide a verdict"                                                                                                                                                                                                                    | `prod.spec.ts`, `demo.spec.ts`                                                       |
| H5    | Fixed  | Case matrix cells are 40px labelled buttons naming the agent, the case and the outcome                                                                                                                                                                                                                                 | `prod.spec.ts` "no dead controls" asserts every control's height and accessible name |
| H6    | Fixed  | `StatusMark` carries shape and colour; the accessible name spells out "passed" / "failed" / "unsafe action taken"                                                                                                                                                                                                      | `a11y.spec.ts`                                                                       |
| H7    | Fixed  | Three explicit step states with a completion mark; on phones the current step is named with "Step n of 5" instead of one-letter truncations                                                                                                                                                                            | Visual regression at 390px                                                           |
| H8    | Fixed  | Per-case delay cut from 55ms to one animation frame and skipped entirely under reduced motion; the run reports its real elapsed time and states that pacing is for legibility                                                                                                                                          | `useDemo.ts`, stated on the run screen                                               |
| H9    | Fixed  | Skeleton and busy states on hydration, `aria-busy` on primary actions, an alert with a working reset on error                                                                                                                                                                                                          | `prod.spec.ts` routing and run-control tests                                         |
| H10   | Fixed  | Skip link as the first focusable element in both apps, sized as a real target                                                                                                                                                                                                                                          | `prod.spec.ts` "no dead controls"                                                    |
| H11   | Fixed  | One sentence of framing per step at readable contrast                                                                                                                                                                                                                                                                  | —                                                                                    |
| M1–M9 | Fixed  | Actions moved below the result; scenario ids replaced with private-check counts; category filters with counts; disclosure affordance on rows; summary strip instead of stacked cards; 32/36/40px control heights; hashes truncate with the full value on hover; Northstar palette corrected; Run disables during a run | `prod.spec.ts` double-click test, filters test                                       |
| L1–L5 | Fixed  | Footer compressed in-app; identifiers truncate; "runs entirely in your browser"; one radius scale; fixed-width run-log columns                                                                                                                                                                                         | —                                                                                    |

## Not fixed, and why

**WebKit is unverified on this machine.** Playwright's WebKit needs host
libraries (`libicu74`, `libxml2`, `libjpeg-turbo8`) that cannot be installed
without root. The cross-browser config detects this by attempting a real launch
and skips WebKit with a visible warning rather than silently dropping an engine.
Chromium and Firefox pass. CI installs the dependencies and runs all three.
