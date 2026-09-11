# RigorRun brand book

The system, and the reasons. Where a rule exists because something specific went wrong, the reason
is written down — a rule whose justification is lost gets broken by the next person with a deadline.

---

## 1. Brand idea

**A record you can re-run.**

The vocabulary is the laboratory notebook and the audit record: measured, itemised,
provenance-stamped, reproducible. Not the terminal, and not the dashboard. RigorRun's strongest
sentence is "19 of 37 tools were exercised — the other 18 are named below with the reason each one
was not", and everything visual exists to make sentences like that look like what they are.

## 2. Personality

Precise. Unhurried. Technical without performing it. Willing to say what it did not check, which
reads as confidence rather than hedging because it is offered rather than extracted.

Not: playful, breathless, sci-fi, apologetic, or corporate.

## 3. The governing colour rule

**Colour is reserved for verdicts.**

The site is ink on off-white with a single accent for interaction. Green, amber and red appear only
where a real verdict, state or status is being shown — never for emphasis, never on a call to
action, never decoratively.

A product whose argument is "do not trust a claim, read the state" should not spend green on a
button. When green means pass everywhere it appears, a green thing on a page is information.

## 4. Typography

| Role | Face | Why |
| --- | --- | --- |
| UI, display, body | **Instrument Sans** (OFL) | Contemporary, slightly condensed, holds up at 64px and at 12px. Not yet on every developer site. |
| Code, evidence, CLI, tabular data | **Geist Mono** (OFL) | Unambiguous `0`/`O` and `1`/`l`, which matters when the thing on screen is a digest. |

Two faces, latin subset, self-hosted, **88 kB for the whole system**. A third face was considered for
pull quotes and rejected: it would have been added because it is fashionable, not because anything
needed it.

**Display weight is 400–500, never 700.** At 64px a bold weight reads as a template shouting; a
regular weight at the same size reads as somebody who does not need to.

**Self-hosted, not from a font CDN.** A request to a third party is a request the visitor did not
ask for, on a site whose argument is that RigorRun does not make requests you did not ask for.

**Zero layout shift, by measurement.** Instrument Sans is 1.47% wider than Arial and Geist Mono
0.34% narrower than the default monospace, measured in Chromium against a representative string.
Those numbers are applied as `size-adjust` on fallback faces with matching ascent and descent
overrides, so the swap moves nothing.

### Scale

Every step has a locked line-height and tracking. No half-pixel sizes.

| Token | Size | Use |
| --- | --- | --- |
| `--text-hero` | clamp 40 → 68 | One `h1` per page |
| `--text-verdict` | clamp 36 → 52 | The answer, on a result |
| `--text-display` | clamp 30 → 44 | Section headings |
| `--text-title` | 22 | Panel and card titles |
| `--text-lead` | 17 | The sentence under a heading |
| `--text-section` | 16 | Site body |
| `--text-body` | 14 | Product body |
| `--text-support` | 13 | Supporting copy, table values |
| `--text-meta` | 12 | Metadata, captions |
| `--text-micro` | 11 | Uppercase eyebrows only |

:::note
`--text-support` was `--text-secondary` and had to be renamed. It collided with `--color-secondary`:
Tailwind generated a `text-secondary` utility for each, and the colour won — so every default-size
primary button rendered `#b4bdcb` on `#e9ecf1`, which is 1.6:1, well under the 4.5:1 this project
gates on. Two components carried `text-secondary text-secondary` as a workaround. Renaming removed
the ambiguity instead of working around it.
:::

## 5. Colour

Two themes, one system. `paper` is the public site; `ink` is the local product. Same scale, same
spacing, same accent, lit from opposite sides.

### paper

| Token | Value | |
| --- | --- | --- |
| canvas | `#F7F6F4` | Warm enough to read as stock; takes the ultramarine without the vibration pure white gives it |
| surface | `#FFFFFF` | |
| raised | `#F1EEE9` | |
| inset | `#12141A` | **Code is always ink, on both themes.** A dark well on paper says "this is the machine talking" without a label |
| fg | `#12141A` | 17.1:1 |
| secondary | `#3A404B` | 9.7:1 |
| muted | `#5A616E` | 5.8:1 |
| accent | `#2A41DE` | 6.7:1 on canvas; white on it is 7.2:1 |
| pass / fail / warn | `#0E6B3D` / `#B3261E` / `#7A5200` | Darkened for a light ground |

### ink

Greys unchanged from the shipped palette — they were measured and they pass. What changed is the
accent: it used to be `#93b4ff`, the same value as the informational tint, so the product had no
accent at all.

| Token | Value | |
| --- | --- | --- |
| canvas / surface / raised | `#0B0D10` / `#101318` / `#161A20` | |
| fg / secondary / muted | `#E9ECF1` / `#B4BDCB` / `#939FAF` | 16.4:1 / 10.3:1 / 7.2:1 |
| accent | `#96A6FF` | 8.5:1 |
| pass / fail / warn | `#4ADE80` / `#FF8080` / `#F0B72F` | |

### The rule that keeps it honest

`scripts/check-contrast.mjs` runs in the release gate and checks **81 token pairs** against their
WCAG requirement. The palette is derived from those numbers rather than chosen by eye, and the script
says so when it fails: *adjust the palette, not the requirement.*

`--rr-disabled` on paper is only slightly lighter than `muted`, deliberately. WCAG exempts an
inactive control from contrast minimums; this gate does not, because a disabled field somebody
cannot read is still a field they have to read to know why it is disabled. On paper, unavailable is
carried by the control's border and fill going flat.

## 6. Spacing, grid, radii

`--spacing-gutter` and `--spacing-section` both existed before this work and had **no consumers** —
every page hardcoded `px-5` at all seven viewports. They are load-bearing now: `.rr-container` is the
only thing that sets a page gutter.

| | |
| --- | --- |
| Gutter | `clamp(20px, 0.6rem + 2.4vw, 40px)` |
| Section rhythm | `clamp(64px, 2rem + 6vw, 120px)`, tight variant `clamp(40px, 1.5rem + 3vw, 64px)` |
| Container | site 1216px · prose 704px · app 1152px |
| Radii | control 8px · panel 12px · well 10px · pill 999px |

Elevation is carried by borders and surface steps. Shadow is for overlays and for the one card that
has to lift off the page.

## 7. Logo

**A double turnstile with unequal arms.**

In logic, `A ⊢ B` means B is *derivable* — it follows from what was written down. `A ⊨ B` means B
*holds in the model* — it is true in the thing itself. An agent's transcript is the first. RigorRun
reads the system and reports the second.

The arms are deliberately unequal: a short numerator over a long denominator, because "19 of 37,
with the remainder itemised" is the other half of the idea.

Three strokes, so it survives 16px. Round caps. Drawn on a 24×24 grid; stem `M5.5 4.25V19.75`, arms
at `y=9` (length 7) and `y=15` (length 13.5), stroke width 3.

| | |
| --- | --- |
| **Minimum size** | 16px for the symbol. The wordmark is not used below 100px wide. |
| **Clearspace** | The height of one arm gap (2 units on the 24 grid) on every side. |
| **Colour** | Accent on paper; `fg` where the accent would compete; white on an accent square for the app icon. Never two colours within the mark. |
| **Never** | Rotated, outlined, gradient-filled, given a drop shadow, or set inside a circle. |

`packages/design/logo/` holds `mark.svg` (currentColor), `mark-square.svg` and `favicon.svg`. Every
raster asset — favicons, apple-touch-icon, manifest icons, the share card — is generated by
`scripts/build-brand.mjs`, so a palette change is one edit and a re-run.

:::note
The mark this replaces was the letters "RR" in the system monospace font inside a 1.5px rounded
square, maintained in two independent places — an inline data URI in `index.html` and a CSS border in
`primitives.tsx`. They had already drifted apart: `#e7eaee` against a token of `#e9ecf1`.
:::

## 8. Share cards

1200×630, typography only. No stock gradient, no fake dashboard, no screenshot of a UI that does not
exist. The card carries the mark, the headline, the install command and the category line, on paper,
with a 10px accent rule along the bottom edge.

Before this there was no `og:image` at all and `twitter:card` was `summary`, so every link anybody
posted rendered as bare text.

## 9. Motion

Everything is decoration: every element it touches is already in its final position and readable
without it. That is the test for whether an animation may exist — if removing it loses information,
it was carrying information it should not have been.

| | |
| --- | --- |
| Durations | 120ms fast · 180ms base · 260ms slow · 480ms reveal |
| Easing | `cubic-bezier(0.22, 0.7, 0.3, 1)` |
| Reduced motion | Animations off, transitions clamped to 1ms, reveals shown |

**Scroll reveal never hides anything it might not un-hide.** Nothing above the fold is touched, and a
2.5s timer reveals everything regardless of whether the observer fired. Content that needs JavaScript
to appear is content that can disappear — the first version of this hid every marked element the
moment the class landed, and anything the observer did not reach stayed invisible.

## 10. Product UI rules

The product is calmer and denser than the site. It is a working surface somebody has open for an
afternoon, not a page a stranger reads once. Body is 14px there and 16px on the site — same tokens,
different default.

- **The verdict is the largest thing on a result.** It used to be 22px in a row of tags, which made
  the single most important word in the product smaller than the project title above it.
- **Verification strength and isolation are never shown without the verdict, and the verdict is
  never shown without them.** `CONDITIONAL` is not a softer `PASS`; `PARTIAL` is not a footnote on
  `YES`.
- **`DECLARED` is not styled as a warning.** A warning reads as "probably fine, look when you can".
  A claim the system under test made about itself, which nothing has checked, is the thing the rest
  of the product exists to go and test.
- **No confetti, no celebration.** This is reliability infrastructure. A pass is information, not a
  reward.
- **A step tells you its own state.** Done, current, or not yet reachable — the six steps used to
  render as identical pills, so the current one looked like a selected tab.

## 11. Marketing UI rules

- Every section has a reason to exist and a different shape from its neighbours. No page is a
  column of identical bordered cards.
- Section headings are claims with evidence, not category labels. "Four servers we did not write"
  over "Our Results".
- Proof sits next to the claim it supports, in the same viewport.
- Limitations get the same type size as capabilities. Honesty in 11px grey is not honesty.
- One `h1` per page. Eyebrows are `<p>`, never `<h2>` — `SectionLabel` used to render an `h2` at 11px
  uppercase, which produced dozens per page on the evidence table.

## 12. Accessibility

WCAG 2.2 AA, gated rather than intended.

- Every text token clears AA on every surface it may sit on, checked by script in the release gate.
- Focus is a 2px accent outline at 2px offset, visible for keyboard users and suppressed for
  pointer users.
- Status is carried by glyph and text as well as colour.
- Touch targets are at least 40px; the release gate measures controls, and one was found at 17px.
- Anything that scrolls sideways does so inside its own box. The page never scrolls sideways, at any
  of seven viewports, on any route.
- A skip link, real landmarks, and `aria-current` on the current step and page.

## 13. Do and do not

| Do | Do not |
| --- | --- |
| State the denominator | Round a coverage figure up to a claim |
| Put the caveat in the headline | Put the caveat in 11px grey under the fold |
| Use green when something passed | Use green because a button needs to stand out |
| Let a long display line wrap on purpose | Set display type at weight 700 |
| Show the real product | Mock a dashboard that does not exist |
| Name what was not checked | Omit it because the page reads better |
