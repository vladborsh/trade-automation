# Large-liquidation, funding and price-level alerts — design (2026-11-05)

**Author:** Architect (insight-bot stream).
**Brief:** `architecture/alerts-liq-funding-levels-2026-11-05.md` (owner, grilled 2026-11-05); every product rule there is the owner's.
**Extends:** `oi-divergence-design-2026-11-04.md` (V1–V33). Section numbers like "V13" point there.
**Order (owner):** Market round 2 is built first. This stream is built after it, in the order of §7: liquidations, then funding, then levels, then custom levels and chart work.

## 1. What is shared with the OI alerts, and what is new

| Piece | Reused as is | New, generic for the three types |
|---|---|---|
| Coin list | `alert_symbols` (V2), `/admin/alerts` coin list | — |
| Settings | — | **`alert_type_settings`**: one row per type (`liq`, `funding`, `level`), with `enabled` (default **off**), `members_visible` (default off) and `params jsonb`. Params: defaults per type plus `perCoin[symbol] = {enabled, …thresholds}`; a coin missing from `perCoin` takes the type's defaults. A zod schema per type lives in contracts. OI's `alert_settings` row stays untouched. |
| Recipients | `TelegramSender.sendTo` in the recipient's language; the opt-in pattern of V13 | `users.liq_alerts`, `users.funding_alerts`, `users.level_alerts`, each `boolean not null default false`, set true for admins by the migration that adds it. V13's known limit, that a later admin starts off, applies. The member toggle per type is shown only while that type's `members_visible` is on. |
| Journal | the idea of V12, `source` and `build` (V27, V30) | **`market_alerts`**, one table for the three types (columns in C1). |
| Price paths | the IB-115 measurer and `oi_divergence_paths` (V24), unchanged in meaning | `oi_divergence_paths` gets `market_alert_id` and `market_control_id`, and the subject check becomes `num_nonnulls(…5…) = 1`. The table keeps its name: renaming it buys nothing and touches every reader. |
| Controls | the V25 idea | **`market_alert_controls`**: type, kind, symbol, at, direction (nullable), details jsonb, params, source, build. |
| Link | `?at=&tf=` (IB-110) | tf per type: liq `5m`, funding `1h`, level `15m`. |

**C1. `market_alerts` columns:**
- id, type, event, symbol, direction (nullable), at (the event's own moment, the link's `at`), tf;
- details jsonb, validated per type and event by contracts;
- params jsonb (as used), source, build;
- confirmed_at, fired_at, late, recipients;
- `dedupe_key text`, with **unique (source, type, dedupe_key)**. Each type defines its key below, so "once" is a constraint, not a promise.

**C2. Late.** A loop that wakes after downtime journals what it missed with `late = true` and does not send it, as in V10. Each type gives its own staleness bound below.

**C3. Texts.**
- Built by the bot from keys, ru and en.
- Tickers, venues and level names (PWH, PMH …) stay English; sentences are translated.
- No forecasts anywhere (D20).
- Every message ends with the instrument link.

**C4. Before launch, per type:** a history run over our stored data, with the same steps for the owner as IB-111:
- the alert count a week at the defaults and at ½× and 2×;
- 5–10 examples on the instrument page, pictures in the report;
- a short report in plain Russian.

The owner then sets thresholds on `/admin/alerts`. Sending stays off until the owner switches that type on.

**C5. No hit rates.** §6 of the OI design applies to every type: "worked" and the baseline must be decided before any rate is written. Controls are collected now so the baseline exists then.

## 2. Large liquidations (first)

| # | Decision | Why |
|---|---|---|
| L1 | **A sliding 5-minute window, evaluated every 30 s,** per coin and per liquidated side.<br>• At each tick the loop reads that side's liquidations of the last 5 min + 30 s from the tape, all three venues, and finds the **first moment *t* at which the sum over `(t − 5 min, t]` reached the coin's threshold**. That moment is the alert's `at`.<br>• **There are no buckets, so there is no bucket edge.** A cascade that straddles a minute boundary is one window. | Fixed 5-minute buckets would split a $6M cascade into $3M + $3M and miss a $5M threshold twice. A sliding window cannot. The exact crossing moment makes the link land on the cascade, not on the tick. |
| L2 | **Anti-spam per (coin, side):**<br>• after an alert, the coin and side are quiet for **30 min from `at`**;<br>• in that time, the **running sum from the alert window's start** (`at − 5 min`) is tracked. When it reaches **2 × the threshold**, one `continuing` message is sent: «продолжается: уже $X». At most one per quiet period;<br>• after 30 min, detection is normal again, so a cascade still going gets a fresh alert.<br>`dedupe_key`: `liq:{symbol}:{side}:{window start}` for the alert, `liq-cont:{symbol}:{side}:{alert id}` for the continuation. | As ruled. "Running sum since the window start" is the only reading of "reaches 2× within those 30 minutes" in which the continuation reports how big the event has become. |
| L3 | **Venues are summed, and the message shows the split.** Message:<br>• «Крупные ликвидации **лонгов** BTC: **$7.4M** за 5 мин»;<br>• the next line: «Binance $3.1M · Bybit $2.9M · OKX $1.4M»;<br>• then: «{count} ликвидаций, крупнейшая $1.2M (Bybit)».<br>Binance publishes at most one liquidation per second per symbol (D6), so its figure is a floor; the message says so in a short footnote the first time per day. **A venue whose stream was silent in the window** (collector heartbeats) is named: «нет данных с OKX». It is never shown as $0. | The owner asked for the split, the count and the largest. Naming a silent venue keeps an undercount from looking like a quiet venue (IB-BUG-011). |
| L4 | **Default thresholds** (5 min, all venues): BTC $5M, ETH $3M, SOL $1M, BNB $300k, TRX $300k. Editable per coin and on/off per coin in `/admin/alerts`. A coin added to `alert_symbols` without a threshold is **off** until one is entered. | No default fits an arbitrary coin, and a wrong default is spam or silence. |
| L5 | **Coverage of a newly listed coin.** Today Binance stores every USDT-linear `!forceOrder` (all market), but **Bybit subscribes per symbol and OKX filters to the universe**. So TRX, which is listed but not in the universe, has Binance only.<br>• The liquidation collectors **track `universe ∪ alert_symbols(enabled)`**, re-read every 5 min, as V3 does for OI. Bybit subscribes to new topics without a reconnect, and OKX widens its filter.<br>• Venue symbols come from the base: `{BASE}USDT` (Binance, Bybit), `{BASE}-USDT-SWAP` (OKX). This is a pure mapper with a spec, used by both the collectors and the loop.<br>• Until a venue has collected a coin for 5 min, the message names it as not collected. | "A coin added there auto-joins the data the alert needs" (owner). The tape cannot be backfilled: no venue serves liquidation history. |
| L6 | **Late:** an `at` older than 5 min at evaluation (after downtime) is journalled `late`, not sent. | A cascade reported 20 min late is history, not an alert. |
| L7 | **Cost:**<br>• **venue weight 0**: the tape is ours;<br>• **DB:** 2 reads a minute of a ≤ 5.5-min range on the current partition. They use the `(venue, symbol, ts, …)` unique index, with symbols mapped as in L5. Coins in a quiet period add one read of ≤ 35 min each;<br>• **memory:** the window's rows only, a few thousand at the worst minutes, ≈ 50 B each, well under 1 MB;<br>• price paths: 8 weight per alert (V24). | Small next to IB-096's cap. The report measures it on a slot. |
| L8 | **Controls and near-misses** (`market_alert_controls`):<br>• **`random`**: 2 random 5-minute windows per coin and day, hash-seeded as V25, with their sum recorded. This answers "is a big window different from any window?";<br>• **`near_miss`**: per coin, side and UTC hour, the **largest** 5-minute sum when it reached **≥ 0.5 ×** the threshold and fired no alert, with `ratio = sum / threshold`. A threshold change can then be re-scored on stored rows.<br>Paths are measured for both, direction-free (`direction` null, stop null), as for V25's random. | The owner will tune thresholds. Near-misses below them are the data for it. One per hour bounds the volume to ≤ 24 × 2 × 5 = 240 a day in the worst case, a few MB a year. |
| L9 | **History run (C4).** Replay the tape from its first complete day: per coin, the alert count a week at the defaults, ½× and 2×, continuation counts, and 5–10 examples. A window with a venue gap (`collector_gaps`) is still counted but marked. TRX has Binance only before L5. | The owner's gate. The tape is the only source. |

## 3. Funding (second)

| # | Decision | Why |
|---|---|---|
| F1 | **Inputs, every 5 min:**<br>• the coin's **current predicted rate**, `/fapi/v1/premiumIndex?symbol=`, weight 1 each, so 5 coins = 1 weight per 5 min;<br>• its **30-day settled history**, `/fapi/v1/fundingRate`, weight 1, refreshed hourly: 5 / h. That history is not stored (S1); the positioning baseline holds it only for universe coins, and the alert list can hold others.<br>**Total ≈ 0.3 weight / min.** | Funding is not in our tape (storage ruling S1). The cost is negligible. |
| F2 | **Normalised to 8 h.** Some coins settle every 4 h or 1 h. The interval is read from the spacing of the last settlements (no extra call), and the rate is compared as `rate × 8 h / interval`. The message prints the venue's own rate and interval. | The owner's floor is "±0.03 % per 8 h". A 4 h coin at 0.02 % pays as much as an 8 h coin at 0.04 %. |
| F3 | **"Extreme" = both:**<br>• beyond the coin's own **p95 / p5 of its 30-day settled rates**, normalised. This is the same sample and the same quantile function as rule R5 and the rarity: one shared helper, with a spec that R5 and the alert give the same band for the same sample;<br>• and beyond the **floor**, ±0.03 % / 8 h by default, editable per coin. *(Amended 2026-11-05, market round 3 §1: the default is `FUNDING_FLOOR_PER_8H` in `insights/thresholds.ts` and the check is `fundingExtreme`, both from IB-135, shared with R5. Do not declare a second constant.)*<br>High side: `r ≥ max(p95, +floor)`; low side: `r ≤ min(p5, −floor)`. | As ruled. Sharing the band means the Market card and the alert can never disagree about what "unusual" is. |
| F4 | **Entry event:**<br>• a coin's state per side is `normal → extreme` when the condition holds at a check. One `enter` alert;<br>• it re-arms **only after the condition has been false for 3 consecutive checks (15 min)**, so a rate wobbling on the edge does not alert at every check;<br>• `dedupe_key`: `funding:{symbol}:{side}:{episode start}`. | "One alert per entry, re-armed after return to normal" (owner), with a stated hysteresis. |
| F5 | **"Sustained" = the extreme episode lasted ≥ 24 h** (three 8 h settlements), counting from entry to exit as F4 defines them.<br>• After such an episode ends, the first time the rate's **sign** is the opposite of the episode's, held for 3 checks and within **72 h of the episode's end**, one `flip` alert is sent: «фандинг сменил знак после {h} ч экстремума».<br>• One per episode; `dedupe_key` `funding-flip:{symbol}:{episode start}`. | A flip after a day of crowding is the event the owner means. A flip after an hour is noise, and a flip a week later is unrelated. Both bounds are editable params. |
| F6 | **State survives a restart.** It lives in `alert_funding_state` (symbol, side, zone, since, false_checks, last episode: start, end, sign, flip_sent), **one small row per coin and side**. Predicted funding has no history anywhere, so in-memory state would be lost with nothing to rebuild it from. | Five coins × 2 rows. |
| F7 | **Late:** a check whose rate is more than 15 min old (after downtime) is not alerted; the state is rebuilt from the next check. | Nothing to replay: predicted rates are not historical. |
| F8 | **Controls:** `random`, 2 checks a coin a day with the rate and band recorded; `near_miss`, an entry into p95/p5 that **failed only the floor**, or crossed the floor while inside the band, at most one a coin and side a day. Paths are measured, with direction = the side that pays (longs paying → bearish crowding, stored as is, no forecast). | The floor and the band are the two knobs; near-misses re-score both. |
| F9 | **History run (C4)** on **settled** funding. Predicted history does not exist, so the replay checks each settlement against the previous 30 days. **It is coarser than live (8 h, not 5 min), and the report says so.** Span: 180 days for the counts (weight 1 per 1 000 settlements, negligible). | The only history there is. Counts per week are what the owner needs, and 8 h granularity is enough for them. |

## 4. Price levels (third)

| # | Decision | Why |
|---|---|---|
| P1 | **One level module, shared.** `prior-levels.ts` moves **from the dashboard into `libs/market-data-core`**, with its spec, and is extended. The dashboard imports it from there in the same commit: a pure move, behaviour unchanged, spec green. A second copy would drift. Rules kept: **complete periods only**, UTC, ISO weeks from Monday 00:00 UTC; no level is better than a wrong one. | The brief offers "own copy or shared"; shared is the one that cannot drift. |
| P2 | **Levels:**<br>• on by default: **PWH / PWL** (previous ISO week), **PMH / PML** (previous calendar month), **weekly open** (the open of the current week's first 1d bar), **monthly open**;<br>• off by default, on per coin in admin: **PDH / PDL**.<br>• Computed from 1d klines, one call per coin per UTC day (limit ≈ 70, weight 1), and recomputed when a period rolls over. | As ruled. 1d bars give every level, including opens. |
| P3 | **Events on each 15m close** (the bar closed + 5 s settle):<br>• **breakout up:** `close > L` and the previous 15m close `≤ L`; breakout down mirrors it;<br>• **sweep above:** `high > L`, `close ≤ L` and the previous close `≤ L` (it came from below, poked through, closed back); sweep below mirrors it;<br>• a high exactly at L, or a close exactly at L, is a touch: **no alert**.<br>An open (weekly or monthly) is a level from both sides. | As ruled. "The previous close" gives each event a direction without a tolerance parameter. |
| P4 | **Repeats:** at most **one message per (level, event type) per period while the level is in force**, whatever the direction. `dedupe_key`: `level:{symbol}:{level kind}:{period start}:{breakout|sweep}`.<br>Periods: PDH/PDL a day; PWH/PWL and weekly open a week; PMH/PML and monthly open a month. | As ruled; the key enforces it. |
| P5 | **Cost:** one 15m kline call per coin per 15 min at `limit = 2` (weight 1), so 20 an hour ≈ **0.33 weight / min**, plus 5 per day for 1d bars. **Late:** a 15m close older than 20 min is journalled late, not sent. | Small. |
| P6 | **Message:** «BTC: пробой PWH 71 850 — 15m закрылась на 72 140»; «BTC: снятие ликвидности над PWH 71 850 — хвост до 72 300, закрытие 71 700». Link `?at=<bar open>&tf=15m`. | Level names stay English (C3); the sentence is translated. |
| P7 | **Controls:** `touch`: every 15m bar that reached a level **without** going beyond, the natural baseline for "does a sweep or breakout differ from a touch?"; `random` as before. Volume: a few per coin and day. | Touches are the population a breakout or sweep is drawn from. |
| P8 | **History run (C4):** 90 days of 15m klines per coin (≈ 8 640 bars, 6 pages × 10 weight, once). Counts a week per level kind and event, and 5–10 examples. | Klines exist for any span; 90 days covers three months of monthly levels. |
| P9 | **Custom levels (low priority, last):**<br>• `alert_custom_levels`: id, symbol, price, note, created_by, created_at, deleted_at;<br>• added and deleted in `/admin/alerts` and with the bot commands `/level BTC 72000` and `/level del <id>` (admins only);<br>• same events as P3. Repeats: one per (level, event) **per UTC day**, since a custom level has no period. | As ruled. The day bound is my call: without one, a level that is broken once would never speak again. |

## 5. Chart (low priority)

- Marks on the instrument page where a liquidation alert or a funding alert fired, like V15's divergence marks. They are listed in the legend and can be hidden, remembered per viewer.
- PMH/PML and the weekly and monthly open drawn next to the existing PDH/PDL and PWH/PWL lines, from the shared module (P1). Hideable.
- The data is the journal rows for the visible window: one DB read, no venue call.

## 6. Disk and weight, the whole stream (arithmetic)

| Part | Venue weight | DB |
|---|---|---|
| Liquidations | 0 (tape) | a few alerts a day, ≤ 240 near-misses a day at worst, 10 random a day |
| Funding | ≈ 0.3 / min | a handful a week, 10 state rows |
| Levels | ≈ 0.33 / min | a few a day per coin |
| Paths, all subjects | 8 per subject, spread out | 3 rows per subject |

The stream adds **< 1 weight / min** to Binance in steady state and a few MB a year to disk.

## 7. Order and tasks

| Task | What | Depends on |
|---|---|---|
| IB-122 | Liquidations core: migration (generic tables C1, `alert_type_settings`, `users.liq_alerts`, paths FK), L1–L8, `/admin/alerts` liq section, member toggle hidden, texts. Sending **off**. | Market round 2 on the box (owner), unless a slot would sit idle |
| IB-123 | Liquidations history run and owner report (L9, C4) | IB-122 |
| IB-124 | Funding core: F1–F8, `alert_funding_state`, `users.funding_alerts`, admin section, texts | IB-123 (the owner's liq decision first, per the brief's order) |
| IB-125 | Funding history run and owner report (F9) | IB-124 |
| IB-126 | Levels core: P1 (shared module), P2–P7, `users.level_alerts`, admin section, texts | IB-125 |
| IB-127 | Levels history run and owner report (P8) | IB-126 |
| IB-128 | Custom levels (P9) | IB-127 |
| IB-129 | Chart marks and level lines (§5) | IB-122, IB-126 |

**Migrations** (amended 2026-11-05: 029 is IB-118's `market_cap_total`; 030 is IB-130's dominance columns, market round 2 §7, and IB-122 depends on IB-130 so 030 reaches the box first): planned **IB-122 031, IB-124 032, IB-126 033, IB-128 034**. The history runs (IB-123/125/127) and IB-129 add none. Each task still re-checks **every ref** at commit time and takes the next free number if these moved.
