# Market, round 2: real charts, KPI history, `/liquidations`, heat-table help (2026-11-05)

**Author:** Architect (insight-bot stream). **Inputs:**
- `reports/coordinator-market-feedback-2-2026-11-05.md`, the owner walking the live Market tab;
- `reports/tl-architect-market-feedback-2.md`.

**Mockup** (committed): `architecture/mockups/market-2-2026-11-05/`
- `mockup-desktop.png` and `mockup-phone.png`;
- `mockup.html`, the **source of every help text quoted below**; copy it from there, don't reword.

**Builds on:** `market-page-design-2026-11-03.md` (D1–D26, §7: the R1–R10 wording, D20 "no forecasts", the KPI `note`) and `oi-divergence-design-2026-11-04.md` (V16, R11).

**Cluster** `ib-market-2`. The dead «К позициям ↓» link is IB-BUG-035 (TL, in progress) and not repeated here.

**Every task:** acceptance is a visual side-by-side with the mockup at **1240 px and 390 px**, screenshots in the report, and no horizontal scroll at 390.

**Box constraint:**
- the IB-096 heap cap (128 MB) stands;
- no DB growth;
- every new venue read below names its weight.

## 1. Item 3: the Fear & Greed KPI tile goes (IB-117)

- `WEB_KPI_IDS` loses `fear_greed`. The contract's "always all tiles" length check follows the array, so the response holds **five** tiles.
- `KpisService` stops building the tile and its `kpi.note.fng_history` note.
- `MarketCardsService.fng` stays: the gauge panel reads it, and **the gauge is unchanged**.
- The client drops the tile, its bar case and its i18n keys. The strip lays five tiles out without a gap at 1240 and 390.
- Specs:
  - the contract refuses a sixth tile and refuses `fear_greed`;
  - the gauge still renders.
- No design question; small.

## 2. Item 2: KPI tiles get a 7-day chart (IB-118)

**What changes.** The 6 px bar on **market cap, BTC OI and BTC funding** is empty today (`kpi-tile.ts` `bar()` returns `[]` for them). It is replaced by a mini chart with «7д мин {min} / макс {max}» under it. Dominance and liquidations keep their bars: those carry a share and are not empty.

**Contract.** `WebKpiTile.history`, nullable:
- `kind`: `'area'` (cap, OI) or `'bars'` (funding);
- `points`: `[{time, value}]`;
- `from` and `to`: the span actually covered;
- `min` and `max`.

Null is honest: "no series in hand".

**Funding chart.** Bars around zero, one per settlement:
- amber above zero means longs pay; blue below means shorts pay;
- the newest bar is highlighted;
- under it: «последние 21 выплата».

**Cap and OI chart.** An area line:
- dots at the min and max;
- the newest point marked;
- red when the 7-day change is down, green when up.

| Tile | Source | Venue cost | Memory |
|---|---|---|---|
| BTC OI | `OiLsService.openInterest(btc, now − 7 d, now)`: the IB-080 path, period 1 h, 168 points, USD (`sumOpenInterestValue`, the tile's own unit) | `/futures/data`, **weight 0**; its own 300 s cache, so ≤ 1 request per 5 min of the endpoint's 1 000 | 168 points |
| BTC funding | The **positioning baseline's** 30-day settled funding for BTC (`PositioningService`, refreshed hourly, Binance `/fapi/v1/fundingRate`); the last 21 settlements. **Not "our tape": funding is not stored (storage ruling S1).** The baseline must keep each settlement's **time** next to its rate (today `fundingSettled: number[]`). | **0 new calls** (the baseline is already paid for) | + one timestamp per settlement: 30 coins × 90 × 8 B ≈ 22 KB |
| Market cap | **There is no keyless 7-day history.** CoinGecko's `/global/market_cap_chart` is paid (`env.schema.ts`; context ruling). `market_chart` is per coin, and a sum of coins is a different number, so it is not used. **Decision: an in-memory ring.** A 10-minute sampler reads `MarketCardsService.global()` (its 120 s cache, so 0 extra calls while anyone is on the page) and appends `total_market_cap.usd` to a ring of 1 008 slots (7 days). | CoinGecko ≤ 0.1 call/min when nobody is viewing, 0 otherwise | 1 008 × 16 B ≈ 16 KB |

**The ring is lost on every restart.** With several deploys a day it will seldom hold 7 days. The tile says so, never pads:
- under 6 h collected: no chart, «копим историю: {h} ч»;
- otherwise: the chart over what is held, with the span named («за {d} д {h} ч»), and min/max over that span.

**Owner's call, flagged, not in the task:** keeping one row per 10 min in Postgres (≈ 1 000 rows a week, ≈ 3 MB a year) would give a full 7 days across deploys. It fits the storage rule's own test ("the box stores what the venue forgets"; keyless CoinGecko forgets this). The brief said "no DB growth", so the ring is the default.

**Total for item 2:**
- Binance `fapi` weight +0; `/futures/data` ≤ 1 per 5 min; CoinGecko ≤ 0.1/min;
- memory ≈ 40 KB;
- `KpisService` keeps its 60 s cache, and the tiles' history rides in the same response.

## 3. Item 1: insight cards with a real chart (IB-119)

**Layout.** Two columns: text on the left, the chart on the right (about 55 / 45 at 1240). Under 720 px it stacks, chart under the text, as in the mockup.

**Every chart has:**
- a y axis with 3–5 ticks in the series' unit;
- a reference line (0, 1.0 or 50 %, per rule);
- the time span named on the x axis («30д … 15д … сейчас», «−24ч … −12ч … сейчас»);
- the **current value marked and printed** in the corner («сейчас −0.0332 %»);
- a one-line legend.

The `spark` field (D24) and `spark-bars.ts` are **replaced**, not kept beside the chart.

**Contract** `WebInsightChart`, nullable on the statement:
- `kind`: `'bars' | 'lines' | 'bars_mirror'`;
- `unit`: `'pct' | 'usd' | 'ratio' | 'share' | 'index'`;
- `ref`: `number | null`, the reference line;
- `band`: `{lo, hi} | null`, the shaded "normal" strip;
- `series`: `[{key, points: [{time, value}]}]`, at most 2 series and **at most 300 points each** (the schema refuses more);
- `highlight`: `time | null`;
- `span`: `{from, to}`.

The axis ticks and scales are a **pure client helper** (`insight-chart.geometry.ts`, with its own spec) behind an inline-SVG component. No chart library: lightweight-charts is too heavy for 1–6 small cards.

**Only displayed statements get a chart.** The server builds charts **after ranking**, for the top statement and the block lines the page shows, never for every candidate. That bounds the reads below.

| Rule | Chart | Data | New venue cost |
|---|---|---|---|
| R1 liquidation surge | `bars_mirror`, hourly over the period: shorts above zero, longs below (the page's convention), the named side in colour, the other muted; the current hour highlighted | the overview's `hourly` bars, already in the snapshot (IB-107's R1 source) | 0 |
| R2 one coin's liquidations | `bars`: the coin's period USD for the last ≤ 14 windows plus the current one; `band` = that sample's p5–p95; the current bar amber when outside | `coins.get(symbol).sample` (snapshot) | 0 |
| R3 cascade | `bars_mirror`, **1-minute** liquidation USD of both sides from 15 min before the cascade to 15 min after; the cascade's minutes highlighted | our liquidation tape (Postgres), one indexed read per displayed R3, cached 5 min | 0 (DB) |
| R4 OI vs price | `lines`, price and OI as **% from the period start**, one axis, `ref` 0 (mockup card 2) | 7d: the positioning baseline's hourly price and OI (168 points) plus the live end point. 1h / 4h / 24h: 5 m bars: OI from `OiLsService` (weight 0), and price from klines at **exactly** the bar count (12 / 48 / 288 → weight 1 / 1 / 2, the IB-115 exact-limit pattern, **not** `CandlesService`'s 1 500-bar pages at 10). Cached 5 min per (symbol, period) | ≤ 2 per displayed R4 per 5 min |
| R5 funding extreme | `bars`, every settlement for 30 days around zero; `band` = the coin's p5–p95 (**the same sample the rarity used**); bars outside amber, inside muted; the current one marked (mockup card 1) | the positioning baseline's 30-day funding, with times (§2) | 0 |
| R6 crowd vs top traders | `lines`, global-account L/S and top-trader-position L/S over the period, `ref` 1.0 | 7d: baseline hourly. ≤ 24h: `OiLsService.longShort` at 5 m | 0 (`/futures/data`) |
| R7 breadth | `lines`, the share of coins up over the last 24 h, unit share, `ref` 50 % | `breadth.upShareSample` (snapshot) | 0 |
| R8 DVOL spike | `lines`, `flows.dvol.series`, `band` = the sample's p5–p95 when the rule computed it | the flows payload | 0 |
| R9 stablecoin supply | `lines`, 30 daily values in $B, span start → now | `flows.stablecoins.series` | 0 |
| R10 Coinbase premium | `bars`, 60 one-minute values around zero, `ref` 0 | `flows.coinbasePremium.series` | 0 |
| R11 OI divergence | `lines`, two series over A − 2 bars … B + N: price and OI **in contracts**, each **as % from the first point** on one axis, `ref` 0; A and B marked on both lines, the A–B strokes drawn in the alert's direction colour (V15) | the journal row; price from exact-limit klines on its TF (≤ W + N + 3 bars → weight ≤ 2); OI from our DB. Cached per alert id 1 h (history does not change) | ≤ 2 per new alert per hour |

**Costs:**
- **Weight:** worst case, three R4 cards on screen in every period → ≤ 3 × 2 / 5 min ≈ **1.2 / min**, only while a page asks; plus R11's ≤ 2 an hour.
- **Memory:** ≤ 2 × 300 points per chart, ≤ 10 charts per period response → ≈ 50 KB JSON per period, ≈ 200 KB over four periods, plus the 5-minute R3/R4/R6 entries (bounded by displayed statements).

**Links.** Keep IB-BUG-035's rule: a card links to `/instrument/…` or a route, never an anchor the page may not have.

## 4. Item 4: the `/liquidations` page (IB-120)

**Market block.** Unchanged at 8 cards. «Показать все (50)» becomes a router link «Все ликвидации ({n}) →» to `/liquidations?p=<current period>`.

**The page:**
- a breadcrumb «Рынок / Крупные ликвидации»;
- the help block (§6);
- the **same bubble chart** component as on Market;
- filter chips, all in the query string so a link reproduces the view:
  - period `24h | 7d`;
  - coin (all, or one);
  - minimum `$100K | $1M`;
  - side (both, longs, shorts);
  - venue (all, or one);
- a table sorted by time (newest first), sortable on every column: time, coin, side, sum, price, venue, series («{count} за {min} мин» from `seriesCount` / `seriesSpanSec`, «—» when not in a series);
- each row opens `/instrument/<SYM>?at=<time>`;
- **at 390 px the table drops price and venue.**

**Server.** A new endpoint, `GET /api/web/liquidations/large?period&symbol&minUsd&side&venue`, admin and member as Market.
- It reads **our tape** (Postgres, weight 0) and returns **at most 1 000 rows**, newest first, plus `total` and `truncated`. The page then says «показаны 1 000 последних из {total}». No pagination in this round.
- Sorting is client-side over the returned rows.
- Cached 10 s per filter key, at most 32 keys.
- **Memory** ≤ 1 000 × ≈ 200 B ≈ 200 KB per key. That is bounded, and the report states the real figure.
- The report includes `EXPLAIN ANALYZE` of the 7d / $100K / all query on a slot DB.

**Nav item: none.** I agree with the coordinator. The page is reached from Market and by link, and a sixth top-level item for a drill-down would dilute the nav.

**Help «Как этим пользоваться».** Use `mockup.html`'s text, including the Binance one-per-second caveat.
- It is open on the first visit and collapsed afterwards, in `localStorage`, read and written in `try/catch`. When storage is unavailable it renders open.
- **This task creates the shared `help-block` component** (title, collapsible body, storage key, `openOnFirstVisit`). IB-121 reuses it.

**Strings:** ru and en, through i18n keys.

## 5. Item 5: help for the heat table (IB-121)

- **Placement:** above the heat table on Market and on `/positioning`.
- **Title:** «Что значит подсветка и как читать таблицу».
- **Text:** the text in `mockup.html`, verbatim. It is consistent with `heatOf` (0.75 / 0.90 / 0.99) and `positioning.rules.ts`.
- **Swatches:** one per level (заметно / необычно / крайне редко), plus the hatch for "мало данных". They are drawn by the **same CSS classes the table cells use**, so a palette change cannot make the help disagree with the table.
- **Behaviour:**
  - on Market it is one collapsed line, «Что значит подсветка?»;
  - on `/positioning` it is open on the first visit and collapsed afterwards;
  - both use `help-block` from IB-120.
- **Spec:** every signal word the rules can emit (`positioning.rules.ts`'s closed set) appears in the help. A new signal without help text fails the build.

## 6. Order and WIP

The coordinator's order, WIP 2, a fresh dev context per task:

| Order | Task | Depends on |
|---|---|---|
| 1 | IB-117 (item 3) | — |
| 2 | IB-118 (item 2) | IB-117 (the same tile strip and contract) |
| 3 | IB-119 (item 1) | IB-BUG-035 (the link rule it keeps) |
| 4 | IB-120 (item 4) | — |
| 5 | IB-121 (item 5) | IB-120 (`help-block`) |

**Budget of the round, all items:**
- Binance `fapi` ≤ ≈ 1.2 weight/min while pages are open (R4); `/futures/data` a few calls per 5 min at weight 0; CoinGecko ≤ 0.1/min;
- memory well under 1 MB;
- DB: reads only, no new table.
