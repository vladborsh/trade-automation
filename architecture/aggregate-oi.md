# Architecture note — aggregated open interest (Binance + Bybit + Hyperliquid)

**Role:** Architect. **Status:** designed and routed (§8), 2026-09-18.
**User instruction:** «нам нужен aggregated open interest / не с какой то конкретной биржи а с
этих 3х». The OI panel stops plotting Binance alone and plots the sum of **Binance USDⓈ-M,
Bybit linear and Hyperliquid** perpetuals, in USD, as candles (the §11.1–§11.2 rendering of
[`chart-layouts.md`](chart-layouts.md) is kept).

Read with: [`chart-layouts.md`](chart-layouts.md) §4, §11.1–§11.2 (single-venue OI as built);
[`coinalyze-oi-assessment.md`](coinalyze-oi-assessment.md) (§5 amended in its §8 — its
"do not build yet" is overruled); [`panel-sync-and-oi-depth-diagnosis.md`](panel-sync-and-oi-depth-diagnosis.md)
Bug 2 (newest-first pagination). Contract committed with this note:
`libs/contracts/src/metric-aggregate.ts`, `VenueSchema` + `'bybit' | 'hyperliquid'`,
`Panel.aggregate`, `metricAggregates` WS topic.

---

## 0. Facts this design rests on

Settled before this note (spec, verified live 2026-09-18) and re-checked by me the same day:

| Venue | History | Live tip | Counting | Notional basis |
|---|---|---|---|---|
| Binance USDⓈ-M `BTCUSDT` | `openInterestHist` 5 m, **30 days**, newest-first | `/fapi/v1/openInterest` (+ `premiumIndex` mark) | one-sided `sumOpenInterest` | `sumOpenInterestValue` = OI × **mark** (measured, §11.1) |
| Bybit linear `BTCUSDT` | `/v5/market/open-interest` 5 min, **3+ years**, limit 200, **newest-first** | `/v5/market/tickers` | `singleOpenInterest` one-sided; `openInterest` = exactly 2 × single | tickers `singleOpenInterestValue` = single × **markPrice** (checked: 28 357.206 × 78 032.9 = 2 212 795 020.08, to the cent) |
| Hyperliquid `BTC` | **none** — cannot be backfilled, only accumulated | `POST /info {"type":"metaAndAssetCtxs"}` | `openInterest` one-sided | none published; `markPx` in the same response |

New facts from my own checks (2026-09-18):

- **Bybit history rows carry `singleOpenInterest` all the way back** — present on rows stamped
  2023-11-14 and 2026-05-28, i.e. before the 2026-06-11 single-count change. So the one-sided
  aggregate needs no ÷2 on old rows; the mapper reads `singleOpenInterest` everywhere.
- **Bybit history is base units only** → notional must be derived. Bybit's
  `/v5/market/mark-price-kline` (5 min bars, limit 1000) gives the matching mark price.
- **Hyperliquid's response has no timestamp.** It is the one leg stamped by *our* clock (§3.3).
- Live, same minute: Binance 107 572.6 + Bybit 28 357.2 + Hyperliquid 36 460.7 = **172 390 BTC**
  one-sided (spec: ≈ 172 217). With Bybit doubled: 200 747 BTC — the as-published sum is
  **16.4 % above ours; ours is 14.1 % below it.**
- **Documented rate limits.** Bybit: *600 requests per 5-second window per IP* across all
  HTTP traffic; exceeding it returns `403 access too frequent` and a **≥ 10-minute IP ban**
  (docs, "Rate Limit"). No rate-limit headers on public endpoints, so the limit cannot be
  watched — only stayed far below. Hyperliquid: *1200 weight/min per IP*; `metaAndAssetCtxs`
  is an "other documented info request" = **weight 20**.

---

## 1. The central problem — coverage steps (DECISION)

Depth is asymmetric by orders of magnitude: Bybit 3 y, Binance 30 d (our store grows it from
here), Hyperliquid from the moment we start polling. A naive sum steps up each time a venue's
coverage begins, and a reader takes the step for a positioning event.

**Options weighed.** (a) *Plot only where all three have data* — today that is zero bars; for a
month it is a few days. The user would get an empty panel for the thing they asked for. Rejected
as the *default*; kept as a setting (below). (b) *Splice/rescale* older coverage to the newer
level (ratio at the seam) — invents numbers that no venue published. Rejected outright.
(c) *Full coverage everywhere, sum whatever exists* — the plausible-and-wrong chart. Rejected.
(d) **Coverage epochs (chosen):** always show every bar we can honestly sum, but every bar
carries *which venues are in it*, a bar never mixes coverage sets, a coverage change is drawn as
a break with a label, and incomplete coverage is drawn in a visibly different style.

### Rules (implemented in the pure `aggregateObservations`, contracts, SE-AG3)

- **C1 — one grid.** Each member's observations are reduced to one sample per grain slot
  (`grain = min(tf, 5 m)`, slot = `floor(time / grain) × grain`, last-in-slot) — exactly the
  §11.2 rule, applied per member *before* summing.
- **C2 — sum only what is present, and say so.** A slot's aggregate sample = Σ over members
  with a sample in that slot (convention factor applied, §2). It carries `coverage` = those
  member ids. Notional sum exists only if **every** present member has a notional in that slot;
  otherwise the slot has `value` but no notional (the §11.1 rule: a gap, never a partial USD sum).
- **C3 — dropping, never carrying forward.** A *run* is a maximal sequence of consecutive
  samples with identical coverage. A run shorter than **K = 3 samples** whose coverage is a
  strict subset of an adjacent run's coverage is **dropped** (whitespace) — this is "a venue
  missed a poll or two", and it must never draw a dip. At the right edge the right neighbour is
  unknown, so a short subset run is withheld (not emitted) until it either grows to K (a real
  outage → it becomes a partial epoch) or is superseded. Consequence for the forming bar: if
  Bybit's 12:05 poll has landed and Hyperliquid's has not, the 12:05 slot is not shown yet —
  it is never shown as "two venues' worth". Stale carry-forward is not offered: it invents flat
  stretches that look like "OI stopped moving".
- **C4 — a bucket never mixes coverage.** A timeframe bucket is built from the samples whose
  coverage equals the coverage of the bucket's *closing* sample; earlier samples in the same
  bucket with a different coverage are excluded. Such a bucket is `coverageStart: true`.
- **C5 — no body across a seam.** `open` = previous bucket's close **only if** that bucket has
  the same coverage; otherwise `open` = the bucket's own first sample and `coverageStart: true`.
  So the jump between epochs is never a candle body or a line segment.
- **C6 — `complete`** = coverage equals all configured members.

### What the reader sees (SE-AG4)

1. **Style by completeness.** Complete bars: the OI colours (`#58a6ff` / `#f0883e`). Partial
   bars: the same hues **hollow and dimmed** (body transparent, border + wick at ~45 % opacity).
   Line mode (1 m): two line series, complete solid / partial dashed + dimmed; each is whitespace
   where the other has data, so the line physically breaks at every seam.
2. **Seam markers.** On every `coverageStart` bar, a series marker above the bar naming the
   change: `+Binance`, `+Hyperliquid`, `−Hyperliquid` (diff vs the previous emitted bar).
3. **Coverage chip in the header**, driven by the crosshair (last bar when not hovering):
   `3/3 · Binance · Bybit · Hyperliquid` on complete bars; on partial bars, in the muted colour,
   `2/3 · Binance · Bybit — без Hyperliquid` (the missing venue named, not implied). Tooltip:
   per-venue USD at that bar (`members[]`) and its share of the total.
4. **Convention badge** next to the unit: `one-sided` (tooltip: why, and that CoinGlass /
   Coinalyze-style sums read ~16 % higher). Shows `as published` when flipped.

Setting `aggregate.minCoverage` (client, per panel, default `any`): `complete` hides partial bars
(option (a) as an opt-in). Not built unless the user asks — listed so nobody re-derives it.

Non-negotiables, checked: (1) a coverage change is always a break + label + style change, never
a body, never a segment → cannot be read as a market move; (2) the chip states the venues at the
bar being read.

---

## 2. Counting convention — a named setting

`countingConvention: 'one-sided' | 'as-published'` on each aggregate in
`config/metric-aggregates.yaml`, **default `one-sided`**. Stored observations are *always*
one-sided (Bybit mapper writes `singleOpenInterest`); the convention is applied **at composition
time** by `PUBLISHED_OI_SIDES[venue]` (Bybit 2, others 1). Flipping it is a yaml edit and a
restart — no re-ingestion, no migration, history re-renders under the new rule.

Why one-sided: it is the only internally consistent sum. CoinGlass and CoinGecko print Bybit's
two-sided field next to Binance's and Hyperliquid's one-sided ones. **Coinalyze was not verified
numerically** (canvas-rendered, API needs a key); that it behaves the same is *inferred* from
CoinGlass/CoinGecko, not observed. Expect our line ~14 % below theirs for BTC; the gap scales
with Bybit's share, so it is not a constant.

Drift guard: the Bybit mapper checks `openInterest / singleOpenInterest` on every row; outside
`2 ± 0.001` → counter `metric_sidedness_drift_total{source}` + one warn per streak. If Bybit ever
changes the legacy field's meaning, we find out from a counter, not from a chart.

---

## 3. Architecture

### 3.1 Composition, not a pseudo-instrument (decision)

Two shapes were on the table: an `agg:BTC` pseudo-source whose adapter fans out and **stores
the sum**, or **store each leg as itself and compose on read**. Chosen: **compose on read.**

- The store keeps "what each venue said" (the §11.1 principle). A stored sum would bake in the
  convention and the coverage of the moment it was written; flipping the convention or fixing a
  leg would need a rewrite.
- Legs arrive at different times (polls jitter by ≤ 2 s, backfills by minutes). Composing on
  read makes rule C3's "withhold until the slot is complete" natural; a write-time sum would
  have to be re-upserted as each leg lands.
- Failure isolation: a Bybit outage stops one leg's ingestion; Binance and Hyperliquid keep
  accumulating. With a fan-out-and-store adapter, one leg's failure loses the others' sample.

The fan-out therefore sits **behind the read path**: `AggregateMetricsService` (server) reads
each member from `MetricCache`/`MetricStore` and calls `aggregateObservations`.

### 3.2 Source axis — resolved without a new axis

Bybit and Hyperliquid are genuine venues, so they join `VenueSchema` honestly and the existing
`Map<Venue, MetricAdapter>` resolves them — the `(metric, source)` axis the assessment named is
**not needed for this build** (it remains the answer for a *provider* like Coinalyze). What *is*
new: the legs are not chart instruments (no candles, no venue status, not in
`instruments.yaml`). They are declared as `MetricSource` (`{id, venue, symbol, quoteCurrency}`)
inside the aggregate definition. `MetricAdapter` methods narrow their `instrument` parameter to
`MetricSource` (an `Instrument` satisfies it structurally — no Binance change).
`MetricIngestionService.metricPairs()` = single-venue metric panels ∪ all aggregate members,
deduplicated (`binance:BTCUSDT` is both, ingested once).

### 3.3 Config and per-leg specifics

```yaml
# apps/signal-server/config/metric-aggregates.yaml  (architecture/aggregate-oi.md §3)
aggregates:
  - id: btc-perp-oi
    displayName: "BTC perps · 3 venues"
    metric: openInterest
    countingConvention: one-sided          # §2 — 'as-published' matches CoinGlass-style sums
    members:
      - { id: "binance:BTCUSDT",  venue: binance,     symbol: BTCUSDT, quoteCurrency: USDT }
      - { id: "bybit:BTCUSDT",    venue: bybit,       symbol: BTCUSDT, quoteCurrency: USDT }
      - { id: "hyperliquid:BTC",  venue: hyperliquid, symbol: BTC,     quoteCurrency: USDC }
```

Boot fails on an unknown aggregate id in `layouts.yaml`, a member whose venue has no metric
adapter, or a member not supporting the metric (same rule as every config file). The `btc-oi`
panel in `layouts.yaml` gains `aggregate: btc-perp-oi`; `instrument: binance:BTCUSDT` stays as
the anchor.

**Hyperliquid time stamp.** No venue time exists in the response. `time` = our clock at response
receipt — the single documented exception to "venue stamp, never local clock" (header comment in
the adapter). The poll rides the `BarClock` 1 m tick + ≤ 2 s jitter, so the stamp lands in the
right 1 m slot; host clock is NTP-synced (base infra), error ≪ one slot.

**Hyperliquid is shared across symbols.** One `metaAndAssetCtxs` call returns every asset; the
adapter memoises the response for 10 s so N configured coins cost one call per minute.
`fetchObservations` returns `[]` (the adapter `supports` the metric but has no history); the
ingestion service must treat that as "nothing to backfill", not as an error.

---

## 4. One price basis: each leg at its **own venue's mark price**

Rule: **notional(leg, t) = one-sided OI(leg, t) × that venue's mark price at t.** Never another
venue's price, never last-trade. This is the basis Binance already uses (measured, §11.1) and the
one Bybit publishes (`singleOpenInterestValue`, checked to the cent).

| Leg | History notional | Tip notional | `notionalBasis` |
|---|---|---|---|
| Binance | `sumOpenInterestValue` as published | OI × `premiumIndex.markPrice` (built) | venue / derived |
| Bybit | `singleOpenInterest × close of the 5 min mark-price-kline bar ending at the row stamp` | tickers `singleOpenInterestValue` | derived / venue |
| Hyperliquid | — (none) | `openInterest × markPx` from the same response (atomic) | derived |

Currency: USDT and USDC legs are summed at par and labelled **USD** (a ≤ 0.1 % de-peg is below
anything the panel resolves; stated in the tooltip, not hidden). Hyperliquid `markPx` over
`oraclePx`: mark is the price the venue marks positions at, the same role as Binance/Bybit mark.

**Join check (SE-AG1, measured, not assumed).** Bybit history is derived, its tip is venue —
the same shape as Binance's. SE-AG1 measures on ≥ 24 h of overlap: (1) which reading a history
row stamped `t` is (compare against tickers polled at `t`, `t+1 m`, … `t+4 m`) — this fixes
whether the mark bar is the one *ending* or *starting* at `t`; (2) |derived − venue| at the join
in bps and as a fraction of the median |5 m ΔOI_usd|. Pre-authorised rule: the step must be
< 10 % of the median 5 m move at **p90**, not just the median (the §11.1 lesson); if it is not,
derive the tip too (single × tickers `markPrice`, same call) so both sides share one formula.

---

## 5. Server design (SE-AG3 unless marked)

```
libs/contracts/src/metric-aggregate.ts        # contract (committed) + aggregateObservations (AG3) + spec
apps/signal-server/
  config/metric-aggregates.yaml               # §3.3
  src/config/metric-aggregates.schema.ts      # load + cross-check vs layouts / adapters
  src/market-data/metrics/
    aggregate-metrics.service.ts              # read members from cache/store → aggregateObservations
    bybit/bybit-metrics.adapter.ts + mapper   # SE-AG1
    hyperliquid/hyperliquid-metrics.adapter.ts + mapper   # SE-AG2
  src/api/rest/metric-aggregates.controller.ts
  src/api/ws/live.gateway.ts                  # metricAggregates topic
```

- `GET /api/metric-aggregates` → definitions. `GET /api/metric-aggregates/points?aggregate&
  timeframe&from&to&limit` → `{ aggregate, points }`. Reads members from `from − tfMs − K·grain`
  (lead bucket for C5 plus the C3 look-behind) and drops the lead, like `/api/metrics`.
- **WS:** on every `MetricObserved` whose source is a member of a subscribed aggregate, rebuild
  the forming bucket from `MetricCache` over `[bucketStart − tfMs − K·grain, now]` and send the
  last point — **or nothing** if C3 withholds it. Test: WS point for a bucket equals REST point.
- **Health:** each member appears in `metrics[]` with `lastObservationAge` (they are ingested
  pairs). New `aggregates: [{ id, coverageNow: string[], complete: boolean }]`, additive, default
  `[]`. `complete: false` for > 15 min is the alarm condition DevOps can wire.
- **Replay mode:** `ReplayMetricAdapter` registered for `bybit` and `hyperliquid` too, with
  fixtures that include a Hyperliquid start mid-series and a 2-slot Hyperliquid blip, so C3/C5
  are exercised end-to-end without any venue.
- **Deep crawl — never on the boot path.** Phase 1 (`warmUp`) per leg fetches only the tail
  since the latest stored row (bounded by the adapter's window). Bybit's 3-year history is
  Phase 2 (`deepenHistoryAsync`, after `listen()`), resumable: each pass walks back from the
  **oldest stored** Bybit row to `now − BYBIT_OI_HISTORY_DAYS` (env, default 1 095), so an
  interrupted crawl continues on the next boot rather than restarting. MetricCache stays 30 d;
  older points are served from `MetricStore` (≈ 315 k rows / 3 y / symbol ≈ 50 MB JSONL).

### Bybit pagination (SE-AG1) — the Bug 2 trap, again

`/v5/market/open-interest` returns the **newest** `limit` rows of `[startTime, endTime]`. Walk
**backward**: request `[from, cursorEnd]`, prepend, stop when `rows.length < 200` or oldest
`≤ from`, else `cursorEnd = oldestTimestamp − 1`. (`nextPageCursor` walks the same direction and
may be used instead, but the stop condition is identical.) Required test: a fake `fetch` over a
synthetic multi-page series that returns the newest `limit` rows of the window — assert all rows
ascending, no gaps, ≥ ⌈n/200⌉ calls. A forward walker passes every non-paginating test and
returns one page; that is precisely how Bug 2 shipped.

---

## 6. Hyperliquid polling is permanent (decision)

Cadence **60 s**, on the existing `BarClock` tick (`METRIC_POLL_INTERVAL_MS`), same as Binance and
Bybit — one grid, one rule, and 1 m samples give C3 room to tolerate a missed poll inside a 5 m
slot without dropping it. What a hole does: while the server is down, Binance and Bybit are
backfilled on the next boot, Hyperliquid is not — **the aggregate across the hole is a partial
epoch** (`2/3 — без Hyperliquid`, dimmed, with `−Hyperliquid` / `+Hyperliquid` seam markers). It is
never interpolated, and the hole is permanent. A week offline = a permanently labelled week. The
only mitigation is uptime: `/api/health` `aggregates[].complete` is the signal to alarm on.

---

## 7. Rate budget

| Venue | Live | One-off / per boot | Share of documented limit |
|---|---|---|---|
| Binance | unchanged: OI + premiumIndex, 2 weight/min per symbol | unchanged | ~1 % of 2 400/min |
| Bybit | 1 tickers call/min (OI + value + mark in one) | Phase 2 deep crawl, BTC 3 y: 1 577 OI pages + 316 mark-kline pages ≈ **1 900 requests**, paced at **2 req/s** → ~16 min | live 0.03 %; crawl 10 req / 5 s = **1.7 %** of 600 / 5 s |
| Hyperliquid | 1 `metaAndAssetCtxs`/min, all coins = **20 weight/min** | none (no history) | **1.7 %** of 1 200/min |

Bybit gives no headers to watch, and a breach costs a 10-minute ban of the whole IP (which also
kills the live tip): the crawl's pacing is a constant with a comment, the crawler **stops the pass
on any 403/429** (logs, resumes next boot), and on `retCode ≠ 0` it backs off 30 s once then
stops. Per-boot tail backfill is ≤ a few pages.

**Binance COIN-M is excluded.** `dapi …/futures/data/openInterestHist` is stale (identical
`sumOpenInterest` across five hourly buckets, ~2.06× live). If COIN-M is ever a member, its leg
uses `/dapi/v1/openInterest` (contracts → `unit: 'contracts'`) and no history.

---

## 8. Routing

```
architect-aggregate-oi  (this branch: note + contract; server 223+1 skip, client 207 — all green)
 ├── SE-AG1  se-oi-bybit-leg          Bybit adapter, backward pagination, mark-kline notional,
 │                                    Phase 2 crawl, join measurement, sidedness drift guard
 ├── SE-AG2  se-oi-hyperliquid-leg    Hyperliquid adapter (tip only, shared call, local stamp)
 ├── SE-AG3  se-oi-aggregate-core     aggregateObservations (C1–C6) + config + service + REST/WS
 │                                    + health + replay fixtures + layouts.yaml aggregate panel
 ├── SE-AG4  se-oi-aggregate-client   mock server + client: coverage styling, seam markers,
 │                                    coverage chip, per-venue tooltip, convention badge
 └── SE-AG5  se-oi-binance-deep       Binance >30 d from data.binance.vision (verified overlap first)
```

- All five **in parallel from `architect-aggregate-oi`**. They share only the contract (fixed
  here). Known overlaps: AG1/AG2/AG3 each touch `metric-adapters.provider.ts` (one line per venue)
  and `metric-adapter.port.ts` narrowing (AG3 owns the narrowing; AG1/AG2 code to
  `MetricSource`); AG3/AG4 both touch the mock-server/wire consumers only via the contract.
- **Merge order:** AG3 → AG1 → AG2 → AG4 → AG5. **AG3 + AG1 + AG2 reach master together** (one
  integration, never AG3 alone): AG3's boot check fails a live server whose aggregate has a member
  venue without a metric adapter, and the Bybit/Hyperliquid adapters arrive with AG1/AG2. AG3 first because it owns the port narrowing and
  `metricPairs()`; AG1/AG2 rebase onto it (trivial provider conflict). AG4 last among the core so
  its Playwright runs against the real REST shape as well as the mock.
- **SE-AG5 is the biggest single fix for §1.** Without it the chart is Bybit-only before
  30 days ago (a partial epoch of ~16 % of the total). `data.binance.vision`
  `futures/um/daily/metrics/BTCUSDT/*.zip` carries `sum_open_interest` +
  `sum_open_interest_value` for years. Gate: over the 30-day overlap with `openInterestHist`, the
  values must match row-for-row (report exact-match rate; grain may differ — the 2026-09-10 file
  shows 00:00 then 00:15). If they do not match to ≤ 1e-6 relative, **stop and report**, do not
  ingest. Static S3 files, no API weight; pace 1 file/s, Phase 2, resumable.

Dispatched 2026-09-18 in Orca run `run_44720bbc2dc3` (worktrees named after the branches, all
cut from `architect-aggregate-oi` @ `11ba97d`):

| Task | Branch | Orca task |
|---|---|---|
| SE-AG1 | `se-oi-bybit-leg` | `task_4132c4e3434a` |
| SE-AG2 | `se-oi-hyperliquid-leg` | `task_8367cbcdea31` |
| SE-AG3 | `se-oi-aggregate-core` | `task_9bd4d2fe7cc3` |
| SE-AG4 | `se-oi-aggregate-client` | `task_dd69283b098d` |
| SE-AG5 | `se-oi-binance-deep` | `task_2930fcb0a72d` |

Every task: read `AGENTS.md`; own ports; `libs/contracts` built before the client; server
`npm test` and client `npx ng test --watch=false` green with counts; `worker_done` with branch.

---

## 9. Для пользователя — что теперь показывает панель ОИ

**Что на графике.** Панель открытого интереса больше не про одну Binance. Теперь это **сумма
трёх бирж — Binance, Bybit и Hyperliquid** — по вечным фьючерсам на BTC, в долларах, теми же
свечами, что и раньше. Сегодня это примерно **172 тыс. BTC** (≈ 13,4 млрд $).

**Почему наша цифра примерно на 14 % ниже, чем на Coinalyze / CoinGlass.** Открытый интерес
можно считать двумя способами: «одна открытая позиция = 1» (у одной сделки есть покупатель и
продавец, но контракт один) или «покупатель и продавец по отдельности = 2». Binance и
Hyperliquid считают первым способом. Bybit в своём основном поле отдаёт **второй** способ — это
написано в их собственной документации, а рядом есть отдельное поле с первым способом.
Агрегаторы (CoinGlass, CoinGecko) просто складывают основные поля бирж, то есть смешивают
«×1» и «×2» в одной сумме. Мы складываем всё **одним способом** («×1»), поэтому выходит на
~14 % меньше. Это не ошибка, а честная сумма. Coinalyze мы численно проверить не смогли (их
график не читается автоматически, API требует ключ) — что они делают так же, мы **предполагаем**
по CoinGlass и CoinGecko. Если захотите, чтобы линия совпадала с ними, — это **одна настройка**
(`countingConvention: as-published`), а не переделка; над графиком всегда видно, какой способ
включён (`one-sided` / `as published`).

**Главное — как понять, какие биржи сейчас внутри линии.** У бирж очень разная глубина истории:
Bybit — больше трёх лет, Binance — 30 дней (дальше постараемся достать из архива Binance),
Hyperliquid — **вообще без истории**, мы копим её сами с момента запуска. Если просто сложить,
линия «прыгала» бы вверх в тот момент, когда появляется следующая биржа, и это выглядело бы как
резкий рост позиций, которого на рынке не было. Поэтому:

1. **Над панелью есть плашка, которая показывает биржи в той свече, на которую вы навели
   курсор**: `3/3 · Binance · Bybit · Hyperliquid` — полная сумма; `2/3 · Binance · Bybit — без
   Hyperliquid` — неполная, и отсутствующая биржа названа прямо. При наведении — вклад каждой
   биржи в долларах.
2. **Неполные свечи нарисованы иначе** — полыми и бледными. Полные — обычными цветами (синий /
   оранжевый). Если свеча бледная, в ней не все три биржи, и сравнивать её уровень с яркими нельзя.
3. **На границе, где меняется набор бирж, линия и свечи разрываются**, и над первой свечой новой
   части стоит метка: `+Hyperliquid`, `+Binance` или `−Hyperliquid`. Скачок уровня на такой границе
   — это **появление или пропажа биржи в данных, а не движение рынка.** Свеча никогда не
   «перешагивает» такую границу.
4. **Если одна биржа пропустила минуту-две**, мы не рисуем провал — просто пропускаем эту точку
   (короткий пробел на графике). Провал на графике всегда означает, что позиции реально закрыли.

Что это значит на практике в ближайший месяц: самые свежие свечи — полные (3/3), немного глубже
— бледные «Binance + Bybit» (Hyperliquid ещё не накопился), а старше 30 дней — пока бледный
«только Bybit», пока не подтянем архив Binance. И одно обязательство: историю Hyperliquid
нельзя скачать задним числом. **Если сервер не работает неделю, эта неделя навсегда останется
«без Hyperliquid»** — на графике она будет честно помечена, но заполнить её уже нечем.

---

## Sources

- Bybit V5: Get Open Interest, Get Tickers, Get Mark Price Kline, Rate Limit
  (<https://bybit-exchange.github.io/docs/v5/rate-limit>); queried live 2026-09-18.
- Hyperliquid: Info endpoint `metaAndAssetCtxs`; Rate limits and user limits
  (<https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits>);
  queried live 2026-09-18.
- Binance: as in chart-layouts §4.3/§11.1; `data.binance.vision` metrics CSV sampled 2026-09-18.
