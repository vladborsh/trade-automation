# Market page redesign — design and decomposition (2026-11-03)

**Author:** Architect (insight-bot stream) · **Input:** `market-page-redesign-2026-11-03.md` (brief,
master b86d100), the coordinator's source survey
(`reports/coordinator-market-data-sources-2026-11-03.md`), and the mockup the brief links. **Gate:**
IB-BUG-018 (COIN-M liquidations stored ~760× inflated) lands first; nothing here ships on top of it.
· **Output:** IB-084 … IB-093 and IB-100 in `tasks/insight-bot.jsonl`. **Amended 2026-11-03 late (owner, `reports/coordinator-ib091-scope-2026-11-03.md`):** IB-091 drops max pain and 25Δ skew; IB-093 is split into a dev/tester pre-check and a short owner look-through (IB-100).

## 1. The shape

```
period switch 1ч · 4ч · 24ч · 7д        live · updated 6 s ago      (no Refresh button)
┌ Главное сейчас ─ 3–5 ranked statements, each: number · compared with what · basis · → chart ┐
├ KPI strip ─ cap · BTC dom · F&G · liq 24h (L/S) · BTC OI · BTC funding, each Δ + context     ┤
├ Liquidations ─ hourly mirrored bars + norm line │ "where" diverging bars + verdict │ large:  ┤
│               bubble timeline + context cards   │ TradFi in its own line             │         │
├ Positioning ─ price×OI quadrant │ per-coin heat table (price, OI, funding, L/S, liq) + signal ┤
├ Market cap ─ treemap (area cap, colour 24h) │ dominance bar BTC/ETH/stables/alts           ┤
└ Derivatives & flows (phase 2) ─ DVOL · P/C (OKX) · stablecoin Δ · CB premium                  ┘
each block ends with one conclusion line
```

Server: one endpoint per block, each behind a box-wide cache, so N members do not mean N× venue calls
or N× heavy queries. Client: one scheduler polls each block at its own cadence and pauses on a
hidden tab.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Insights are server-side, rule-based, and live in `apps/insight-bot/src/insights/`, not under `web/`.** A rule is a pure function `(snapshot) → Statement \| null`. The engine runs every rule, drops refusals, ranks, and returns the top 5. The endpoint is `GET /api/web/market/insights?period=`. | Alerts are next in the user's queue and must reuse the same rules (brief §5). A rule under `web/` would be importable only by HTTP code. Pure rules get table specs: given this snapshot, say this or refuse. |
| D2 | **One scale for "how unusual": `rarity`, the empirical percentile of the current value within the rule's own reference sample** (0.5 = typical, 0.99 = rarer than 99 % of the sample). Statements rank by rarity, then by absolute size. A statement is shown only when rarity ≥ **0.90** and its sample meets the rule's minimum. | Rules compare different quantities (USD, %, ratios). A percentile is the one scale they share, and it survives the zero-heavy liquidation samples where a z-score explodes (the 1.4e14 z-score of IB-015). Liquidation `× norm` (`norm.ts`, median-based) stays as the **displayed** number; rarity only orders and gates. The thresholds are judgements, kept in one constants file and revisited after the box has a week of data. |
| D3 | **Every statement carries its basis, and a thin basis refuses** (derived-number rule): `{ window, venues, sampleWindows, observedWindows, from }`. The client renders "за 24ч · Binance+Bybit+OKX · норма: медиана 30 дн. (22 из 30 наблюдались)". Each rule declares a minimum: liquidation rules need `WEB_LIQUIDATION_MIN_HISTORY_DAYS` (7) of our own tape. OI, funding and price rules need ≥ 20 days, which the venue serves from day one (IB-080 read path, Binance `fundingRate` history, klines). | The box starts with no tape (archive dropped). For its first week every liquidation statement would otherwise be confident about nothing. OI, funding and price have venue history, so the page has conclusions on day one, just not liquidation ones. That limit is stated, not hidden. |
| D4 | **The server sends `{ key, params, basis, rarity, link }`; the client words it.** `key` is an i18n key. `params` are typed numbers, sides and symbols, formatted by the client. `link` is `{ route: 'instrument', symbol, timeSec }` or a block anchor. | The i18n rule: identifiers stay English, sentences are translated, with a spec on the meaning. The server never builds Russian strings, so the same rule can feed a Telegram alert in the member's language later. |
| D5 | **Rule set v1** (IB-086); phase-2 rules come with their sources (IB-091). | These are the mockup's four examples, generalised, plus three that need only data we already have. |
| | R1 liquidation surge by side, market-wide: `× norm` per side over the period. | |
| | R2 the coin with the most unusual liquidations (a USD floor stops a $40k alt from topping the list). | |
| | R3 a cascade: ≥ 3 same-side events, each ≥ $100k, within 10 min ("серия: 4 за 9 минут"), linked to that minute. | |
| | R4 OI vs price: \|ΔOI\| rare while \|Δprice\| is not, named by quadrant (new longs, new shorts, long closing, short closing). | |
| | R5 funding extremes: how many universe coins have funding beyond their own 30-day p95/p5, and the most extreme one. | |
| | R6 crowd vs top traders: the global account L/S and the top-trader **position** L/S on opposite sides of 1 with a rare gap. Both are already polled (`long_short_5m` kinds `global_account`, `top_position`). | |
| | R7 sentiment and breadth: F&G band, plus % of crypto universe up over the period, plus median alt change minus BTC change. Shown only when breadth or the alt gap is rare. | |
| D6 | **Crypto only (ruling 2026-10-31), TradFi separated, not hidden.** `config/universe.yaml` gains an explicit `asset_class: crypto \| tradfi`, required, no default. Symbols outside the universe (the liquidation stream carries all of them) are classed from Binance `exchangeInfo` (`underlyingType`/`underlyingSubType`, cached daily, shape pinned by a fixture). **If that field cannot separate commodities and equities from coins, fall back to a hand list in the YAML and say so; do not guess.** Crypto totals, norms, ranks and insights count crypto only. TradFi gets one line under "where": "TradFi (золото, нефть, индексы): $X, вне итогов". | The user asked for crypto only. The user also added TradFi perps by hand (IB-070). Hiding them would make that decision invisible. Mixing them in made XAU rank in the top-10 "where". A missing class must fail the build, not default to crypto. |
| D7 | **No new tables.** Everything new is cache-only. Positioning reads stored OI/LS (IB-080 path). The new sources (Deribit DVOL from 2021, DefiLlama stablecoins from 2017, Coinbase 1m candles, Binance funding history) all serve their own history, so "× norm" and rarity need no storage of ours. | The 2026-11-02 storage ruling. Each store is a decision against the 50 GB disk, and none is needed. If a phase-2 source turns out to keep no history (Deribit's put/call is a snapshot), the rule uses OKX's daily P/C series (survey #12) instead of us collecting one. |
| D8 | **Liquidation block (IB-084) extends `/api/web/liquidations/overview` with a `period`.** It adds: (a) `hourly`, market-wide long/short USD per bucket (1h buckets for 1h/4h/24h, 4h for 7d), with the per-bucket norm (`norm.ts` median for that bucket length) and the outlier buckets flagged; (b) `perCoin` gains `verdict` (`{ side, ratio } \| null`, ratio of that side vs the coin's own norm); (c) `large` events gain `xMedian` (vs the median single-event size over the norm period) and `seriesId` with `seriesCount` and `seriesSpanSec` (R3's grouping, reused); (d) `tradfi` totals (D6). Server cache 5 s per period. | One question, one call (IB-038's reason, still true). The cache bounds the DB at one query set per 5 s per period, however many members poll. |
| D9 | **Positioning (IB-085): `GET /api/web/market/positioning?period=`.** One row per crypto universe coin: price Δ, OI Δ, funding (current, from `premiumIndex`), global L/S, top-position L/S, liquidations USD. Each cell carries `rarity` vs the coin's own 30-day history of same-length changes. Each row carries `quadrant` and a one-word `signal` key (`squeeze`, `crowded_long`, `capitulation`, `quiet`, …; the vocabulary is a closed enum in the contract). Baselines are computed hourly and cached 1 h. The current values are cached 60 s. | One table answers "who is unusual right now" and its cells sort by rarity. A closed enum keeps signal words reviewable and translatable. |
| D10 | **KPI strip (IB-085): `GET /api/web/market/kpis`.** Six tiles, each `{ value, delta, deltaBasis ('24h' \| '7d'), context key + params }`. These are existing reads (market cards, overview, OI/LS, funding), not new calls. Cached 60 s. | The tiles repeat what the blocks already know, so they stay cheap and consistent with the blocks. |
| D11 | **Market cap (IB-087): `GET /api/web/market/caps`.** The treemap is the top 30 crypto by cap from CoinGecko `/coins/markets` (one call, cached 120 s like the existing CoinGecko gate). The dominance bar is BTC / ETH / stables / rest, from `/global`'s percentages plus the stablecoin share (USDT+USDC+… from the same `/coins/markets` call, `category=stablecoins`, or DefiLlama in phase 2). | It replaces the dry "market cap by coin" list. **Terms:** CoinGecko's free tier excludes commercial use, and this deepens a dependency we already have. That goes on the owner's list before the paid tier (§5), not into the build. |
| D12 | **Charts are hand-written SVG components with pure layout functions, no new chart library.** Mirrored bars, diverging bars, bubble timeline, quadrant scatter, squarified treemap and a dominance bar. Each layout (scales, squarify, bubble radius by √USD, collision-free labels) is a pure `.ts` with its own spec (AGENTS.md component rule). Time-series stays on lightweight-charts. | lightweight-charts cannot draw a treemap or a quadrant. A general library (ECharts, D3) is 100s of KB for six simple shapes, and we would fight its theming against the dark palette. SVG renders crisply on phones. |
| D13 | **Auto-refresh: one client `BlockScheduler` per page.** Liquidations every **10 s**, insights and KPIs every **60 s**, positioning every **60 s** (its baselines change hourly server-side), caps every **120 s**, phase-2 flows every **5 min**. Polling pauses on `document.hidden` and fires once on return. Back-off ×2 up to 5 min on an error, and the error is shown on that block only. The header shows "live · обновлено N с назад", the oldest block's age, turning amber past 2× its cadence. The Refresh button goes. | Cadence follows how fast each source changes (brief §6). Push (SSE) for liquidations is not needed at 10 s with a 5 s server cache. Revisit if members ask for tick-level. |
| D14 | **Period switch (1ч / 4ч / 24ч / 7д) is page-wide, in the URL (`?p=24h`)**, and every block's endpoint takes it. **7д** is offered for a block only where its data reaches 7 days. Liquidations need 7 days of box tape, so before that the button is disabled with "доступно с <date>". The 7-day liquidation `× norm` always refuses (`insufficient_history`): 30 days hold only four 7-day windows, which is not a norm. | Honest about the fresh box, and the period is shareable as a link. |
| D15 | **Each block ends with one conclusion line**, the highest-rarity statement from D1 whose rule belongs to that block (rules declare a `block`). If no statement passes, there is a neutral line ("ничего необычного за 24ч") with its basis. | One mechanism, not a second wording engine per block. |
| D16 | **Phone:** blocks stack in one column under 768 px; tables scroll inside their own box; the treemap and quadrant keep their aspect ratio; tap replaces hover for tooltips. Checked at **390 px** (the owner's phone viewport; amended 2026-11-03 after the owner found the current page cramped) in every client task, with a screenshot; IB-088 asserts no horizontal page scroll at 390×844 in e2e. | Brief §2.8. |
| D17 | **Old list components are deleted when their chart replaces them** (`liquidations-where`, `liquidations-feed`, the cap cards), along with their i18n keys (`no-literals.spec` parity). `liquidations-now` survives only as the KPI tile's data. | No dead UI, no orphan keys breaking the build. |
| D18 | **Amended 2026-11-04 (Tech Lead approved; dev-3, `reports/dev-3-IB-091-premium-usdt.md`).** **The Coinbase premium is measured against the dollar with USDT divided out:** `premium = CB BTC-USD ÷ (BN BTCUSDT × CB USDT-USD) − 1`. It is computed minute by minute, only on minutes where all three 1m closes exist. The hourly history for R10's rarity uses the same formula on the three 1h series. **There is no fallback to the raw difference:** a minute without USDT-USD is a missing minute, not a raw one. R10's "sustained ≥ 45 of 60 minutes" counts valid minutes only. With fewer than 45, the rule refuses (`insufficient_minutes`), and the tile shows the value with that reason instead of a sign. The tile's explanation line says «к доллару, с поправкой на USDT», so the definition is visible. | The raw `CB BTC-USD − BN BTCUSDT` mixes two things: US demand for BTC and USDT's own price against the dollar. One probe (60 minutes, 2026-11-04 ~03:20 UTC; a note, not a rule) gave −0.162 % raw against −0.014 % adjusted, with USDT at 0.9985. So over 90 % of the "discount" was USDT. A moving USDT basis would fire R10 as a US-demand event. A fallback would silently swap one quantity for another under the same label. Cost: +1 Coinbase call/min (USDT-USD 1m, 60 s cache) and +1/h; Binance unchanged. |
| D19 | **Amended 2026-11-04 (Tech Lead approved; dev-3, `reports/dev-3-IB-091-r9-check.md`).** **R9 and the stablecoin tile count supply in COINS:** DefiLlama `totalCirculating.peggedUSD` (units), never `totalCirculatingUSD` (supply × price). The rarity history uses the same series. The tile's label says «в монетах». | A de-peg must not read as a burn. With USDT at $0.95, the priced series falls about $9B with nothing burned, and R9 would put that at the top of the page. One fetch (a note): of a −$6.55B / 7d, $0.79B (12 %) was repricing (USDT at 0.9985). In units it was −$5.76B. |

## 3. Venue weight per minute (box-wide, after caches)

| Read | Source | Weight / calls |
|---|---|---|
| `premiumIndex` + `ticker/24hr` (existing universe summary, now shared with positioning and KPIs) | Binance fapi | 50 per min (unchanged) |
| Funding history baseline, 40 coins, refreshed every 8 h | Binance fapi `fundingRate` | ≈ 0.1 / min averaged |
| Klines 1h × 720 for price baselines, 40 coins, hourly | Binance fapi | 40 × 5 / 60 ≈ 3.3 / min |
| OI/LS baselines (IB-080 joined read, 1h period), 40 coins × 3 series, hourly | Binance `/futures/data` (separate limit) | ≈ 2 calls / min |
| `/coins/markets` + `/global` | CoinGecko (existing gate) | ≤ 1 call / min |
| Phase 2: Deribit DVOL (15 min) — book summary dropped with max pain/skew (owner, 2026-11-03) | Deribit public | < 0.1 / min |
| Phase 2: put/call by OI, daily series (60 min) | OKX rubik (public) | < 0.1 / min |
| Phase 2: DefiLlama stablecoins (60 min); Coinbase 1m candles BTC-USD + USDT-USD (D18) | keyless | ≈ 2 / min |

Binance fapi total ≈ **54 / 2400 per minute (2.2 %)**. That is arithmetic from documented weights; the
survey's own figures are single probes. Each server task states its measured figure from
`ib_binance_weight_used_1m` in its report.

### 3a. Redone against the box (2026-11-04)

**Measured:** median **90 / min** (mean ≈ 89, range 40–102), with one 400 in the minute of the hourly baseline rebuild. Two tabs on Market for 60 min, dev-3, `reports/dev-3-IB-093.md` item 2 and note A. The IB-096 watch on another occasion also gave a median of 90, so this is two occasions with 60 one-minute samples each. With no Market tab open it was 0–2 / min. **Population:** the gauge is Binance's own `X-MBX-USED-WEIGHT-1M` for the box's IP whenever a `/fapi/*` response is under a minute old (`BinanceWeightTracker`). `/futures/data/*` returns no such header (measured 2026-09-28, 5/5 on two occasions). So the 90 is **fapi weight only**, and dev-3's first candidate (the OI/LS `/futures/data` reads) cannot be in it.

**What the table above got wrong, by code reading (2026-11-04):**

| Line | Table said | Code does | fapi / min |
|---|---|---|---|
| Universe summary (`ticker/24hr` 40 + `premiumIndex` 10) | 50, "shared" | `UniverseSummaryService` holds **one** cached answer, keyed by the symbol list. Market asks it with two lists: positioning (30 crypto coins, 60 s) and KPIs (`[BTC]`, 60 s). Each request evicts the other's answer, so the venue is asked **twice a minute**. `universe.controller` makes a third list. | **≈ 100** (≈ 150 if a third list is asked every minute) |
| Price baselines, 1h klines | 40 × 5 / 60 ≈ 3.3 | 30 coins × one 1 500-row page at weight 10, hourly (`CandlesService`), all in one minute | median 0, ≈ 300 in the rebuild minute (the measured 400 with the rest of that minute) |
| Funding baselines | ≈ 0.1 | 30 × 1, hourly, with the klines | median 0 |

**Reconciliation:** two summary fetches a minute is ≈ 100. The trailing-minute header sometimes holds one fetch (≈ 50) and sometimes two (≈ 100), depending on how the 60 s timers fall. That fits the measured median of 90 and the 40–102 range. This is a prediction from code, not an attribution: one sample per minute cannot separate endpoints. **The check:** count `ticker/24hr` calls per minute on the box (log or `recordCall` per path). The arithmetic predicts 2.

**Same cause, outside the gauge:** each summary refresh also makes one `/futures/data/openInterestHist` call per listed symbol (31 per Market minute pair, ≈ 62 / min). This is against the separate `/futures/data` limit, alongside the OI/LS poller's average of 40 / min and positioning's ≈ 18 / min.

**Fix (filed by the Tech Lead from this note):** cache the symbol-less venue reads (`ticker/24hr`, `premiumIndex`) once per 60 s, independent of the list, and assemble each caller's rows from them. Cache the per-symbol OI by symbol. Expected after the fix, by arithmetic: fapi ≈ 50 / min median, which is the original design figure. `/futures/data` drops by ≈ 31 / min. A spec that can disagree: two callers with different lists within 60 s give exactly **one** `ticker/24hr` call. **Budget verdict either way:** 90 is 3.75 % of 2 400 and far under `WEIGHT_CEILING_1M` (1 800), so this is waste, not danger. Until the fix lands, IB-096's "weight must not rise" baseline is the measured 90, not 54.

## 4. Decomposition

All server tasks put **contracts first** (their first commit), so client tasks can start against
fixtures. Every task runs whole on its slot before merge.

| Task | What | Depends on |
|---|---|---|
| IB-084 | Liquidations block server: D6 classification, D8 overview extension | IB-BUG-018 |
| IB-085 | Positioning + KPI endpoints (D9, D10) and their baselines | IB-080 |
| IB-086 | Insight engine + rules R1–R7 + endpoint (D1–D5, D15) | IB-084, IB-085 |
| IB-087 | Caps endpoint (D11) | — |
| IB-088 | Client shell: period switch, `BlockScheduler`, live indicator, KPI strip, insights block, phone layout; Refresh button removed | IB-085, IB-086 (contracts) |
| IB-089 | Client liquidation charts: mirrored bars, diverging "where" + TradFi line, bubble timeline + context cards; old lists deleted | IB-084, IB-088 |
| IB-090 | Client positioning (quadrant, heat table) and caps (treemap, dominance bar) | IB-085, IB-087, IB-088 |
| IB-091 | Phase 2 sources (scope cut by the owner 2026-11-03: no max pain, no 25Δ skew): Deribit DVOL, put/call by OI from OKX rubik, DefiLlama stablecoins, Coinbase premium; "Derivatives & flows" block; rules R8 (DVOL spike), R9 (stablecoin supply Δ), R10 (Coinbase premium) | IB-086, IB-088 |
| IB-092 | Phase 2: cross-venue OI and funding (Bybit `tickers`, Hyperliquid `metaAndAssetCtxs`) as heat-table columns; rule R11 (funding spread across venues) | IB-085, IB-090 |
| IB-093 | Pre-check on the box by dev/tester (split 2026-11-03, owner ruling): hidden tab, weight with two tabs, 10 s liquidations, TradFi out of totals, every insight vs the charts, screenshots at 390 px and desktop, plain-Russian report | IB-089, IB-090, IB-096, IB-098 |
| IB-100 | Owner look-through (~15 min): phone on mobile data + laptop, the coordinator's checklist | IB-093 |

The critical path is IB-BUG-018 → IB-084 → IB-086 → IB-088 → IB-089. IB-085 and IB-087 can run in
parallel with IB-084 within the WIP cap of 2.

## 5. Owner list, not build (before the paid tier)

- **CoinGecko:** the free tier excludes commercial use. Either the paid Basic plan, or move caps and
  dominance to another source. This already affects data we show today.
- **alternative.me F&G:** attribution next to the figure is required. Check that the KPI tile and
  the card keep the source line with a link.
- **Exchange data terms** (Binance, Bybit, OKX, Deribit, Coinbase, Hyperliquid): read them for
  redistribution in a paid product. Showing derived indicators is common practice, but nobody has
  read the actual terms.
- **ETF flows:** no free keyless source exists. A SoSoValue free key is the candidate; its terms
  are unread.

## 6. Not now

LLM commentary, alerts (they will import `src/insights/`), news, paid sources, push/SSE for
liquidations, Hyperliquid liquidations (not public), token unlocks (no free source).
