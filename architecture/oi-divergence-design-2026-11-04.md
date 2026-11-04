# OI divergence alerts — design and decomposition (2026-11-04)

**Author:** Architect (insight-bot stream).

**Input:** the owner's brief `architecture/oi-divergence-alerts-2026-11-04.md`, from the coordinator's grilling session. Every rule marked "owner" there is taken as given. The owner's picture is in `architecture/mockups/oi-divergence-2026-11-04/owner-example.png`.

**Output:** IB-109…IB-113.

**Gate:** Telegram stays **off** until the owner has seen 5–10 historical examples (IB-111) and switched it on in the admin page.

## 1. The shape

```
Binance klines (on demand, cached) ──┐
open_interest_5m (our DB; Binance 30 d on demand for coins we do not store) ──┤
                                     ▼
            src/insights/divergence/  (pure: bars → pivots → pairs → divergences)
              │                    │                         │
   alert loop (listed coins,   GET /api/web/series/       IB-111 history run
   each TF bar close)          oi-divergences (any coin,  (examples + counts)
              │                chart lines)
   oi_divergence_alerts ──► Telegram (TelegramSender.sendTo) ──► outcome job (+4 h, +24 h)
              └──► R11 «Главное сейчас» card (reads the journal, no venue)
```

There is one detector function. The alert loop, the chart and the history run all call it, so a line on the chart and an alert in Telegram cannot disagree on the same data.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| V1 | **The detector is a pure module, `src/insights/divergence/`.** Its input is `{bars: {time, open, high, low, close}[], oi5m: {time, oi}[], params}`. Its output is pivots, pairs, divergences and skips. It does no I/O. | The brief asks for reuse of `src/insights/` and for alerts outside `web/`. Being pure makes every owner rule testable on hand-built bars. A spec per rule in §3 gives eleven specs, each built so that it can fail. |
| V2 | **The coin list is a new table, `alert_symbols`**: `symbol text primary key` (Binance USD-M, e.g. `TRXUSDT`), `base`, `added_by → users`, `added_at`, `enabled boolean default true`. It does **not** go into `symbols`. | `symbols` is owned by `universe.yaml`: `syncUniverse` upserts it and deactivates anything not in the file, and `active` there switches on every collector (liquidation sockets, Market positioning). A coin added for alerts must not join all of that. **Watchlist-ready:** a member's watchlist later is `member_watchlist(user_id → users, symbol → alert_symbols)`, a subset of this list. This table is its base and needs no change for it. That table is not built now. |
| V3 | **The OI poller collects `universe ∪ alert_symbols(enabled)`**, re-read from the DB at the start of every 5-min pass. It does not snapshot at boot. A symbol with no stored OI gets the existing per-symbol backfill (30 days, paced at `BACKFILL_PACING_MS`) when it is first seen. `staleSymbols` reads the same union. Removing a coin stops collection and keeps its rows. | "Changes apply without a deploy" (owner). The backfill code already works per symbol. **Cost:** each extra coin adds 1 request per endpoint per 5 min on `/futures/data` (5 endpoints), weight 0 (IB-BUG-030). TRX alone adds **+1 of 1 000 per endpoint per 5 min**. A new coin's backfill is 5 × 18 = 90 requests in ≈ 11 s. Disk is 1 440 rows a day per coin (288 slots × 5 series), i.e. 1/40 of storage-ruling §3's 40-symbol figure. |
| V4 | **Bars come from Binance klines on demand. OI per bar comes from our 5 m points:** the **min** of the points inside the bar for lows, and the **max** for highs (owner). **A 5 m point's label is the moment of the reading** (row 17:10 = OI at 17:10, the end of the 17:05–17:10 slot), so **a bar takes the readings with `open < t ≤ open + TF`** (amended 2026-11-04 from "`[open, open + TF)`", which would have shifted OI one slot into the past). Measured by dev-1 in IB-109 (`reports/dev-1-IB-109.md` §2): 90 reads (5 coins × 6 boundaries × 15/35/60 s) plus one earlier probe, no label later than its request. Pinned by `test/fixtures/binance/open-interest-hist-labels.json`. The bar's last reading arrives well inside V9's +6 min (each boundary's row was served 16–37 s after it in that probe; a note, not a rule). | Price history is always available from the venue (storage rule). OI is what we store. |
| V5 | **Pivot (owner):**<br>• Bar *i* is a **low** if `low[i] < low[j]` for the N bars before it, and `low[i] ≤ low[j]` for the N bars after. The strict/non-strict split makes the **first** of equal bars the pivot, so a double bottom is kept.<br>• Highs mirror this.<br>• A pivot is confirmed when bar *i+N* has closed.<br>• OI pivots apply the same rule to the per-bar min series (lows) or max series (highs). | The owner ruled it word for word. The tie rule is the only interpretation that keeps "the first of equal bars". |
| V6 | **Pairing:** a price pivot takes part only if an OI pivot of the same kind lies within **±k bars**. If there are several, the nearest wins; on a tie, the earlier. **k = 3 on every TF** (default, editable). The pair is confirmed when *both* pivots are confirmed, at `max(i_price, i_oi) + N`. | Half of N = 6. OI turns a bar or two before or after price in the owner's picture. The history run (IB-111) reports how the count moves with k = 2, 3, 4. |
| V7 | **Divergence.** When pair B confirms, compare it with **every** earlier confirmed pair A whose price pivot is within **W bars** of B's. All four conditions must hold:<br>(1) the price is worse at B: `low_B < low_A − δp` (lows);<br>(2) OI is better at B: `oi_B > oi_A + δoi`;<br>(3) **price line valid:** no wick in `(A, B)` goes below the straight line from A's low to B's low;<br>(4) **OI line valid:** no per-bar OI min in `(oiA, oiB)` goes below the line through the two OI pivots.<br>Highs mirror all four. If several A qualify, the **farthest** wins (owner).<br>**Defaults:** W = 96 bars on 15m (24 h), 120 on 1h (5 d), 90 on 4h (15 d).<br>**Noise:** `δp = 0.25 × ATR14` at B on that TF, and `δoi = 0.5 × median |ΔOI per bar|` over the 100 bars before B; **B is evaluated only once those 100 per-bar moves exist, at least 20 of them known** (amended 2026-11-04, IB-109). Both are relative to the coin's own normal range (owner), and all are editable. | W keeps a line within what a trader draws on one screen of that TF. The ATR- and median-relative thresholds scale with each coin and TF, so one setting works for BTC and TRX. These are **starting values, not measured**: IB-111 reports counts and examples with them and with ±1 step, and the owner judges. |
| V8 | **Repeat (owner):** when C confirms and forms a valid divergence with the same farthest A (or any farther one), it is a **new** alert. The A–C line replaces A–B on the chart. It is marked «повторное» with the run length («третий минимум подряд» = the third pivot in the run). `run_of` points to the first alert of the run. **One alert per (symbol, TF, direction, A, B)**, enforced by a unique key, so a restart or a re-evaluation never sends it twice. | As ruled. The unique key makes the loop idempotent. |
| V9 | **Gaps (owner): skip, log, draw nothing.** An evaluation is skipped when any 5 m OI slot in `[B − W − N, B + k + N]` is missing *and* the gap ledger does not classify it as "venue did not publish" (IB-104's split). It is logged as `skipped: no_oi_data` with the hole's range. A slot not yet due (the venue's publish lag) is not a hole. The loop evaluates at **bar close + 6 min**, after the next poller pass (+20 s). | Using the ledger keeps TradFi's closed sessions from muting a coin forever. The 6 minutes cover the documented publish lag. |
| V10 | **The alert loop** runs at bar close + 6 min on each TF, for each enabled listed coin. It reads the last `max(W + N, OI_MEDIAN_BARS + 1, ATR_PERIOD) + k + N + 1` closed bars (`barsForEvaluation`, derived from the code by dev-1 and pinned by a spec that fails one bar short): **112 on 15m, 136 on 1h, 111 on 4h, so weight 2 per call** (limit 100–499; amended 2026-11-04 from "≤ 100 bars, weight 1", `reports/dev-1-oi-bar-count.md`). **Weight:** 5 coins × (4 + 1 + 0.25) bar closes an hour × 2 ≈ 53 weight/h ≈ **0.9 / min** of 2 400 (arithmetic; IB-112 measures it). OI comes from the DB. A pair confirmed more than one TF bar + 10 min before the evaluation (the box was down) is journalled with `late = true` and **not sent**. | Cheap, and stale alerts are not sent. A restart replays the window, and the unique key absorbs duplicates. |
| V11 | **Chart lines are computed on open, not stored.** `GET /api/web/series/oi-divergences?symbol&tf` runs the detector over `[OI coverageFrom, now]` with the current params and returns lines `{direction, a:{time, price, oiTime, oi}, b:{…}, repeat}` plus `skips`. The result is cached per (symbol, TF) for one bar.<br>**Cost per open on a cold cache:**<br>• klines: 1h over 30 d = 720 bars = weight 5; 15m over 30 d = 2 880 bars = 3 pages = 15; 4h = 2. For our stored coins the cost grows with stored history: 15m over a year ≈ 35 pages ≈ 175 weight, so **15m is capped at the last 90 days (≈ 45 weight)**.<br>• OI: our DB for stored coins. For a coin we do not store, 30 days of 5 m = **18 `openInterestHist` requests**, weight 0, 1.8 % of its 1 000 / 5 min, cached 15 min.<br>Fired alerts also come from the journal, so the chart can mark them («отправлено»). | Storing detections for every coin × TF means running the detector continuously for 40+ coins. That is work nobody may look at, and the lines then drift from the params. Computing on open costs a few weight per view, and the existing `WEIGHT_CEILING_1M` refusal still applies. |
| V12 | **The journal is `oi_divergence_alerts`.** One row per alert, including late ones:<br>• identity: id, symbol, tf, direction (`bullish` / `bearish`);<br>• the pivots: a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi;<br>• repeat: run_of, run_length;<br>• params (jsonb: N, k, W, δp, δoi as used);<br>• delivery: confirmed_at, fired_at, late, recipients (int);<br>• outcomes: price_at_fire, price_4h, price_24h, outcome_at.<br>Skips go to `oi_divergence_skips`: symbol, tf, bar_time, reason, hole_from, hole_to. **Outcomes:** an hourly job fills `price_4h` and `price_24h` from the 1m kline close at `fired_at + 4 h / 24 h`, one call each at weight 1.<br>**Disk:** tens of rows a week (IB-111 gives the real count), a few hundred bytes each: **well under 1 MB a year** against the 50 GB disk. | The owner wants a hit rate before any probability is said. Outcomes are recomputable from the venue at any time, so two stored closes are enough now. Path statistics (MFE/MAE) can be backfilled later without data loss. |
| V13 | **Delivery** goes through `TelegramSender.sendTo`, in the recipient's language. It is not behind `OPS_TELEGRAM_ALERTS`.<br>• **Recipients:** users with `oi_alerts = true`, not disabled, with a chat id. Migration 025 adds the column with **default false** and sets it true for admins, i.e. the owner.<br>• **Members:** the toggle exists in `/me/settings` and the bot, but is **shown only when `alert_settings.members_visible`** is on (admin page, default off).<br>• **Master switch:** `alert_settings.enabled`, default **off**. Detection and the journal run either way, so IB-111's examples and the owner's decision come before any message. | As ruled: owner first, members later without a deploy. Running the journal before sending means the first week is already logged when the owner switches it on. |
| V14 | **Text (no forecasts, owner):**<br>• ru: «{BASE} {tf}: цена обновила минимум ({pricePct}), OI — нет ({oiPct}). Набирают позиции на падении.»<br>• ru, highs: «{BASE} {tf}: цена обновила максимум ({pricePct}), OI — нет ({oiPct}). Рост идёт без новых позиций.»<br>• A repeat adds « · повторное: {третий} {минимум|максимум} подряд».<br>• Then the link `{WEB_BASE_URL}/instrument/{symbol}?at={b_time}&tf={tf}`.<br>• en: «{BASE} {tf}: price made a lower low ({pricePct}), OI did not ({oiPct}). Positions are being opened into the drop.» / «… a higher high …, OI did not … The rise comes without new positions.»<br>`pricePct` is B against A; `oiPct` is OI at B against OI at A. | The owner's example, kept. The second sentence describes what is happening, not what will happen. |
| V15 | **The instrument page** gains a `tf` query parameter (IB-098 has only `at` and `span`).<br>• It draws the lines on the price pane and the OI pane: bullish teal and bearish red, as in the owner's picture where red is used for both. Here colour carries direction. Repeats are dashed.<br>• A legend entry «Дивергенции OI» hides them like the other marks.<br>• Any coin with OI gets lines. A listed coin that is not in the universe (TRX) opens with candles, OI and lines, and its liquidation pane says it is not collected. | As ruled. |
| V16 | **Market card: rule R11 `insight.oi_divergence`** (block `positioning`) reads the journal: the newest alert of the last 24 h for listed coins, late ones excluded.<br>• params: `{symbol, tf, direction, pricePct, oiPct, runLength}`;<br>• spark: per-bar OI from A to B, ≤ 30 points;<br>• link: instrument, `timeSec = b_time`.<br>**It is an event, not a percentile:** it sends `rarity = 1`, and the contract comment says so. That ranks it first. The rarity value is never rendered. It makes no venue call. | The owner wants it on «Главное сейчас». The 0.90 gate is for percentiles, and an event has none. Documenting the 1 at the field is cheaper than a second ranking path. |
| V17 | **Admin page `/admin/alerts`** (admin only):<br>• the coin list: add a symbol, checked against Binance `exchangeInfo` (cached; a USD-M perpetual that is trading); disable; remove;<br>• N, W and k per TF, and the two noise multipliers;<br>• `enabled` and `members_visible`;<br>• the last 50 journal rows and the skips.<br>Settings live in `alert_settings` (one row, jsonb params, with `updated_by` and `updated_at`). A params change applies from the next evaluation. Journal rows keep the params they were made with. | Without a deploy, as ruled. Params are kept per row because a hit rate is meaningless if the params changed under it. |

## 3. Specs the detector must have (IB-109)

Each spec is built so that it can fail.

1. A low, ruled on wicks: the closes say "no pivot", the wick says "pivot".
2. Equal lows: the first is the pivot and the second is not. A double bottom within W still pairs.
3. A pivot is not confirmed until bar *i+N* has closed.
4. OI per bar uses min for lows and max for highs: a bar whose last point is high and whose inner point is low.
5. Pairing within ±k: an OI pivot at k+1 does not pair, and the nearest of two wins.
6. The farthest valid A wins over a nearer valid one.
7. The price line: a wick between A and B below the line refuses it. The same for the OI line.
8. Noise: a 0.1 × ATR lower low does not fire.
9. Repeat: A, B, C gives two alerts, the second with run length 3, and the line A–C.
10. A gap inside the window gives a skip, with no divergence. A "venue did not publish" slot does not skip.
11. The mirror case: one bearish fixture for every bullish one.

**Plus a positive control on real data:** a fixture cut from the owner's picture, if IB-111 identifies the coin and dates; otherwise from the first real example IB-111 finds. It must be detected.

## 4. Before launch: what the owner sees (IB-111)

1. **Run the detector over history** for BTC, ETH, SOL, BNB and TRX × 15m/1h/4h × both directions, with the V5–V7 defaults:
   - OI from `insight_*` DB history, since 2026-10-04 for universe coins, or from the box's DB;
   - TRX (not stored before IB-109) from Binance's 30 days.
2. **The count table:**
   - alerts per week per coin × TF × direction, over the whole span;
   - the same with k ±1, W ±25 % and δ × ½ / × 2;
   - skips and their reasons;
   - the population stated with every number: which coins, which dates, how many weeks.
3. **5–10 examples** on the dashboard's own instrument page, with IB-110's lines, as screenshots:
   - both directions, all three TFs, at least one repeat;
   - **at least two near-misses** (the farthest A refused by line validity or noise), so the owner sees where the line is drawn.
4. **A plain-Russian report for the owner:** what was found, how often, and the params in words («минимум — свеча ниже шести соседних с каждой стороны» …).
5. **No outcome statistics.** A month of data is too thin, and the journal is for that later.

**The owner decides:** keep or adjust the params (admin page), then switch `enabled` on.

## 5. Order and WIP

The owner's order: finish and deploy IB-106 and IB-107, then this. IB-108, IB-100, IB-077 and IB-BUG-034 are deferred.

| Task | What | Depends on |
|---|---|---|
| IB-109 | Server core: migration 025 (`alert_symbols`, `alert_settings`, `oi_divergence_alerts`, `oi_divergence_skips`, `users.oi_alerts`); the detector + §3 specs; OI per bar; the poller union + per-symbol backfill (V3); contracts | — |
| IB-110 | Chart: the series endpoint (V11), the instrument `tf` param, lines on price + OI panes, the legend; non-universe coin pages open | IB-109 |
| IB-111 | History run + the owner's examples and counts (§4); the owner's gate | IB-110 |
| IB-112 | The alert loop (V9, V10), journal, outcomes, Telegram text (V14), recipients and toggles (V13), `/admin/alerts` (V17) | IB-109 |
| IB-113 | R11 on «Главное сейчас» (V16) | IB-112, IB-107 |

IB-110 and IB-112 can run in parallel within WIP 2. Migration **025** is the next free number across every ref (max 024 on 2026-11-04); re-check every ref before committing it.

## 6. Not now

- per-member watchlists (V2 makes them a single table later);
- browser push;
- quiet hours (owner);
- hit rates in any text (V12: after 1–2 months of journal);
- divergence on non-Binance OI;
- an alert for coins not on the list.
