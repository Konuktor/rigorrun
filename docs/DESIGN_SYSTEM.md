# Design system

The tokens in `apps/web/src/styles.css` are the single source of truth for the
product surface. Components ask for meaning (`text-muted`, `border-line`,
`bg-surface`); they never name a colour.

## Why these values

The palette is **derived from contrast measurements, not chosen by eye.**
`scripts/check-contrast.mjs` verifies every text token against every surface it
is permitted to sit on, and it runs in the release gate — so a token that drifts
below its requirement fails the build.

The audit that preceded this system found the previous "dim" grey at **3.91:1**
used 595 times, and disabled navigation at **1.08:1**. Nothing in the current
system is allowed near those numbers.

| Token       | Value     | Worst measured contrast | Use                           |
| ----------- | --------- | ----------------------- | ----------------------------- |
| `fg`        | `#e9ecf1` | 13.8:1                  | Primary text                  |
| `secondary` | `#b4bdcb` | 8.6:1                   | Supporting copy, table values |
| `muted`     | `#939faf` | 6.1:1                   | Metadata, captions, labels    |
| `disabled`  | `#8792a2` | 5.2:1                   | Unavailable controls          |

There is no lower step. Anything dimmer than `disabled` would fail AA, so it
does not exist — a decorative grey that text can reach is a bug waiting to
happen.

## Surfaces

Elevation is carried by a surface step plus a border, not by shadow. Shadow is
reserved for things that genuinely float above the page.

```
canvas   #0b0d10   the page
surface  #101318   panels
raised   #161a20   panel headers, inset blocks, hover
overlay  #1b2027   dialogs, popovers
inset    #090b0e   code and evidence wells
```

Borders: `line` for the default edge, `line-strong` for emphasis and hover,
`line-soft` for row separators inside a panel.

## Status

Status is never carried by colour alone. Every state has a tone, a shape and a
text label — `StatusMark` renders `✓`, `✕` and `!` with distinct treatments, and
the accessible name spells out "passed", "failed" or "unsafe action taken".

`pass` `fail` `warn` `info`, each with a matching `-bg` tint and `-line` border
so a badge, a banner and a panel can share one semantic without repeating hex
values.

## Typography

Seven steps, each with a fixed line height. The audit found 15–18 distinct
size/weight combinations per screen, expressed as arbitrary pixel values
including half-pixel steps that read as inconsistency rather than hierarchy.

| Step                   | Size      | Use                           |
| ---------------------- | --------- | ----------------------------- |
| `display`              | 44px      | Landing hero only             |
| `title`                | 22px      | Page title                    |
| `section`              | 16px      | Section and card titles       |
| `body`                 | 14px      | Body copy                     |
| `secondary`            | 13px      | Supporting copy, table values |
| `meta`                 | 12px      | Metadata, captions            |
| `micro`                | 11px      | Uppercase eyebrow labels only |
| `metric` / `metric-sm` | 32 / 20px | Numbers that carry a verdict  |

Numbers use `font-variant-numeric: tabular-nums` wherever they are compared, so
`76.5%` and `100%` align on the decimal down a column.

## Spacing, radius, motion

- Radius: `control` (8px) for buttons and inputs, `panel` (12px) for cards,
  `pill` for badges. Three values, no others.
- Control heights: 32px small, 36px default, 40px large. Nothing smaller is a
  usable target.
- Motion: `fast` 120ms, `base` 180ms, `slow` 260ms, one easing curve. Used for
  state transitions and dialog entrance, never for decoration, and fully
  disabled under `prefers-reduced-motion`.
- Z-index is named — `sticky`, `scrim`, `dialog` — so stacking is decided once.

## Northstar

The demo CRM is deliberately a different product: light, plain, corporate. The
contrast between the instrument and the system under observation is part of the
demo. Its palette is held to the same contrast rules and is checked by the same
script; `ink-faint` was darkened from `#94a3b8` (2.4:1, carrying every table
header) to `#5a6880`, and status pills moved from Tailwind's 700-weight text on
50-weight backgrounds (1.08:1) to 800/900 weights.

## Verifying

```bash
pnpm contrast   # every token pair against its requirement
pnpm a11y       # axe-core WCAG A/AA over every screen, desktop and mobile
pnpm visual     # golden screenshots, desktop and mobile
```
