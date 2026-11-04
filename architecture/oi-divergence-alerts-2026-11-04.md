# Brief — price vs open-interest divergence alerts (2026-11-04)

**Author:** coordinator (grilling session with the owner, all decisions below are the owner's) ·
**For:** Architect (insight-bot stream). Design and decompose into `tasks/insight-bot.jsonl`. ·
**Reference picture:** the owner's screenshot. Price lows connected by a falling red line, OI lows
connected by a rising red line, then a squeeze up. It is copied to
`~/.claude/jobs/0028abca/tmp/reports/oi-divergence-2026-11-04/owner-example.png`; commit it next to this brief.

This is the first feature of the queued "alerts + watchlist" block (member-access brief §5.1).
Rules in `src/insights/` were written to be reused by alerts. Reuse them where it fits.

## 1. What is detected

Both directions:
- **Bullish (lows):** price makes a lower low, and OI makes a higher low. Positions are being opened into the drop.
- **Bearish (highs):** price makes a higher high, and OI makes a lower high. The rise comes without new money.

Each alert says which one it is.

## 2. Scope

- **Timeframes:** 15m, 1h and 4h. Each is evaluated independently, and each alert names its TF.
- **Coins:** BTC, ETH, SOL, BNB and TRX, all Binance USDT perps.
  - **Not hard-coded.** The list lives in the DB and is edited on a new admin page. Changes apply without a deploy.
  - Later this list becomes the base of each member's watchlist; design the table with that in mind, but do not build per-member watchlists now.
- **A coin added to the alert list automatically joins the stored OI collection.**
  - TRX is not in `config/universe.yaml` today, so it joins now.
  - State the weight per minute for the OI poller with N extra coins. `/futures/data` books weight 0 on its own limit, per IB-BUG-030.
  - New coins need a 30-day boot backfill, as the existing poller does.

## 3. Pivot rule (owner-ruled)

1. **Price pivot:**
   - A low is a bar whose **wick low** is below the lows of `N` bars on each side. A high mirrors this on the wick high.
   - **Equal values:** the **first** of equal bars counts, so double bottoms are not lost.
   - It is confirmed only when the N-th bar to the right has closed.
2. **N per TF**, editable in the admin page without a deploy. The default is **6** on every TF (the owner: "n > 5").
   - Confirmation lag is therefore 1.5 h on 15m, 6 h on 1h and 24 h on 4h.
   - The owner accepted this and will revisit 4h after a week of logged signals.
3. **OI per bar:**
   - For lows, take the **minimum** of the stored 5m OI points inside the bar; for highs, the **maximum**.
   - OI pivots use the same N rule on that per-bar series.
4. **Pairing price and OI:**
   - For each price pivot, find an OI pivot within **±k bars**. You choose k.
   - With no OI pivot nearby, that price pivot takes no part.
   - The OI line is drawn through OI's own pivots, not through OI values at the price bars.
5. **Divergence:**
   - A newly confirmed pivot B is compared with **any** earlier pivot A within a lookback window (owner: not only the immediately previous pivot). You choose the window per TF.
   - Conditions:
     - price B < A and OI B > A for lows (mirrored for highs), each by more than a **noise threshold**. You choose the threshold, relative to the coin's normal range, not a fixed percent.
     - **Line validity:** no candle wick between A and B crosses the A–B price line (below it for lows), and no OI value crosses the A–B OI line. This is how a trader draws a trendline.
     - If several A qualify, take the **farthest**. That matches the screenshot.
6. **Repeat:**
   - If later pivot C extends the pattern (C below B, OI at C above), that is a **new** alert, marked «повторное: третий минимум подряд».
   - The chart line then runs from A to C.
   - One alert per pivot pair; the pair is fixed once B is confirmed.
7. **Gaps:**
   - If the OI series has a hole inside the window (a missing 5m point that is not yet repaired), **skip** the evaluation.
   - Log it as "skipped: no OI data" and draw nothing there.
   - Use the existing gap ledger (IB-BUG-020 / IB-104) to tell holes from "venue did not publish".

**Before launch:** show the owner 5–10 detected examples on charts from history, with your thresholds, window and k. State how many alerts per week the current 5 coins × 3 TF × 2 directions would have produced. The owner judges whether they match what they mean.

## 4. Delivery

- **Telegram**, through the same bot and sender as the calendar reminders (`TelegramSender.sendTo`).
  - Not behind `OPS_TELEGRAM_ALERTS`; that flag is for operator pushes.
  - Example text: «BTC 1h: цена обновила минимум (−1,8 %), OI — нет (+3,2 %). Набирают позиции на падении.» Add a link to the instrument page with `?at=` (IB-098) on that moment, TF preselected.
  - Wording follows the i18n rule. **No forecasts** in the text (owner ruling, §6).
- **Recipients:**
  - Owner only at first.
  - Later, members opt in through an account setting, **off by default**, built like the calendar-reminders toggle (IB-035 settings).
  - Build the setting now, but expose it to members only when the owner says so.
- No browser push (VAPID deferred).
- No quiet hours.

## 5. Chart and Market

- **Instrument page:**
  - Draw the divergence lines on the price pane and the OI pane for **all available OI history** on the selected TF, for **any** opened coin that has OI. Alerts still go only for listed coins.
  - History depth: our DB (since 2026-10-04 for collected coins), otherwise Binance's 30 days on demand.
  - The lines are hideable like the other marks, and the legend lists them.
  - State the cost: computing on open versus storing detected divergences.
- **Market «Главное сейчас»:** a fresh divergence (last 24 h, listed coins) appears as a card: tag, title, plain-language line, spark, and a «Открыть BTC на графике →» link.

## 6. Signal journal (owner ruling)

- Store every fired alert in the DB: coin, TF, direction, A/B(/C) times and values, thresholds used, and the skipped evaluations.
- Record the price outcome **after 4 h and after 24 h**.
- This is what will later let texts state a hit rate. Until there are enough records (one to two months), no probabilities and no "often precedes" phrasing anywhere. That also answers the owner's open question on the Market insight cards: they stay without forecasts.
- This table is a new store, so cost it on the 50 GB disk (storage ruling).

## 7. Order (owner ruling)

- **Market visual pass:** finish only IB-106 and IB-107 (in progress), deploy them, then the devs move to this.
- **Deferred:**
  - IB-108 (the remaining Market blocks);
  - IB-100 (the owner's look-through);
  - IB-077 (the owner's login acceptance);
  - IB-BUG-034;
  - other checks and clean-ups.
- **You can design this now.** It does not occupy the dev slots.
- WIP 2 as always.
