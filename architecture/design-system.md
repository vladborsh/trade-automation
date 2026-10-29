# Design system — chart-client and insight-dashboard

Status: tokens shipped 2026-10-24 (`apps/chart-client/src/design-tokens.css`), components not yet migrated.

## Why

Both SPAs share one dark-terminal look, but it existed only as copied hex values: about 630
hard-coded colours across 52 stylesheets and a handful of `.ts` renderers, seven font sizes,
seven radii, and near-duplicates (`#161b22` vs `#11161d`, `#58a6ff` vs `#2f81f7` vs `#2196f3`).
The token file names what is already there. It does **not** change a single rendered value.

## Layers

```
primitive   --gray-950, --teal-500, --space-8, --radius   raw values; never referenced by a component
semantic    --color-bg, --color-up, --color-focus           what a value means; components use these
component   --button-border, --panel-padding                per-widget knobs built on semantic tokens
```

One file, imported by both global stylesheets (`src/styles.css`,
`projects/insight-dashboard/src/styles.css`). Component `.scss` files read the variables; CSS
custom properties pierce Angular's view encapsulation, so no per-component import is needed.

## Colour

| Semantic token | Value | Use |
|---|---|---|
| `--color-bg` | `#0d1117` | page, inputs, buttons |
| `--color-bg-raised` | `#161b22` | panels, toasts, popovers, chart grid |
| `--color-bg-overlay` | `#21262d` | hover row, selected chip, table row rule |
| `--color-border` | `#30363d` | every 1 px border |
| `--color-border-strong` | `#8b949e` | active / selected outline |
| `--color-text` | `#c9d1d9` | body text |
| `--color-text-muted` | `#8b949e` | labels, captions, secondary columns |
| `--color-text-faint` | `#6e7681` | disabled, placeholders |
| `--color-up` / `--color-down` | `#26a69a` / `#ef5350` | price direction, P&L sign — **only** |
| `--color-accent` | `#26a69a` | links, primary action |
| `--color-focus` / `--color-info` | `#58a6ff` | focus ring, selected view, info toast |
| `--color-warning` | `#d29922` | warnings; also series 1 |
| `--color-danger` | `#ef5350` | errors, destructive confirm |
| `--color-success` | `#3fb950` | health "ok", greed band |
| `--color-series-1…5` | amber, blue, purple, teal, red | indicator outputs (`panel-indicators.ts` order) |
| `--color-metric-up/down` | `#58a6ff` / `#f0883e` | non-price metric series |

**Rule: up/down colours mean money direction.** A metric that is not price (funding, OI,
liquidation volume) uses `--color-metric-*`, never `--color-up/down`, so a reader never mistakes
"more open interest" for "price rose". This is why `metric-series-style.ts` already uses blue/orange.

`--color-accent` and `--color-up` share a value today. They are separate tokens because they mean
different things: changing the link colour must not repaint every winning trade.

## Type, spacing, radius

| Scale | Tokens |
|---|---|
| Font | `--font-mono` everywhere; sizes `2xs` 10, `xs` 11, `sm` 12, `base` 13, `figure` 15, `md` 14, `lg` 16, `xl` 18, `2xl` 24 px |
| Numbers | always `font-variant-numeric: tabular-nums` in tables and figures |
| Spacing | 2 px grid: `--space-2 … --space-32`; the measured favourites are 4, 6, 8, 12, 16 |
| Radius | `--radius` 4 px is the default (35 of 58 uses); `-sm` 3, `-md` 6 for panels, `-lg` 8, `-full` for dots |
| Page gutter | `--page-gutter` = `clamp(16px, 3vw, 40px)` (T-038) |

Pixels, not rem: this is a dense terminal at 12–13 px and every existing value is in px.

## Component specs

**Button** (toggle / secondary — the only button style in use)

| Property | Default | Hover | Active / selected | Disabled |
|---|---|---|---|---|
| Background | `--button-bg` | same | same | same |
| Text | `--color-text-muted` | `--color-text` | `--color-text` | `--color-text-faint` |
| Border | `--color-border` | same | `--color-border-strong` | `--color-border` |
| Focus | `outline: var(--focus-ring)` on `:focus-visible` | | | |

**Input** — `--input-*`; border turns `--color-focus` on focus. **Panel** — raised background,
`--radius-md`, padding 12/14. **Figure tile** (stats headline) — 1 px border, 11 px muted label
over 15 px tabular value. **Badge** — 11 px, 2/6 padding, `--radius-sm`; the research badge is the
warning variant (`--color-warning-bg` / `--color-warning-text`). **Toast** — raised background,
3 px left border in `--toast-accent` (info) or `--color-danger`.

## Loading

One component, `insight-dashboard/src/app/ui/loader.component.ts` (`<app-loader>`), four variants.
Pick by what the reader is looking at while they wait:

| Variant | When | Example |
|---|---|---|
| `skeleton` | The layout is known and nothing is shown yet | Market cards and caps table on first load; the "now" tiles while a coin loads |
| `block` | A region whose shape is not known yet | Liquidations block; the coin list before the top 20 arrive |
| `overlay` | Content is being **replaced** | The chart while a timeframe switch loads: the old chart stays readable underneath |
| `inline` | A small part of a line or header is refreshing | Market "refresh"; the dropdown's figures; earlier history under the chart |

Rules:

- **Only the first load gets a skeleton or block.** A refresh or a poll over content already on
  screen uses `inline` or `overlay` and never blanks the content. Blanking makes the page jump.
- **Every loader appears after 150 ms** (CSS `animation-delay`, no timer), so a fast answer never
  flashes one.
- **The label says what is loading** («Загружаю график…»), and it is the `role="status"` accessible
  name. A bare spinner says nothing to a screen reader.
- **Reduced motion:** no spin and no shimmer under `prefers-reduced-motion`; the shapes stay.
- Colours are tokens only: ring `--color-border` with a `--color-focus` arc, skeleton
  `--color-bg-overlay` → `--color-border`.

## Canvas renderers

lightweight-charts and the overlay renderers take colour strings in TypeScript, not CSS. They
cannot read a custom property for free. Migration for them: one `chart-theme.ts` constant map
whose values mirror the semantic tokens, with a spec that reads `design-tokens.css` and fails if
the two disagree. Until then the hex values in `chart-options.ts`, `metric-series-style.ts`,
`panel-indicators.ts`, `market.adapter.ts` and the overlay renderers stay as they are.

## Migration

1. Done: token file, both global stylesheets consume it, dashboard's six short aliases
   (`--bg`, `--muted`, …) kept as legacy aliases so its 29 existing `var()` uses still work.
2. Per feature folder, replace hex with semantic tokens. A pure relocation (AGENTS.md rule 6):
   no rendered value changes in the same commit. Two decisions are **not** mechanical and need
   their own commit: fold `#11161d` and `#1f2a3a` (calendar-week only) into `--color-bg-raised` /
   `--color-bg-overlay`, and fold `#2196f3` (marker default) into `--color-info`.
3. Canvas theme map with its parity spec (above).
4. Then add a stylelint `color-no-hex` rule scoped to `*.component.scss`, so the drift cannot
   come back by habit.
