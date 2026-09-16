# COVERAGE — Capital.com 1-minute history, as pulled

Produced by `prep_data.py`. Source: `ts_harness/pull_1m.ts` (bot's `CapitalComSession`, request identical to `CapitalComClient.realRequest`). Earliest 1-minute bar the API serves was bisected by `ts_harness/probe_bisect.ts`: **2024-01-01 for all four instruments** (requests before that return `error.prices.not-found`).

| symbol | bars | first bar (UTC) | last bar (UTC) | dup ts | non-monotone | zero-volume bars | label − UTC offsets seen (h) |
|---|---|---|---|---|---|---|---|
| US100 | 971,812 | 2024-01-01 23:01 | 2026-09-11 20:59 | 0 | 0 | 0 | +2: 386,673, +3: 585,139 |
| US500 | 954,943 | 2024-01-01 23:01 | 2026-09-11 20:59 | 0 | 0 | 0 | +2: 379,626, +3: 575,317 |

## Per-instrument coverage of the bars the strategy reads

### US100

- UTC weekdays in span: **705**; weekdays with **no bar at all** in the entry window (holiday / closed): **8**; with a *partial* entry window: **14** (missing entry-window minutes on those days: median 2, max 19).
- Missing minutes inside the alive window, all weekdays with data: 965 of 202,827.
- Bars in the 12h window ending at the first entry bar (721 = complete): median 721, 5th pct 721, min 0.
- No-data weekdays: 2024-01-01, 2024-03-29, 2024-12-25, 2025-01-01, 2025-04-18, 2025-12-25, 2026-01-01, 2026-04-03

### US500

- UTC weekdays in span: **705**; weekdays with **no bar at all** in the entry window (holiday / closed): **8**; with a *partial* entry window: **21** (missing entry-window minutes on those days: median 2, max 98).
- Missing minutes inside the alive window, all weekdays with data: 2,211 of 202,827.
- Bars in the 12h window ending at the first entry bar (721 = complete): median 719, 5th pct 657, min 0.
- No-data weekdays: 2024-01-01, 2024-03-29, 2024-12-25, 2025-01-01, 2025-04-18, 2025-12-25, 2026-01-01, 2026-04-03

