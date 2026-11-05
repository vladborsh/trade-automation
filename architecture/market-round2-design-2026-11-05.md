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

**What changes.** The 6 px bar on **market cap, BTC OI and BTC funding** is empty today (`kpi-tile.ts` `bar()` returns `[]` for them). It is replaced by a mini chart with «7д мин {min} / макс {max}» under it. Dominance and liquidations keep their bars: those carry a share and are not empty. *(Amended 2026-11-05: dominance gets its own chart in §7; liquidations keep their bar.)*

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
| Market cap | **There is no keyless 7-day history.** CoinGecko's `/global/market_cap_chart` is paid (`env.schema.ts`; context ruling). `market_chart` is per coin, and a sum of coins is a different number, so it is not used. **Decision (owner ruling 2026-11-05, replacing the in-memory ring): we record it ourselves** in a table, `market_cap_total` (below). The tile reads the last 7 days from it. | CoinGecko `/global`: one call per 10 min from the writer, shared with the cards' 120 s cache, so **≤ 0.1 call/min** | DB: ≈ 3 MB a year; memory: one 7-day read (≤ 1 008 rows) per KPI compute, inside the 60 s cache |

**`market_cap_total`** (amended 2026-11-05, owner: «записываем сами»):
- **Table:** `ts timestamptz primary key` (CoinGecko's own `updated_at`, so two polls of the same refresh collapse onto one row), `total_usd numeric not null check (total_usd > 0)`, `fetched_at timestamptz not null`. Not partitioned.
- **Migration 029**, the next free number across every ref on 2026-11-05 (re-check at commit). The table `market_cap_global`, dropped in 024, is **not** revived: it held dominance and a different key, and a new name keeps 024's history readable.
- **Writer cadence:** a timer every **10 min**, independent of viewers, reads `MarketCardsService.global()` (its 120 s cache) and upserts on `ts`. A failed read writes nothing and logs once; the next tick retries.
- **Retention: none.** 52 560 rows a year at ≈ 60 B ≈ **3 MB a year** (arithmetic; the report gives `pg_total_relation_size` after a day). Keyless CoinGecko cannot give this back, which is the storage rule's own test (`storage-ruling-2026-11-03.md` §1). Revisit only if it ever passes 50 MB.
- **Reading:** the tile reads `ts > now − 7 d`. **A gap over 30 min breaks the line**, never interpolated. Min/max are over the rows held.
- **A fresh database:** under 6 h of rows, no chart, «копим историю: {h} ч». Under 7 days, the chart over what is held, with the span named («за {d} д {h} ч»). From then on, deploys no longer reset it.

**Total for item 2:**
- Binance `fapi` weight +0; `/futures/data` ≤ 1 per 5 min; CoinGecko ≤ 0.1/min;
- memory ≈ 25 KB (funding times + OI points); DB: `market_cap_total`, ≈ 3 MB a year (the round's one new table);
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

**Market block.** Unchanged at 8 cards. «Показать все (50)» becomes a router link «Все ликвидации →» to `/liquidations?p=<current period>` (no count: amended 2026-11-05, IB-120 review).

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
- a table sorted by time (newest first), sortable on every column: time, coin, side, sum, price, venue, series («{count} за {min} мин» from `seriesCount` / `seriesSpanSec`, «—» when not in a series). **A series is market-wide** (all coins together, the same grouping as R3 and the Market block), not per coin; the help text says so (amended 2026-11-05, IB-120 review, mockup.html corrected by dev-1);
- each row opens `/instrument/<SYM>?at=<time>`;
- **at 390 px the table drops price and venue.**

**Server.** A new endpoint, `GET /api/web/liquidations/large?period&symbol&minUsd&side&venue`, admin and member as Market.
- It reads **our tape** (Postgres, weight 0) and returns **at most 1 000 rows**, newest first, plus `total` and `truncated`. The page then says «показаны 1 000 последних из {total}». No pagination in this round.
- Sorting is client-side over the returned rows.
- Cached 10 s per filter key, at most 32 keys.
- **Memory** ≤ 1 000 × ≈ 200 B ≈ 200 KB per key. That is bounded, and the report states the real figure.
- The report includes `EXPLAIN ANALYZE` of the 7d / $100K / all query on a slot DB.

**Nav item: «ликвидации», between «рынок» and «позиционирование»** (owner override, 2026-11-05; IB-132). This supersedes the original call here, which was no nav item: reach the page from Market and by link, so as not to dilute the nav with a drill-down. The owner wants it as a top-level item. The Market link «Все ликвидации →» stays. A `/liquidations` redesign («episodes») is planned; its brief follows the mockup and is not part of this round.

**Help «Как этим пользоваться».** Use `mockup.html`'s text, including the Binance one-per-second caveat.
- It is open on the first visit and collapsed afterwards, in `localStorage`, read and written in `try/catch`. When storage is unavailable it renders open.
- **This task creates the shared `help-block` component** (title, collapsible body, storage key, `openOnFirstVisit`). IB-121 reuses it.

**Strings:** ru and en, through i18n keys.

## 5. Item 5: help for the heat table (IB-121)

- **Placement:** above the heat table on Market and on `/positioning`.
- **Title:** «Что значит подсветка и как читать таблицу».
- **Text:** the text in `mockup.html` §5, **as corrected against the code in the IB-121 review** (amended 2026-11-05; the first draft was not fully consistent, and I had called it consistent without checking). The corrections:
  - the hatch is «оценить нельзя — данных мало или нет»;
  - funding reads «(на их стороне перекос)», not «(их больше)»;
  - the «Ликвидации» and «OI, $» columns are explained;
  - «пусто — ни одно правило не сработало» is added.
  The source of truth is `heatOf` (0.75 / 0.90 / 0.99) and `positioning.rules.ts`; where the mockup and the code disagree, the code wins and the mockup is corrected.
- **Swatches:** one per level (заметно / необычно / крайне редко), plus the hatch for «оценить нельзя». They are drawn by the **same CSS classes the table cells use**, so a palette change cannot make the help disagree with the table.
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
| 6 | IB-130 (§7, recorder; may ship before the rest) | — |
| 7 | IB-131 (§7, tile) | IB-119 (owner's order), IB-130 |

**Budget of the round, all items:**
- Binance `fapi` ≤ ≈ 1.2 weight/min while pages are open (R4); `/futures/data` a few calls per 5 min at weight 0; CoinGecko ≤ 0.1/min;
- memory well under 1 MB;
- DB: one new table, `market_cap_total` (≈ 3 MB a year, migration 029), plus two dominance columns on it (§7, migration 030, ≈ 1 MB a year); everything else reads only.

## 7. Item 6: BTC and ETH dominance history (IB-130, IB-131) — added 2026-11-05

**Input:** `reports/coordinator-dominance-history-2026-11-05.md` (owner, P2, after IB-119). The «Доля BTC» tile shows a share bar today; the owner wants the **7-day history of BTC and ETH dominance** (each coin's share of total crypto market cap), recorded by us like the cap.

**Source, no new call.** The `/global` payload the cap recorder already reads every 10 min (`MarketCapRecorderService`, `MarketCardsService.global()`) carries `data.market_cap_percentage` (a record of PERCENT values, `market-cards.payloads.ts`). We store `btc` and `eth` from the same payload, in the same row. **CoinGecko +0 calls; Binance +0.**

**Columns on `market_cap_total`, not a sibling table.** Same key (CoinGecko `updated_at`), same fetch, same writer, same retention: a sibling table would repeat `ts` and `fetched_at` and add a join to the one read. 029 is applied on the box and MD5-frozen, so this is a **new migration**:
- **Migration 030** (`030.do.market-cap-dominance.sql`): `alter table market_cap_total add column btc_pct double precision null check (btc_pct between 0 and 100), add column eth_pct double precision null check (eth_pct between 0 and 100)`; undo drops both columns. No default, so the `alter` is metadata-only (no rewrite). Re-check the number across **every ref** at commit (on 2026-11-05: 029 is the highest on all refs; IB-122..128 move to 031–034, below).
- **Old rows stay null.** Rows written before 030 have no dominance and none can be recovered; the chart starts where the data starts.
- **Writer.** `marketCapObservation` also returns `btcPct`/`ethPct`, each **independently** null when absent, non-finite or outside 0–100. The cap rule is unchanged: a row is written when the total is valid, with whatever dominance came along; a payload with dominance but no valid total writes nothing (as today). Conflict on `ts` still does nothing (the same refresh has the same percentages).
- **Size.** 2 × 8 B per row × ≤ 52 560 rows a year ≈ **0.84 MB a year**, ≤ ≈ 1 MB with alignment; the table ≈ 4 MB a year in all (arithmetic; IB-130's report gives `pg_total_relation_size` after a day). **No retention cut**, per the cap ruling: keyless CoinGecko cannot give this back either.

**Split, because recording starts only when deployed.** **IB-130** is migration 030 + the writer + the read, no UI; it can ship in the next deploy. **IB-131** is the tile, after IB-119 as the owner ordered. By the time the tile ships, days of history are held, so the "collecting" state is in practice only seen on fresh slot databases.

**Migration order is a dependency, not a hope.** postgrator applies only versions above the current one (`burned-migration-numbers`): if IB-122's 031 reached the box before IB-130's 030, 030 would be silently skipped there and applied on fresh databases. So **IB-122 `depends_on` IB-130**. IB-130 is small, so this costs the alerts row little.

**Read.** `marketCapSince` returns `btcPct`/`ethPct` alongside `totalUsd`: the one 7-day read (≤ 1 008 rows) the cap tile already makes per KPI compute, inside its 60 s cache. No second query.

**Contract.** `WebKpiHistory.kind` gains `'lines'`. For `'lines'`, `points`/`min`/`max` are **BTC's** (the tile's own value), and a new field `second: { label: 'ETH', points, min, max } | null` carries ETH; `second` is required and null for `area`/`bars`, so a server that forgets it fails the parse. `from`/`to` cover both. `breakAfterSec` 30 min, as the cap.

**Tile (IB-131).**
- **Two stacked strips, each on its own scale**, BTC above (amber, the bar's existing `--amber-500`), ETH below (muted `#8b949e`, no new colour). Not two lines on one axis: BTC sits near 57 % and ETH near 11 %, so on a shared 0–60 axis a week's 1-point move is under 2 % of the chart height and both lines draw flat; one box with two independent scales would invite reading the crossings as meaningful. Each strip has dots on its min and max and the newest point marked, as the cap chart.
- Under it: «7д BTC {min}–{max}% · ETH {min}–{max}%» (one decimal). At 390 px it may wrap to two lines; it must not scroll.
- **Kept:** the value (BTC %), its 24 h delta and the ETH note «ETH {ethPct}%». **Goes:** the share bar, as on the other charted tiles.
- **Under 6 h of rows with `btc_pct` not null:** `history` null, and the tile is exactly today's (bar and ETH note). No «копим историю» note: the note slot holds the ETH share, which the owner asked to keep.
- **Under 7 days:** the chart over what is held, span named as on the cap tile. A gap over 30 min breaks both lines.
- A row with BTC but no ETH puts a hole in the ETH strip only.

**Total:** venue weight +0; memory +2 numbers per row on a ≤ 1 008-row read; DB ≈ 1 MB a year on top of the cap's 3 MB.
