# Brief — the Market page tells you what is happening (2026-11-03)

**Author:** coordinator (product session with the user) · **For:** Architect (insight-bot stream) —
design and decompose into `tasks/insight-bot.jsonl`. **Mockup:**
https://claude.ai/artifact/EP4UiUmAtNPdVm5b7GtPtQ (owner's private link; real numbers from
`insight_coord` at 2026-11-03 13:33 UTC, COIN-M rows excluded). **Data-source survey:**
`~/.claude/jobs/0028abca/tmp/reports/coordinator-market-data-sources-2026-11-03.md`.

## 1. What the user said (2026-11-03)

- The Market tab looks chaotic. It has no infographics.
- It has no insights: no useful conclusions drawn from "this pile of letters and numbers".
- These are uninformative dry lists: "where liquidations happen", "large liquidations", "market cap by coin".
- "Look at what else we can collect from sources for a fuller picture."
- The "Refresh" button is a joke: data must refresh itself on a period.

## 2. Direction (the mockup shows each)

1. **Conclusions first.** The top block is "Главное сейчас" (what matters now): 3–5 short statements.
   Each has a number, a "compared with what" (× norm, vs yesterday or a week ago) and a link to the
   chart at that moment. They are generated server-side from rules over data we already store,
   not by an LLM. They are ranked by how unusual they are. Examples in the mockup:
   - shorts liquidated 5× the hourly norm;
   - OI +26 % with a flat price;
   - the 03:00 long cascade;
   - fear 26 while alts fall harder than BTC.

   Design: the rule set, the norm each one uses (the
   existing liquidation `norm.ts` and feature-frame z-scores are the start), thresholds, wording
   (i18n rule: a member must understand it), and how a statement says its basis ("за 24ч, Binance").
   A derived number inherits the weakest basis: a statement over thin coverage says so or is not
   shown.
2. **A KPI strip** with a delta and a context line per tile. Tiles: market cap, BTC dominance,
   Fear & Greed, liquidations 24h with the long/short split, BTC OI, BTC funding.
3. **Liquidations as charts, not lists.**
   - Hourly mirrored bars: shorts up, longs down, with a norm line and a callout on outliers.
   - "Where": diverging long/short bars per coin, with a verdict ("лонги ×2.2", "шорты ×3.3").
   - "Large": a 24h bubble timeline (size = USD, above/below = side) plus cards with context
     (× median, "серия: 4 за 9 минут").
4. **Positioning.**
   - A price-vs-OI quadrant: new longs, new shorts, closing longs, closing shorts.
   - A per-coin heat table: price, OI, funding, L/S, liquidations, with cells coloured by
     unusualness and a one-word signal.
   - Each block ends with a one-line conclusion.
5. **Market cap as a treemap** (area = cap, colour = 24h change), a dominance bar
   (BTC / ETH / stables / alts), and a conclusion line.
6. **Auto-refresh.** The "обновить" button goes. Add a "live · updated N s ago" indicator. Polling
   periods per block match how fast the source changes: liquidations ~10 s or a push stream;
   OI/LS 5 min; caps and F&G minutes to hours. Pause when the tab is hidden. The venue-read budget
   stays per box (shared caches), so N members do not mean N× venue calls. State the weight/min.
7. **A period switch** (1ч / 4ч / 24ч / 7д) for the whole page. 7д only where we have the data.
8. **Phone.** It must read on a phone: blocks stack, tables scroll in their box.

## 3. More sources (survey, single probes 2026-11-03 13:32–13:36 UTC — numbers are notes)

Recommended keyless set, in the survey's priority:
- **Binance:** funding and top movers for the whole universe in two calls (≈50 weight/min), plus the
  top-trader long/short (position) ratio. `/futures/data/*` serves 30 days back only, so collect
  forward.
- **Bybit** `v5/market/tickers` and **Hyperliquid** `metaAndAssetCtxs`: cross-venue OI and funding
  in one call each. Hyperliquid liquidations are not visible publicly.
- **Deribit options:** DVOL (history from 2021), put/call by OI, max pain per expiry, 25-delta skew.
- **DefiLlama:** stablecoin supply and 1d/7d/30d change (keyless). Token unlocks there are paid.
- **Coinbase premium:** Coinbase BTC-USD vs our Binance spot, one call/min.
- **Not found free:** spot ETF flows. A free SoSoValue key is the candidate; terms unchecked.

**Storage ruling of 2026-11-02 applies.** Liquidations, OI/LS and calendar go into the DB;
everything else is cache-only unless the Architect argues a series needs history ("× norm" needs a
baseline). Each new store is a cost decision on the 50 GB disk.

**Terms (product goes paid):**
- CoinGecko's free tier excludes commercial use (paid Basic plan). That affects data we
  already show.
- alternative.me requires attribution next to the F&G figure.
- Exchange redistribution terms have not been read yet; that needs a read before the paid tier.
  Put this on the Architect's list, not the build.

## 4. Found while preparing this (filed separately)

- **P0 data bug, sent to TL:** Binance COIN-M liquidations (`BTCUSD_PERP` …) are stored as
  `price × qty`, while `qty` is contracts. They are about 760× inflated: 61 % of the 24h total, and
  a fake $68.6M single liquidation.
  `~/.claude/jobs/0028abca/tmp/reports/coordinator-coinm-liq-bug-2026-11-03.md`. The redesign
  must not ship on top of it.
- **Crypto only:** the liquidation stream includes Binance TradFi perps (CL, XAG, XAU, SOXL…). They
  rank in the top-10 "where". The 2026-10-31 ruling is crypto only: hide them or separate them.

## 5. Not now

LLM-written commentary, alerts (queued next in the user's order; insight rules here should be
reusable by alerts), news on this page (the "Today" page is queued), paid sources.
