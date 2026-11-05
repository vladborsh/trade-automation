# Brief — large-liquidation, funding and price-level alerts (2026-11-05)

**Author:** coordinator. This was a grilling session with the owner, and every decision below is the owner's.
**For:** Architect (insight-bot stream). Design it and decompose it into `tasks/insight-bot.jsonl`.

**Builds on:** the OI divergence alerts:
- `architecture/oi-divergence-alerts-2026-11-04.md`;
- `architecture/oi-divergence-design-2026-11-04.md` (V1–V33).

Reuse what that stream built:
- `alert_symbols` and the `/admin/alerts` page;
- `alert_settings`, the per-type recipient setting and `TelegramSender.sendTo`;
- the `?at=&tf=` link;
- the journal with price paths (IB-115);
- the BUILD_SHA stamp.

**Priority (owner):** the Market round 2 redesign (`~/.claude/jobs/0028abca/tmp/reports/coordinator-market-feedback-2-2026-11-05.md`) is built **first**. This stream is designed now and built after it, in the order of §5.

## 1. Common rules (all three types)

- **Recipients:** the owner only at first.
  - Members later opt in **per alert type**. The setting is off by default and hidden until the owner says so, built like the OI setting (V13).
- **Settings:** per coin and per type in `/admin/alerts`: an on/off switch plus that type's thresholds. Changes apply without a deploy.
  - The coin list is the existing `alert_symbols` (BTC, ETH, SOL, BNB, TRX). A coin added there auto-joins the data the alert needs.
- **Message:** every message links to the instrument page at that moment (`?at=`, TF preselected).
  - **No forecasts** in any text.
  - The i18n rule applies (identifiers stay English, sentences are translated).
- **Journal:** every fired alert goes in the journal with its 4/24/72 h price path, reusing the IB-115 path measurer and the BUILD_SHA stamp.
  - Controls and near-misses are the Architect's call per type. Say what the baseline would be.
- **Before launch, for each type:** run it over our stored history, as IB-111 did for OI. Show the owner:
  - how many alerts a week the defaults would give;
  - 5–10 examples on charts.

  The owner then sets the final thresholds.
- No new «Главное сейчас» cards. Market already has cards for liquidations and funding.
- No browser push, no quiet hours.

## 2. Large liquidations (first)

- **Detection:** the **sum** of liquidations per coin per side (longs / shorts) over a **5-minute** window reaches the coin's threshold.
  - Not a single order: Binance publishes at most one liquidation per second per symbol, so single prints undercount.
  - The window type (sliding vs fixed buckets) is the Architect's call. State how a cascade across a bucket edge is handled.
- **Venues:** Binance + Bybit + OKX **summed**. The message shows the split per venue.
  - It also shows the total, the count and the largest single liquidation.
- **Default thresholds** (5 min, all venues): BTC $5M, ETH $3M, SOL $1M, BNB $300k, TRX $300k. Editable per coin.
- **Anti-spam:**
  - After an alert, stay quiet for **30 minutes** on that coin and side.
  - Exception: if the running sum reaches **2× the threshold** within those 30 minutes, send one short «продолжается: уже $X».
- **Source:** our liquidation tape (already collected). It adds no venue weight. State the evaluation loop's cost (DB reads per minute, memory; the IB-096 heap cap stands).

## 3. Funding (second)

- **Detection:** both conditions must hold:
  - the coin's current funding is **unusual for that coin** (beyond its own 30-day p95/p5, the same basis as rule R5 / the rarity);
  - it is **at least an absolute floor** of ±0.03% per 8 h by default, editable per coin. The floor stops "record" wiggles near zero.
- **Events:**
  - **entering** the extreme zone: one alert per entry, re-armed only after funding returns to normal;
  - a **sign flip** after a sustained extreme period. The Architect defines "sustained" and states it.
- **Source:** Binance current (predicted) funding, checked every 5 min. State the weight per minute, or show it is already in our tape.

## 4. Price levels (third)

- **Levels on by default:**
  - PWH / PWL (previous ISO week high/low, UTC);
  - PMH / PML (previous calendar month high/low, UTC);
  - **weekly open** and **monthly open**.
- **Available but off by default:** PDH / PDL (previous day). They are on in admin per coin.
- **Two event types,** separate messages:
  - **Breakout:** a **15m candle closes** beyond the level.
  - **Liquidity sweep:** the wick goes beyond the level and the same 15m candle closes back inside.
  - Plain touches do **not** alert.
- **Repeats:** at most **one message of each type per level per period** while that level is in force (a week for PWH, and so on).
- **Period maths:** reuse `prior-levels.ts` (complete periods only; no level is better than a wrong one). The server needs its own copy or a shared pure module. Architect's call.
- **Custom levels (low priority, last):** a price the owner enters.
  - Entered in `/admin/alerts` and via the bot command `/level BTC 72000`; deleted in the same places.
  - They fire the same breakout and sweep events.

## 5. Chart (low priority)

- On the instrument page, mark where a liquidation or funding alert fired, like the OI divergence marks. The marks are hideable and listed in the legend.
- Draw **PMH / PML** and the **weekly / monthly open** next to the existing PDH/PDL and PWH/PWL lines. They are hideable.

## 6. Order

1. Market round 2 (separate brief).
2. Large liquidations: design, history run, owner sets thresholds, go live.
3. Funding: the same steps.
4. Levels: the same steps.
5. Low priority: custom levels, then the chart marks and lines.

WIP 2, a fresh dev context per task. Deploy batches go when the owner says.
