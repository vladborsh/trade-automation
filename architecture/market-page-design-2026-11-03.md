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
| OI/LS baselines (IB-080 joined read, 1h period), 40 coins × 3 series, hourly | Binance `/futures/data`: weight 0, own limit 1 000 req / 5 min per endpoint (IB-BUG-030) | ≈ 2 calls / min |
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

**Same cause, outside the gauge:** each summary refresh also makes one `/futures/data/openInterestHist` call per listed symbol (31 per Market minute pair, ≈ 62 / min). This is against the separate `/futures/data` limit, alongside the OI/LS poller's average of 40 / min and positioning's ≈ 18 / min. **Amended 2026-11-04 (IB-BUG-030):** these calls cost weight **0**; the limit is **1 000 requests / 5 min per IP for each endpoint** (Binance docs, plus 8 clean runs on two occasions). Per endpoint, `openInterestHist` is the busy one: summary ≈ 150 / 5 min after IB-BUG-026 (one call per distinct symbol a minute), poller 30, the boot backfill ≈ 500 by arithmetic. That is ≈ 70–80 % in the worst case (backfill with a Market tab open), inside the limit, so no design change. It is the place to look first on a 429/418 from `/futures/data`.

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
| IB-106 | §7 row A: dashboard tokens (D22), self-hosted Plex fonts (D21, D23), card, header, KPI strip incl. `note` (D25) | — |
| IB-107 | §7 row B: «Главное сейчас» cards, `spark` (D24), R1–R10 wording (§7.4, D20) | — (merges after IB-106) |
| IB-108 | §7 row C: other blocks vs the mockup, «Вывод:» (D26) | IB-106 |
| IB-100 | Owner look-through (~15 min): phone on mobile data + laptop, the coordinator's checklist | IB-093, IB-106, IB-107, IB-108 |

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

## 7. Visual pass: the live page matches the mockup (2026-11-04)

**Input:** owner, 2026-11-04 (via `reports/coordinator-market-visual-gap-2026-11-04.md`). The question was «почему панели выглядят так сыро и не как в дизайне?». The Tech Lead's brief is `reports/tl-architect-market-visual-gap.md`.

**Root cause.** The mockup was a private claude.ai artifact that no agent could open. The page was built from text, and IB-093 accepted behaviour, not looks. The mockup is now in git: `architecture/mockups/market-2026-11-03/`:
- `mockup-desktop.png` (1440);
- `mockup-phone.png` (390);
- `Main.dc.html` with `support.js`, which open in a browser as a standalone renderer;
- `live-2026-11-04.png`, the owner's screenshot.

The heat table in the render is empty because of a renderer gap. Ignore that block.

**Mockup vs later rulings.** The mockup is dated 2026-11-03 and predates three owner rulings. The rulings win:
- IB-103: Market shows a compact top-5 plus «Вся таблица →», and the quadrant lives on `/positioning`.
- IB-102: the F&G gauge.
- IB-101: the where-block folds at 8 coins.

The mockup's explanation sentences also make forecasts, such as «так часто бывает перед резким движением». We have no measured hit-rate for any of them. **D20 replaces them with what the number means, never what it predicts.**

### 7.1 Decisions

| # | Decision | Why |
|---|---|---|
| D20 | **The explanation line says what the number means mechanically, never a forecast.** Per-rule templates are in §7.4. Rarity is spoken as «реже, чем 1 раз из 10 для этой монеты за 30 дней» (that is D2's 0.90). | A sentence like «перед резким движением» is a claim about the future with no measured hit-rate. That is the overclaim the derived-number rule exists to stop. A sentence that explains what funding or a liquidation *is* stays true. |
| D21 | **Fonts are self-hosted.** IBM Plex Sans covers text and IBM Plex Mono covers numbers only. Files: Fontsource 5.3.0 woff2, OFL licence committed beside them, no npm dependency. `font-display: swap` and `unicode-range` per subset. **Bytes (measured on the 5.3.0 files):** Sans 400/600/700 × latin + cyrillic = **114 084 B**; Mono 400/600 latin = **30 328 B**; total **≈ 141 KiB**, each file fetched only when a glyph in its range is used, and cached after that. Mono is latin-only on purpose: digits, `$ % × −` (U+2212) and `.` are all in it, and words never use mono. | A member's page then makes no third-party request, so there is no Google request carrying their IP and nothing to list in a privacy note. The cost is one ~141 KiB first load. |
| D22 | **Tokens apply to the insight-dashboard only.** `projects/insight-dashboard/src/dashboard-tokens.css` is imported by its `styles.css` *after* the shared `src/design-tokens.css`. It adds dashboard aliases (§7.2) and redefines nothing in the shared file. chart-client is untouched. | The shared palette already holds every primitive except `#e6edf3`. One file per app keeps the backtest SPA's look out of scope. |
| D23 | **Body text is sans with `font-variant-numeric: tabular-nums` set on `body`. A global `.num` class (mono, tabular) marks headline figures only.** These are KPI values, insight-title figures, table cells, axis labels and the large-card amounts. | Every other page (instrument, calendar, admin) then keeps aligned digit columns with no per-page edit. The font switch is dashboard-wide, so row A screenshots those pages too (regression check, not a redesign). |
| D24 | **One new field on an insight statement: `spark`.** Everything else a card shows comes from fields that already exist: topic, when, link label, explanation params. No new endpoint, no venue call, no boot work (§7.3). | IB-096 traded memory for latency. A spark taken from a series the rule already reads costs a few numbers per statement (≤ 5 × 30). |
| D25 | **One new field on a KPI tile: `note`** (a closed key plus params). The inline delta, the mini bar and the muted source are client-side from existing fields (§7.5). | Only three notes need data the tile does not already carry. Each comes from a fetch the KPI service already makes, except BTC account L/S (§7.5), which costs **weight 0**. |
| D26 | **«Вывод:» lines keep their source and semantics:** each block's `blocks[]` line from `/insights`, with IB-BUG-022's 7d reason and IB-BUG-028's `source_unavailable` unchanged. Only the look changes: a bold «Вывод:» prefix, 13 px text, and the basis moved into the tooltip. The mockup's hand-written multi-fact conclusions are **not** built. They would be a second wording engine, which D15 ruled out. | One mechanism, already reviewed. |

### 7.2 Visual tokens (`dashboard-tokens.css`, CSS custom properties)

Values are read from `Main.dc.html`. The names are fixed here, so rows B and C can use them before row A merges.

```css
:root {
  /* type */
  --font-sans: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-num:  'IBM Plex Mono', ui-monospace, monospace;
  --color-text-strong: #e6edf3;            /* titles, KPI values (new primitive) */
  --type-h1: 700 26px/1.2 var(--font-sans);           /* «Рынок» */
  --type-h2: 600 16px/1.35 var(--font-sans);          /* block headings, insight titles */
  --type-body: 400 14px/1.45 var(--font-sans);        /* page text */
  --type-note: 400 13px/1.45 var(--font-sans);        /* explanations, subtitles: colour --color-muted */
  --type-small: 400 12px/1.4 var(--font-sans);        /* chips' "when", tile labels and notes, basis */
  --type-micro: 400 11px/1.3 var(--font-sans);        /* axis labels (with .num), attribution */
  --type-kpi: 600 24px/1.2 var(--font-num);
  --caps-section: 600 13px/1.2 var(--font-sans);      /* «ГЛАВНОЕ СЕЙЧАС»: uppercase, letter-spacing .08em, muted */

  /* layout */
  --page-max: 1360px;  --page-pad: 24px;  --page-pad-phone: 16px;   /* ≤ 480 px */
  --section-gap: 24px; --card-gap: 12px;

  /* card: every block */
  --card-bg: var(--gray-900);  --card-border: var(--gray-700);  --card-radius: var(--radius-lg); /* 8px */
  --card-pad: 16px;  --tile-pad: 14px 16px;  --card-inner-gap: 10px;

  /* chips (topic tags): 11px/600 uppercase, letter-spacing .04em, padding 2px 8px, radius 4px */
  --chip-long-bg: #3d1515;  --chip-long-fg: var(--red-500);
  --chip-short-bg: #0f3d38; --chip-short-fg: var(--teal-500);
  --chip-liq-bg: #3a2414;   --chip-liq-fg: var(--orange-400);   /* liquidations, no side (R2) */
  --chip-pos-bg: #3d2e0b;   --chip-pos-fg: var(--amber-500);
  --chip-sent-bg: #1a2b44;  --chip-sent-fg: var(--blue-400);
  --chip-flows-bg: #2a1f3d; --chip-flows-fg: var(--purple-400);
  --chip-caps-bg: var(--gray-800); --chip-caps-fg: var(--gray-200);

  /* controls */
  --seg-border: var(--gray-700); --seg-radius: var(--radius-md); --seg-active-bg: var(--gray-800);
  --seg-pad: 8px 14px; --touch-min: 40px;    /* IB-088's ≥ 40 px, not the mockup's 36 */
  --pill-radius: var(--radius-full); --live-dot: var(--teal-500); --stale-dot: var(--amber-500);
  --link: var(--blue-400); --link-hover: #79b8ff;   /* no underline; underline on focus-visible only */
  --bar-track: var(--gray-800); --bar-h: 6px; --bar-radius: 3px;
  --spark-h: 34px; --spark-gap: 3px; --spark-radius: 2px; --spark-opacity: .85;
}
```

**Card spec (every block).**
- Box: `--card-bg` fill, a 1 px `--card-border` border, `--card-radius`, `--card-pad`.
- Inside, a column: heading row, content, then «Вывод:».
- Heading row: `h2` in `--type-h2` followed by a muted subtitle in `--type-note`, wrapping. Right-side controls (the threshold select, «Показать все») go at the end of the row.
- Blocks sit `--card-gap` apart inside a section and `--section-gap` apart between sections.
- Page: `max-width: --page-max`, centred. Padding is `--page-pad`, or `--page-pad-phone` at ≤ 480 px.

**Header.** The order is:
1. `h1` «Рынок»;
2. the live pill: a teal dot and «В реальном времени · обновлено N с назад», amber dot past 2× cadence (D13);
3. a flexible spacer;
4. the segmented period switch, with buttons at least `--touch-min` high.

«7д: доступно с …» moves into the 7д button's tooltip and `aria-describedby` text, not a line under the switch. **Section order:** «Главное сейчас» first, then the KPI strip.

### 7.3 «Главное сейчас»: the card and its contract

**Grid:** `repeat(auto-fit, minmax(300px, 1fr))`, gap `--card-gap`. That gives 4 across at 1360 and 1 column at 390. The fifth statement, when there is one, wraps.

**Card**, top to bottom:

| Element | Look | Source |
|---|---|---|
| Topic chip + when | chip (§7.2) + `--type-small` muted | **Chip:** from `block`. liquidations → «Ликвидации», coloured by `params.side` (long/short), or `--chip-liq-*` when there is no side. positioning → «Позиции». sentiment → «Настроение». flows → «Потоки». caps → «Капитализация». **When:** from `link.timeSec` when the link has one, «сегодня 03:00 UTC» (or «вчера …»). R10 shows «последний час». R9 shows «за сутки» or «за неделю» from `days`. Everything else shows `basis.window` («за 24ч»). Client-only. |
| Title | `--type-h2`, `--color-text-strong`; figures in `.num` | the rule's title template (§7.4) |
| Explanation | `--type-note`, muted, ≤ 2 lines at 1440 | the rule's explanation template (§7.4), D20 |
| Spark | bars, `--spark-*` tokens, colour = chip fg. A signed series draws from a zero line. The bar at `spark.highlight` is at full opacity. `aria-hidden`. | **`spark`, new** (below) |
| Link | `--type-note`, `--link`, «… →» | label from `link` (below) |
| Basis | `--type-small`, muted: «за 24ч · Binance» | `basis.window` + `basis.venues` (spelled as names, IB-BUG-033). The **sample sizes and `from` go into `title=`/tooltip**: «норма: 697 окон с данными из 697, с 2026-10-05». |

**Contract change (the only one, D24).** In `WebInsightStatementSchema`:

```ts
/** D24: the series behind the statement for the card's mini-chart — numbers the rule already read. */
spark: z.object({
  values: z.array(z.number()).min(2).max(30),
  /** Index of the bar the statement is about (the cascade's hour, "now"), or null. */
  highlight: z.number().int().nonnegative().nullable(),
}).nullable(),
```

`null` is allowed and honest: the rule had no series in hand. **No rule fetches anything for a spark.**

| Rule | Spark values | Already held where |
|---|---|---|
| R1 | the named side's hourly USD, last ≤ 24 bars of the period; highlight = last | the liquidations overview's `hourly` bars (IB-084), which are in the same call the liquidations port already makes. The port adds `bars: {long, short}[]` to `InsightSnapshot.liquidations`. |
| R2 | the coin's own sample of period USD, last ≤ 14 windows, then the current one; highlight = last | `coins.get(symbol).sample` (already in the snapshot) |
| R3 | the market's hourly bars of the cascade's side over the period; highlight = the cascade's hour | the same `bars` as R1 |
| R4 | the coin's hourly OI, last 24 points (≤ 1 h stale; the title's figure is current) | positioning's hourly baseline read (IB-080 joined, 1 h period, cached 1 h). The service keeps the last 24 points per coin (30 × 24 numbers) and exposes them on the row's server-side twin, **not** on `WebPositioningRow`. |
| R5 | the coin's last 21 funding settlements (7 days at 8 h); highlight = last | the funding baseline (30 days per coin) the positioning service already holds for the rarity |
| R6 | the coin's global account L/S, last 24 hourly points | the L/S baseline read, as R4 |
| R7 | share of coins up, last 24 hourly values (signed: alt gap), highlight = last | `breadth.upShareSample` / `altGapSample` tails (snapshot) |
| R8 | `flows.dvol.series` (last ≤ 30) | the flows payload (IB-091) |
| R9 | `flows.stablecoins.series` (last 30 days) | the flows payload |
| R10 | `flows.coinbasePremium.series`, 60 minutes averaged into 30 two-minute values (signed) | the flows payload |

**Memory:** the R4 and R6 tails are 2 × 30 × 24 = 1 440 numbers, a few tens of KB. Nothing else is newly held.

**Link labels** (client, from the existing `link`). `base` is the symbol with its quote suffix stripped, by a pure helper with a spec.
- `instrument`, `timeSec` null → «Открыть {base} на графике».
- `instrument`, R4 (`timeSec` = the period start) → «Открыть {base} за {window}».
- `instrument`, any other `timeSec` → «Открыть {base} в {HH:MM} UTC».
- anchors:

| Anchor | Label |
|---|---|
| `liquidations` | «К ликвидациям ↓» |
| `positioning` | «К позициям ↓» |
| `sentiment` | «Подробнее о настроении ↓» |
| `flows` | «К деривативам и потокам ↓» |
| `caps` | «К капитализации ↓» |

The generic «к графику» goes.

**Nothing passed.** One card with the chip of the block that would have spoken, the existing neutral sentence (`insight.neutral.*`, unchanged), and the basis in the tooltip. Raw period codes never render («24h» → «24ч», IB-093 item 4a).

### 7.4 R1–R10 in member language (title + explanation, ru / en)

Placeholders are the rule's existing params, plus three derived on the client:
- `{base}`;
- `{norm}` = `usd / ratio` (omitted with its clause when `ratio` is null);
- `{window}` from `basis.window` («24ч» / «24h»).

Signs and sides choose the variant. Numbers use the existing formatters: `$25M`, `+7.3%`, `−0.039%`.

**Worked examples:**
- **Today** marks a live statement from 2026-11-04: the owner's screenshot, or dev-3's IB-093 snapshot.
- **Illustrative** marks a rule that has not spoken on the box yet. R1–R3 refuse until 2026-11-10 (7 days of tape), and R6, R7, R8 and R10 have not fired. Those examples use the mockup's 2026-11-03 numbers, or plausible ones.

**R1 `liq_surge` {side, usd, ratio}**
- ru title: «Выносит {лонги|шорты}: {usd} за {window} — {ratio}× обычного»
- ru expl: «Обычно за {window} ликвидируют около {norm} {лонгов|шортов}. Ликвидация — биржа сама закрывает позицию, когда у трейдера кончается залог; волна ликвидаций значит, что цена резко шла против этой стороны.»
- en title: «{Longs|Shorts} wiped out: {usd} in {window} — {ratio}× normal»
- en expl: «About {norm} of {longs|shorts} are liquidated in a normal {window}. A liquidation is the exchange closing a position whose collateral ran out; a wave of them means price moved hard against that side.»
- *Illustrative (mockup, 2026-11-03):* «Выносит шорты: $25M за 4ч — 5× обычного» / «Обычно за 4ч ликвидируют около $5M шортов. …»

**R2 `liq_coin` {symbol, usd, ratio}**
- ru: «{base}: ликвидаций на {usd} за {window} — {ratio}× обычного для монеты» / «Обычно по {base} за {window} ликвидируют около {norm}. Среди монет с ликвидациями от $250k это самое необычное значение для своей истории.»
- en: «{base}: {usd} liquidated in {window} — {ratio}× its normal» / «A normal {window} for {base} is about {norm}. Among coins with at least $250k liquidated, this is the most unusual against its own history.»
- *Illustrative:* «ETH: ликвидаций на $16M за 24ч — 4× обычного для монеты».

**R3 `liq_cascade` {side, count, minutes, usd, symbol}**
- ru: «Каскад ликвидаций {лонгов|шортов} за {minutes} мин: {count}, всего {usd}» / «Крупные ликвидации (от $100k) шли одна за другой, больше всего по {base}. За эти минуты вынесло больше, чем за большинство целых часов недели.»
- en: «Cascade of {long|short} liquidations in {minutes} min: {count}, {usd} in total» / «Large liquidations (from $100k) came one after another, mostly on {base}. These minutes outweighed most whole hours of the week.»
- *Illustrative (mockup):* «Каскад ликвидаций лонгов за 9 мин: 21, всего $14M» → «Открыть BTC в 03:00 UTC».
- *Reworded 2026-11-04 (TL review of IB-107, dev-3):* the count stands after a colon, so no noun has to agree with it (Russian «1 ликвидация / 2 ликвидации / 5 ликвидаций» would need plural forms).

**R4 `oi_vs_price` {symbol, quadrant, oiPct, pricePct}**
- ru title: «{base}: открытый интерес {oiPct} при цене {pricePct}»
- ru expl: «Для {base} такое изменение открытого интереса за {window} — редкость, а цена в обычных пределах.» followed by one quadrant sentence:

  | Quadrant | ru | en |
  |---|---|---|
  | `new_longs` | «Цена выше — скорее набирают лонги.» | «Price is up — more likely new longs.» |
  | `new_shorts` | «Цена ниже — скорее открывают шорты.» | «Price is down — more likely new shorts.» |
  | `long_closing` | «Позиций меньше при падении — скорее закрывают лонги.» | «Fewer positions on a fall — more likely longs closing.» |
  | `short_closing` | «Позиций меньше при росте — скорее закрывают шорты.» | «Fewer positions on a rise — more likely shorts closing.» |

- en title: «{base}: open interest {oiPct} with price {pricePct}»
- en expl: «For {base} a change in open interest like this over {window} is rare, while price stayed within its usual range.» + the quadrant sentence.
- *Today (owner's screenshot):* «LTC: открытый интерес +7.3% при цене +0.3%» / «Для LTC такое изменение открытого интереса за 24ч — редкость, а цена в обычных пределах. Цена выше — скорее набирают лонги.» → «Открыть LTC за 24ч».
- *Today (IB-093):* «TRUMP: открытый интерес +6.9% при цене −5.7%» / «… Цена ниже — скорее открывают шорты.»

**R5 `funding_extremes` {count, total, symbol, rate}**. Rewritten: the coin is the subject, not the count.
- ru title: rate < 0 → «{base}: шорты доплачивают лонгам {rate} — необычно много»; rate > 0 → «{base}: лонги доплачивают шортам {rate} — необычно много»
- ru expl: «Фандинг — плата между лонгами и шортами, которая держит цену фьючерса у спота. {Отрицательный: шортов больше, и они платят | Положительный: лонгов больше, и они платят}. Для {base} такая ставка бывает реже, чем 1 раз из 10 за 30 дней.» Then, when `count` > 1: « Так же необычно ещё у {count−1} из {total} монет.»
- en: «{base}: shorts pay longs {rate} — unusually high» / «Funding is the payment between longs and shorts that keeps the futures price near spot. {Negative: shorts outnumber longs and pay | Positive: longs outnumber shorts and pay}. For {base} a rate like this happens less than 1 time in 10 over 30 days.» + « Equally unusual on {count−1} more of {total} coins.»
- *Today:* «TRUMP: шорты доплачивают лонгам −0.039% — необычно много» / «… Так же необычно ещё у 1 из 30 монет.» → «К позициям ↓».

**R6 `crowd_vs_top` {symbol, global, top}**
- ru title: global > 1 → «{base}: толпа в лонгах, крупные трейдеры — в шортах»; global < 1 → the mirror.
- ru expl: «Лонги к шортам: по числу счетов {global}, у топ-трейдеров по объёму позиций {top} (1 — поровну). Для {base} такое расхождение — редкость.»
- en: «{base}: the crowd is long, top traders are short» / «Longs to shorts: {global} by account count, {top} by top traders' position size (1 = even). For {base} a split like this is rare.»
- *Illustrative:* «ETH: толпа в лонгах, крупные трейдеры — в шортах» / «… по числу счетов 2.6, у топ-трейдеров 0.8 …».

**R7 `breadth` {upPct, altGapPct, fngBand}**
- ru title: «Рынок: растут {upPct}% монет, альты {обгоняют|отстают от} BTC на {|altGapPct|} п.»
- ru expl: «Такая картина по всему рынку за {window} — редкость за последние 30 дней.» Then, when `fngBand` is set: « Индекс страха и жадности: {страх|…}.»
- en: «Market: {upPct}% of coins up, alts {ahead of|behind} BTC by {|altGapPct|} pts» / «A market-wide picture like this over {window} is rare for the last 30 days. Fear & Greed: {band}.»
- *Illustrative (mockup):* «Рынок: растут 12% монет, альты отстают от BTC на 1.9 п.» / «… Индекс страха и жадности: страх.»

**R8 `dvol_spike` {value, change}**
- ru: «Опционы BTC подорожали: ожидаемая волатильность {value} (+{change})» / «DVOL — сколько движения на год вперёд закладывают цены опционов BTC на Deribit. Опционы дорожают, когда участники ждут сильного движения — в любую сторону. Такой рост за {window} — редкость.»
- en: «BTC options got pricier: implied volatility {value} (+{change})» / «DVOL is how much movement over a year BTC option prices on Deribit imply. Options get pricier when traders expect a big move — either way. A rise like this over {window} is rare.»
- *Illustrative:* «Опционы BTC подорожали: ожидаемая волатильность 52 (+6.1)».

**R9 `stablecoin_supply` {usd, pct, days}**. Rewritten.
- ru title: usd < 0 → «Стейблкоинов стало меньше на {|usd|} за {сутки|неделю}»; usd > 0 → «Выпущено стейблкоинов на {usd} за {сутки|неделю}»
- ru expl: < 0 → «Погашение: монеты сдали эмитенту и вывели доллары — эти деньги ушли из крипты.»; > 0 → «Выпуск: кто-то внёс доллары и получил монеты — этими деньгами покупают крипту.» Both continue: « Это {pct} всех стейблкоинов; считаем монеты, а не их цену (D19).»
- en: «Stablecoin supply shrank by {|usd|} in {a day|a week}» / «Issued: {usd} of stablecoins in {a day|a week}» + «Redeemed: coins were returned to the issuer for dollars — that money left crypto.» / «Minted: someone deposited dollars for new coins — that is money crypto is bought with.» + « That is {pct} of all stablecoins; we count coins, not their price.»
- *Today:* «Стейблкоинов стало меньше на $911M за сутки» / «Погашение: … Это −0.31% всех стейблкоинов; считаем монеты, а не их цену.» → «К деривативам и потокам ↓».

**R10 `coinbase_premium` {pct, minutes}**
- ru title: pct > 0 → «BTC на Coinbase дороже, чем на Binance: {pct}»; pct < 0 → «… дешевле …»
- ru expl: «Держалось {minutes} мин из последнего часа. Coinbase — главная площадка покупателей из США, в том числе фондов; разницу считаем к доллару, убрав курс USDT. Такая премия — редкость за последние недели.»
- en: «BTC on Coinbase above Binance: {pct}» / «… below …» + «It held for {minutes} of the last 60 minutes. Coinbase is where US buyers, funds included, trade; the gap is measured against the dollar with USDT taken out. A premium like this is rare for recent weeks.»
- *Illustrative:* «BTC на Coinbase дешевле, чем на Binance: −0.05%» / «Держалось 52 мин из последнего часа. …»

The no-literals i18n spec covers every key and both languages. A spec per rule asserts the variant chosen by sign and side.

### 7.5 KPI strip

**Grid:** `repeat(auto-fit, minmax(200px, 1fr))`, gap `--card-gap`. Tiles fill the row: six across at 1360, one column at 390, as in the mockup.

**Tile layout:**
1. label (`--type-small`, muted);
2. value (`--type-kpi`, `.num`) with the inline delta beside it (13 px; up, down or muted);
3. a 6 px bar track;
4. a note (`--type-small`, muted);
5. attribution (`--type-micro`, muted).

| Tile | Inline delta | Bar | Note | Data |
|---|---|---|---|---|
| Капитализация | `delta` % (± colour) | empty track | — | payload has it |
| Доля BTC | `delta` «+0.4 п.» | BTC % of 100, amber | «ETH {ethPct}%» | **`note: kpi.note.eth_share {ethPct}`**: `cards.dominance.ethPct`, already in the CoinGecko `/global` fetch the KPI service makes |
| Страх и жадность | band word in its zone colour | value of 100, zone colour (IB-102's zones) | «вчера {y} · неделю назад {w}» | **`note: kpi.note.fng_history {yesterday, weekAgo}`**: `cards.fearGreed.previous` / `.weekAgo` (IB-102), the same fetch. Either may be null, and that half of the note is then omitted. |
| Ликвидации 24ч | — | split, long red / short teal | «лонги {l}% · шорты {s}%» | `split`, already there |
| Открытый интерес BTC | `delta` % | empty track | «Binance, за 24ч» | source + `deltaBasis`, already there |
| Фандинг BTC | side word, muted («платят лонги») | empty track | «лонги/шорты по счетам {ratio}» | **`note: kpi.note.ls_accounts {ratio}`**: the last BTC global-account L/S point. This is `oiLs.longShort(btc, 'global_account', now − 2h, now)`, **one `/futures/data` request a minute at most** (KPI cache 60 s). That is weight 0 and 5 of `globalLongShortAccountRatio`'s 1 000 / 5 min (0.5 %). It is the only new read in this pass, and it is soft: null leaves no note. |

**Contract (D25).** `WebKpiTileSchema` gains:

```ts
note: z.object({ key: z.enum(['kpi.note.eth_share', 'kpi.note.fng_history', 'kpi.note.ls_accounts']), params: z.record(z.string(), z.number().nullable()) }).nullable()
```

`context` keeps its meaning and now renders inline.

**Sources.**
- Each tile's `source` goes into the label's tooltip.
- Visible attribution stays only where the terms ask for it: alternative.me on F&G, a link of 11 px muted text (§5), and CoinGecko on the cap and dominance tiles (§5, pending the owner's terms check).
- Binance sources are tooltip-only.
- No underlines.

### 7.6 The other blocks vs the mockup

Every block below gets the §7.2 card, an `h2` + subtitle heading row, and «Вывод:» per D26.

| Block | Gaps to close | Not built (and why) |
|---|---|---|
| **Liquidations** | **Split into three cards.** «Ликвидации по часам» (`flex: 999 1 560px`) and «Где ликвидируют» (`flex: 1 1 380px`) go side by side; «Крупные ликвидации» gets its own full-width card.<br>**Hourly:** height 240 px. Two callouts drawn client-side from the bars: the largest bar («03:00 · лонги $14.4M · 9× норма») and the last bar («сейчас · шорты $11.3M/ч»). «× норма» appears only when the overview has a norm, which it lacks until 2026-11-10. Below the chart: a `.num` axis and the legend «Шорты $X · Лонги $Y». The «нажмите на столбец» help line moves to the tooltip.<br>**Where:** red «лонги» and teal «шорты» column heads; per-row bars without $ labels (the amounts go to the tooltip); a verdict column «лонги ×2.2 / шорты ×3.3 / поровну» from a pure `sideVerdict(long, short)` (≥ 1.5×, spec). IB-101's fold and the TradFi/unmapped lines are kept, in `--type-small`.<br>**Large:** bubble chart, then context cards 4 across (`minmax(240px,1fr)`), folded at 8 with IB-101's `collapseRows` and «Показать все (N)». The cards keep IB-089's context lines. | The venue split («Binance 81% · Bybit 11% · OKX 8%») needs a per-venue total the overview does not carry. That is a contract field, so not in this pass. The threshold select changes a query, which is behaviour: the static «от $100k» stays. |
| **Positioning (Market)** | IB-103's compact top-5 + «Вся таблица →» in a card. The heading becomes «Кто набирает позиции» with the subtitle. Heat cells use mockup-style fills and `.num` values. | The quadrant stays on `/positioning` (IB-103 ruling, which postdates the mockup). |
| **`/positioning` page** | The same card, tokens, heading row and quadrant chip styles as the mockup's quadrant (pills, teal or red by quadrant). | — |
| **Caps** | **Treemap full width**: tile labels `--type-h2` for the top 2 and 13 px for the rest, value line `.num`. Fill: IB-090's scale with the mockup's endpoints (deep red `#b3302c`, deep teal `#1f8a7e`, centre `--gray-800`), scale unchanged.<br>**Dominance bar beneath the treemap**, full width, labels inside the segments («BTC 59.3%», «ETH 10.6», «стейблы 9.5», «альты 20.6»), with «Доли всего рынка $2.62T» above it. The side legend goes. | Whether stablecoins belong in the treemap is a content question, not a visual one. They stay. |
| **Fear & Greed** | IB-102's gauge and 30-day line inside a card, sized to the content: not full width at 1440, sitting beside «Деривативы и потоки» when both fit (`flex: 1 1 380px`). Words below in `--type-note`. | — |
| **Деривативы и потоки** (IB-091) | Four tiles as KPI-style sub-tiles: value `.num`, spark from each tile's `series`, source muted. | — |
| **Footer / help text** | Explanatory lines («Цвет — насколько необычно…») go to `--type-small` muted, under the content, never above. | — |

### 7.7 Rows

- **IB-106 (A):** tokens, fonts, cards, header, KPI strip, including the KPI `note`.
- **IB-107 (B):** «Главное сейчас», including `spark` and the R1–R10 wording.
- **IB-108 (C):** the other blocks and «Вывод:».

**Overlap.**
- A and B run in parallel. They share only `i18n/ru.ts`, `en.ts` and `keys.ts` (different keys) and `market.component.html` (A reorders the sections; B touches only its own component).
- B uses the token names fixed in §7.2 and rebases on A before its screenshots.
- C depends on A (the card).
- IB-100 waits for all three.
- **One deploy** after all three are merged.
