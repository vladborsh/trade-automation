# `/liquidations` as «episodes» (2026-11-05)

**Author:** Architect (insight-bot stream). **Inputs:**
- `reports/coordinator-liq-episodes-2026-11-05.md`: the owner's rulings 1–5 and the order;
- `reports/dev-1-IB-BUG-039.md`: the box is clean. The $1.46B rows are COIN-M `BTCUSD_PERP` rows found only in `insight_coord`.

**Mockup** (committed): `architecture/mockups/liq-episodes-2026-11-05/`
- `liq-v2-desktop.png` and `liq-v2-phone.png`;
- `liq-page-v2.html`.

**Its numbers and texts are illustrative**, not taken from the box. Where its prose disagrees with this note, this note wins; E11 lists every such place. Acceptance is a visual side-by-side at **1240 and 390 px** and no horizontal scroll at 390.

**Builds on:**
- `market-round2-design-2026-11-05.md` §4: IB-120's page. Its flat list, filters and help-block are kept, and IB-132 adds the nav item.
- D20: no forecasts.
- `alerts-liq-funding-levels-design-2026-11-05.md` L1–L9: alerts use their own 5-minute window and **do not** share this rule (E10).

**Cluster** `ib-market-2`. Order (owner): after IB-119, before the alerts build.

## E1. What an episode is

An episode is a run of liquidation prints with these properties:
- each print is **≥ $100K** (`SERIES_MIN_USD`, the same floor as R3/Market's series);
- all prints are on **one side**;
- **market-wide**: every coin, every venue we collect;
- neighbouring prints are **less than 3 min apart** (`EPISODE_GAP_SEC = 180`). A gap of 3 min or more starts a new episode.

It is a candidate until its sum clears the norm (E2).

Its fields:
- `from`, the first print's time;
- `to`, the last print's time;
- the count;
- the USD sum;
- the sum per coin, by base coin across venues;
- each venue's share;
- the sum per minute.

**Not the Market "series"** (`groupSeries`: ≥ 3 prints within 10 min of the first). That is a different grouping for a different question (R3, the Market block). The help names the difference (E9), so one cascade showing as two cards here and one series on Market is explained, not a contradiction.

**Constants live in `insights/thresholds.ts`** next to `SERIES_*`: `EPISODE_GAP_SEC`, `EPISODE_TARGET_PER_WEEK`, `EPISODE_NORM_DAYS` and `EPISODE_FLOOR_USD`.

## E2. The norm: a threshold set by rate, not by dollars

The owner's worry was "50+ episodes". A fixed dollar threshold either floods a hot week or empties a calm month. So the threshold is **the level that, over the trailing norm window, would have produced the target rate**:

```
held   = min(30 d, the time the tape has existed on this database)
k      = max(1, round(EPISODE_TARGET_PER_WEEK × held_days / 7))      target 7.5 a week
T      = max(EPISODE_FLOOR_USD, the k-th largest candidate sum in the trailing `held`)   floor $1M
```

An episode is a candidate with `usd ≥ T`. This is the brief's "percentile of episode sums", with the percentile chosen by the target rate rather than guessed:
- In a month of normal activity, the last 7 days show about 7–8 episodes.
- A week hotter than the month shows more, up to the cap (E3).
- A calm week shows fewer, possibly none, which is the honest answer.

**Details:**
- **The window includes the current week.** The norm describes the market, and the current week is part of it. Excluding it would make a single violent week look like 30 episodes and hit the cap every time.
- **One threshold for both 24h and 7d.** With the same T, a 24h view shows about one episode on an ordinary day. «За 24 часа эпизодов не было» is a valid answer.
- **Computed hourly, cached 1 h.** The work is one query over the trailing 30 days of prints ≥ $100K, grouped in SQL by window functions (the query below), and it returns only the candidate sums. Box rate: about 750 such prints on the hot day 2026-11-04, so ≤ ≈ 25 000 rows a month. The norm is market-wide and unfiltered, so a filter never moves T (E5).
- **Short history.** `held` is what exists. On a tape shorter than 7 days the response says so («норма по {d} дн.»). Under **1 day** held there is no norm: the page shows the flat list and a line «копим историю для эпизодов: {h} ч».
- **No minimum k on a short tape** (decided 2026-11-05 after IB-133's replay). Under about 1.5 days held, k = 1, so only the largest candidate shows. The box replay had T = $99M on 11-04 16–22 h. Today it is k = 2, T = $34.9M, with 2.1 days held: the late-venue rule starts the window at 11-03 12:47, and D6 drops 180 tradfi prints that this note's SQL counted. That is the target rate scaled to what is held, about 2 in 2 days, so the page is right, not sparse.
  - A minimum k (for example 3) would show three episodes from one day of tape. That overstates the rate threefold, and it adds a constant and a spec for a state that ends on the box around 11-10 and otherwise exists only on fresh slot databases.
  - The «норма по {d} дн.» label explains the small count.
- **Venue set:** all three venues, and all were present from the box's first row. If a venue joins later, IB-038's rule applies: the window starts when the last venue started (`norm.ts`).

### Measured on the box (`insight`), read-only, 2026-11-05

**Population:**
- prints ≥ $100K, all venues;
- tape **2026-11-03 00:08 → 2026-11-05 13:05 UTC (2.54 days)**, the box's whole history;
- COIN-M patterns of migration 022 excluded explicitly: the box has none (IB-BUG-039), and the filter makes that a fact of the query, not of the data.

The query (`scratchpad`, run by SSM with `default_transaction_read_only=on`):

```sql
with p as (select ts, side, notional from liquidations where notional >= 100000
             and not (venue='binance' and (symbol ~ '^[A-Z0-9]+USD_(PERP|[0-9]{6})$' or symbol ~ '^[A-Z0-9]+(BTC|ETH|BNB)$'))),
g as (select *, case when lag(ts) over w is null or ts - lag(ts) over w >= interval '3 min' then 1 else 0 end brk
        from p window w as (partition by side order by ts)),
e as (select *, sum(brk) over (partition by side order by ts) eid from g)
select side, min(ts), max(ts), count(*), sum(notional) from e group by side, eid order by 2;
```

**151 candidates in 2.54 days.**

| threshold | episodes, 2.54 d | ≈ per week (×7/2.54) | 11-03 | 11-04 | 11-05 (to 13:05) |
|---|---|---|---|---|---|
| ≥ $2M | 20 | 55 | | | |
| ≥ $5M | 9 | 25 | 1 | 7 | 1 |
| ≥ $10M | 5 | 14 | 0 | 4 | 1 |
| ≥ $20M | 3 | 8 | 0 | 3 | 0 |
| ≥ $50M | 1 | 3 | 0 | 1 | 0 |
| **E2 rule (k = 3, T = $23.9M)** | **3** | 8 (by construction) | 0 | 3 | 0 |

The largest five:

| side | start (UTC) | duration | prints | sum |
|---|---|---|---|---|
| shorts | 11-04 14:58 | 22 min | 183 | $99.5M |
| longs | 11-04 02:55 | 13 min | 127 | $41.5M |
| shorts | 11-04 14:37 | 7 min | 70 | $23.9M |
| shorts | 11-04 14:47 | 2 min | 57 | $17.1M |
| longs | 11-05 12:31 | 10 min | 31 | $15.5M |

**What this does and does not show:**
- **2.54 days is not a week, and one of them (11-04) was exceptional.** "Per week" in the table is an extrapolation, not a weekly count. There is no box week to count yet. The rule was chosen because it does not depend on this sample: whatever the month looks like, it targets about 7.5 a week.
- **Weekly counts on the box are part of IB-133's acceptance:**
  - the rule replayed for every full week held;
  - the same figure again at 14 and at 30 days, in the report.
- If those land outside 5–10 a week, `EPISODE_TARGET_PER_WEEK` is the one knob. Do not move the gap or the floor.
- **One cascade can be several episodes.** The 11-04 afternoon (14:37, 14:47, 14:58) is three candidates under the owner's gap of 3 min. Under 5 min the first two would merge. This note keeps 3 min (owner) and records the effect, so nobody reads three cards as three events by accident. The help says it (E9).
- `insight_coord` was not used for the counts. Even after excluding COIN-M its sums run higher (largest $115M against the box's $99.5M) because its pre-fix dist (IB-BUG-039) collected a different symbol set. The box is the population.

## E3. Cap and fold

- **7d: at most 10 cards; 24h: at most 5.** The largest are shown first, by sum. Within the shown set, cards are ordered **by sum**, not by time, as in the mockup.
- The rest become one line, «ещё {n} эпизодов поменьше», next to the link «все ликвидации списком →». **The link carries no count** (IB-120 ruling); the mockup's «все 1 000 ликвидаций» is wrong (E11).
- Episodes below T are not episodes and are not counted anywhere on the page.

## E4. Summary line

«За {7 дней|24 часа} — {N} эпизодов: {s} раза выбивали шортов, {l} раза лонгов. Крупнейший — {d MMM HH:MM}, {COIN}, ${X} за {m} минут.»
- **N counts all episodes ≥ T**, before the cap.
- `{COIN}` is the episode's largest coin by sum.
- Russian plurals go through i18n.
- With N = 0: «За {period} эпизодов не было (порог сейчас ${T}).»
- Under the summary: the mockup's amber line about not repeating Market (ruling 1). It is true as written.
- Times are in the page's existing time zone and formatter (IB-120), not a new one.

## E5. Filters

The filter row is kept as it is today (period, coin, minimum, venue, side), because the owner ruled "as now". Their meaning on the episode view:

| Filter | Effect on episodes |
|---|---|
| period | 24h / 7d window and cap (E3). |
| side | Only episodes of that side. |
| coin | Only episodes **containing** that coin. The card's figures stay **whole-episode**, with the chosen coin's chip highlighted. An episode is market-wide by definition, so re-cutting it per coin would need a per-coin norm, and that is not this page. |
| venue | Only episodes with that venue's prints. Figures stay whole-episode, as for coin. |
| minimum ($100K / $1M) | **Does not change episodes.** E1's $100K floor defines them. It applies to the expanded print list (E6) and the flat list. The help says so. |

Episodes are computed **once per period over the whole market** and filtered after, which is IB-120's `groupSeries` rule: "a filter never splits a cascade".

## E6. The card

**Left:**
- rank;
- `from–to` (a single print shows one time);
- side («Шорты выбиты» green / «Лонги выбиты» red: the existing side colours);
- sum.

**Middle:**
- «{n} ликвидаций за {m} минут»: `m = max(1, ceil((to − from)/60 s))`, plurals through i18n;
- a coin sentence:
  - «Только {COIN}» when one coin is 100 %;
  - «Почти всё — {COIN}» when it is ≥ 80 %;
  - otherwise none, and the chips speak.
  - The mockup's «ETH и альты» is dropped: "alts" is not defined by any code (E11).
- coin chips: the top 3 by sum, then «ещё {n}»;
- venue chips: each venue's share, rounded, summing to 100 (largest remainder), shown only when more than one venue took part.

**Right: the mini chart.**
- **The price coin is the episode's largest coin.** The price, «во время», «через 4 ч» and «Открыть {COIN} в HH:MM →» all name **the same coin**. The mockup's second card shows BTC prices under an ETH-led episode with an ETH link; that is wrong (E11).
- **The price line:** Binance perp **1-minute closes** for that coin, from `from − 60 min` to `to + 240 min`, x by time.
- **Shading:** the episode span `[from, to]`.
- **Bars:** the episode's liquidations per minute (USD, our tape), under the line, in the side's colour.
- No axes, as in the mockup; «−1ч» and «+4ч» at the ends.

**Facts under the chart (D20, no forecast words):**
- «{COIN} во время: {open of from's minute} → {close of to's minute} {±x.x %}»
- «через 4 ч: {close of the minute at to + 4 h} {±x.x % against the episode end}»
- Until `to + 4 h` has passed (one closed minute after it), «через 4 ч: ещё не прошло», and the line ends at the last closed minute.
- The % colour is up/down as a plain move.

**Link:** «Открыть {COIN} в {HH:MM} →» goes to `/instrument/<SYM>?at=<from, sec>`. The query parameter is the existing `?at=<unix sec>` (IB-098, `features/instrument/focus-at.ts`). Do not invent another. Check whether `?span=` (IB-BUG-023) frames the episode better, and say which one you used.

**Tap to expand:** up to **20 largest prints** of the episode (time, coin, venue, side, USD). The minimum filter applies; if it leaves none: «нет ликвидаций от $1M в этом эпизоде». The prints come in the response (E7), so expanding is not a request.

**Phone:** one column, the chart under the chips at full card width, as `liq-v2-phone.png`. No table on the main view.

## E7. API

`GET /api/web/liquidations/episodes?p=24h|7d&coin=&venue=&side=`
- The same query parsing as `/large`: closed sets except the coin; an unknown value is a 400.
- `min` is accepted and applied to `prints` only.

```
WebLiquidationEpisodesResponse {
  asOf
  period
  norm: { thresholdUsd, heldDays, k, targetPerWeek } | { collectingHours }   // E2; collecting = under 1 day held
  summary: { count, shorts, longs, largestId | null }                         // count before the cap
  episodes: WebLiquidationEpisode[]      // ≤ 10 (7d) / ≤ 5 (24h), by usd desc
  folded: number                         // episodes ≥ T not shown
}
WebLiquidationEpisode {
  id                                     // `${side}-${fromSec}`, stable
  side, from, to, count, usd
  coins: [{ base, symbol, usd }]         // all, desc; the client cuts to 3 + «ещё n»
  venues: [{ venue, pct }]               // largest-remainder, sums to 100
  perMinute: [{ time, usd }]
  price: { symbol, points: [{ time, close }], startOpen, endClose, after4hClose | null } | null
  prints: [{ time, base, venue, usd }]   // ≤ 20, largest first, after `min`
}
```

- `price` is null when the coin has no Binance perp in the universe or the read failed (soft: the card still renders, with no chart and a muted «нет цены»).
- Contracts are the first commit, zod-parsed by the client.

## E8. Cost: Binance weight, cache, memory, DB

**Price paths.** IB-115's exact-limit read `closedKlines(coin, tf, fromMs, limit)` gains **`'1m'`**. One path is `60 + span + 240` ≈ 300–330 bars, **one request at weight 2** (limit 100–499; Binance `fapi` klines weight table).
- **Cache per episode id:** **1 h** while `to + 4 h` is still ahead; **24 h** once the path is complete, since a past minute does not change.
- Bounded to **64 entries**, which covers 10 (7d) + 5 (24h) with room for coin/venue filters showing other episodes.

**Weight.**
- Cold: ≤ 10 paths × 2 = **20 weight once**, then about 0.
- Steady: each new episode costs 2, plus about 2 per still-open path per hour, so **≪ 1 weight/min** (2400/min budget, about 1 % used).
- No other venue call. The norm and the episodes come from our tape (weight 0).

**Caches.**
- Norm 1 h.
- Per-period episode base 10 s, matching the page's 10 s poll like `/large`: one query per period per 10 s, filters applied in memory, with the IB-120 bound of ≤ 32 filter keys.

**Memory.**
- A 7d base: ≤ ≈ 5 000 prints ≥ $100K at about 100 B ≈ 0.5 MB transient.
- Paths: 64 × 330 × 16 B ≈ 340 KB.
- The norm: ≤ a few thousand numbers.
- All well inside the IB-096 128 MB heap cap.

**DB:** no new table and **no migration**. Episodes are derived on read. If query time on 30 days is ever a concern, the existing `(ts)` partitioning bounds it; measure before adding anything.

## E9. Help (the help-block, rewritten for episodes)

The mockup's footer is the starting point. Corrections against this note:
- «Эпизод — подряд идущие ликвидации одной стороны от $100K, по всему рынку, с паузами меньше 3 минут.»
- «Эпизодом считается то, что крупнее обычного для рынка: порог — сумма, которую за последние {d} дней превышали примерно 7–8 раз в неделю; сейчас ${T}. Порог меняется вместе с рынком.» This replaces the mockup's «на сумму от $5M».
- «Один каскад с паузой 3 минуты и больше показывается двумя эпизодами. На «Рынке» серии считаются иначе (3 ликвидации за 10 минут), поэтому числа могут не совпадать.»
- «Фильтр «от $1M» не меняет эпизоды — только список ликвидаций внутри карточки и общий список.»
- The chart sentence as in the mockup, plus «цена — по самой крупной монете эпизода».
- «Цена «во время» и «через 4 ч» — факт, не прогноз.» (kept)

**Each factual clause is checked against the server code at review** (IB-120/121 lesson). The dev cites the constant or function behind each.

## E10. Not shared with alerts

The liquidation alerts (L1–L9) use a sliding 5-minute window, a 30-min quiet period and their own thresholds. Episodes are a read-time display grouping. They are separate on purpose: an alert must fire **during** a cascade, while an episode is drawn **after** it.

If the owner later wants "an alert per episode", that is a new decision, not a reuse of this code.

## E11. Where the mockup is wrong (this note wins)

1. «на сумму от $5M» is a fixed figure, which the owner ruled out. Use E2's T, shown live.
2. Card 2: «BTC во время» under an ETH-led episode whose link opens ETH. Price, facts and link all use the largest coin.
3. «ETH и альты» has no definition. Use E6's coin sentence.
4. «все 1 000 ликвидаций списком» carries a count, which IB-120 dropped. Use «все ликвидации списком →».
5. «ещё 3 эпизода» becomes «ещё {n} эпизодов поменьше» (E3).
6. Card 3, «5 ликвидаций за 9 минут» at $7M: under E2 on the box today, a $7M episode is below T and would not be a card. The mockup's numbers are illustrative only.

## E12. Tasks

| Row | What | Depends on |
|---|---|---|
| **IB-133** (P1) | Server: E1 grouping (pure, own spec), E2 norm, E7 endpoint + contracts, E8 `'1m'` path read and caches. Report: weekly counts replayed on the box (E2) and the weight measured. | IB-120 (the page and query rules), IB-BUG-039 (done: box clean) |
| **IB-134** (P1) | Client: E3–E6 cards, chart (pure geometry helper + spec), summary, fold, flat list behind the link, E9 help; side-by-side 1240/390. | IB-133, IB-132 (nav) |

The owner's order puts these after IB-119 and before the alerts build. The TL owns that priority. Nothing here gates IB-122 technically: there is no migration and no shared code.
