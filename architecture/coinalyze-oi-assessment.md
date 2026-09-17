# Coinalyze open interest — is it the same measurement as ours, and should we ingest it?

Assessment only; no production code was changed by this task. All live figures were read on
**2026-09-17** (Binance calls ~17:40 UTC, Coinalyze page read ~17:5x UTC). Sources are cited
inline; anything that could only be answered from behind Coinalyze's authenticated API is
marked **[needs key]** and left as the user's decision — no credential was requested, used or
stored.

---

## 1. Bottom line

1. **No — it is not the same measurement.** Their default BTC line is a **USD notional
   aggregate across ten exchanges**, including inverse (coin-margined) contracts and dated
   futures. Ours is **one contract** (Binance USDⓈ-M `BTCUSDT` perp) in **BTC base units**.
2. The units difference alone is enough to make the two lines disagree in *direction*: in the
   last 24 h our series is **+1.171 % in BTC but +2.652 % in USD notional**, because price
   moved +1.464 %.
3. The scope difference is ~3×: our single symbol is **$8.34 b** of Coinalyze's **$26.5 b**
   BTC aggregate.
4. **Adopt: conditionally, and not as a replacement.** Their unique win is *daily* OI with
   unbounded history (Binance serves nothing past 30 d); their intraday retention is *worse*
   than ours at 5 m (~5–7 days vs our 30).
5. **Nothing to build yet.** One named next step below: tag units on `MetricObservation` —
   a prerequisite for any second OI source, and a latent-bug fix regardless.

---

## 2. Side-by-side

| | **Ours** (`BinanceMetricsAdapter`) | **Coinalyze** |
|---|---|---|
| **Aggregation scope** | Single venue, single contract: Binance USDⓈ-M perp `BTCUSDT` (`fapi.binance.com`). No COIN-M, no USDC, no dated futures, no other venue. | Web chart: **10 exchanges** for BTC — Binance, Bitfinex, Bybit, Deribit, Huobi, Hyperliquid, Kraken, OKX, WOO X, dYdX — perps **and** dated futures, coin-margined **and** stablecoin-margined. "For the moment only BTC/USD, BTC/USDT and BTC/USDC contracts are included." Per-contract checkboxes in the indicator settings make it user-selectable. **API**: per-market symbols only (`BTCUSDT_PERP.A`), no aggregate symbol — aggregation would be ours to do. |
| **Units** | **Base asset (BTC)** — `value = sumOpenInterest`. `notional = sumOpenInterestValue` (USDT) is carried alongside on history rows only, and **is not what the panel plots**. | Three separate indicators: *Aggregated OI* = **USD**; *Aggregated OI COIN-margined* = **USD**; *Aggregated OI STABLECOIN-margined* = **COIN (BTC)**. The default, and the one the user is most likely looking at, is the USD one. Per-contract pages state the unit in the title — Binance `BTCUSDT` is "(Denominated in BTC)", i.e. identical to ours. API: `oi_lq_vol_denominated_in` ∈ `BASE_ASSET`\|`QUOTE_ASSET`\|`CONTRACTS` per market, with an optional `convert_to_usd=true`. |
| **Conversion price** | None applied — we never convert. (`sumOpenInterestValue` is Binance's own figure; Binance does not publish which price it uses.) | **Not documented.** Inverse contracts need no conversion — they are natively USD (Binance `BTCUSD_PERP` OI is 12,305,071 contracts × $100 = $1.231 b). Linear contracts are converted "to USD (notional value)", but the price used and the instant it is taken are not published on the blog, the chart page or the API spec. **[needs key]** to verify empirically. |
| **Grain** | History **5 m** (finest `openInterestHist` offers); live tip polled at **60 s**, stored as raw observations, so the recent window is 1 m-spaced. | `1min, 5min, 15min, 30min, 1hour, 2hour, 4hour, 6hour, 12hour, daily`. **1 m history is finer than anything Binance will serve us.** |
| **Retention** | **Exactly 30 d** at 5 m, enforced by the venue as `-1130` on an older `startTime`; our own `MetricStore` is the long-term archive. | "We keep only between 1500 and 2000 datapoints for intraday timeframe/granularity (1 minute till 12 hours), the old data is deleted each day. For daily timeframe/granularity we do not delete the old data." → 1 m ≈ **25–33 h**; 5 m ≈ **5.2–6.9 d**; 15 m ≈ **16–21 d**; 30 m ≈ **31–41 d**; 1 h ≈ **62–83 d**; 4 h ≈ **250–333 d**; 12 h ≈ **2–2.7 y**; **daily = unbounded**. |
| **Bucketing rule** | **Last observation in bucket** (`bucketObservations`) — not an average, not a period close. | **OHLC per interval**: `candlestick_oi = {t, o, h, l, c}` where `c` = "Open interest at the end of the interval". So their `c` **is** a close-of-period reading, and taking `c` is semantically compatible with our last-in-bucket rule. `o/h/l` are extra we do not have. |
| **Live tip latency** | 60 s poll of `/fapi/v1/openInterest` (weight 1); no OI WebSocket exists at Binance. | `GET /open-interest` returns `{symbol, value, update}` with an ms timestamp; **refresh cadence undocumented [needs key]**. The public *aggregated coin* pages are explicitly **not** live: "This chart is not updated in real-time yet. For real-time charts please see the Markets page." |
| **Cost** | $0, no key, 2400 weight/min budget of which we use ~1 %. | API free, **but requires an account + API key**; **40 calls/min per key**, 429 with `Retry-After` past it; each symbol in a `symbols=` list **consumes one call**. No paid API tier is advertised; the only paid product is the $10.95/month ad-free website. |

### Licensing, plainly

There is **no API terms-of-service document**. The entire licence statement is one bullet in
the API docs: *"The API is free, if you use the API/data in public places: news articles, blog
posts, charts etc. please be kind and cite the data source, add link to Coinalyze website if
possible."* The site's Disclaimer supplies the other half: everything is *"provided on an 'as
is' basis and without warranties of any kind"*, with no representation as to *"the accuracy,
reliability, availability, veracity, timeliness"* and no liability for loss.

For our use — internal ingestion into our own charts and strategies, not public
redistribution — that is **permissive in practice and unwritten in law**. There is no
contractual uptime, no accuracy guarantee, and nothing stopping them changing or withdrawing
the free tier. Fine for a research/context feed; **not** something to put a trading decision's
sole dependency on.

### Things their OI line carries that ours does not

Named, not evaluated: coin-margined vs stablecoin-margined split as separate indicators;
per-exchange / per-contract selection; OI **open/high/low** per bar, not just close;
`convert_to_usd` normalisation; and adjacent series on the same API — funding rate, *predicted*
funding rate, liquidation history (long/short split), long/short ratio, and OHLCV with buy/sell
volume and trade counts.

---

## 3. The BTCUSDT 24 h comparison

**Coinalyze's own figures for a specific window are not obtainable without a key** — every
`api.coinalyze.net/v1/*` endpoint returns `401 {"message":"Invalid/Missing API key"}`,
including `/exchanges` and `/future-markets`, and the public chart pages render their series
in JavaScript. The closest public evidence is the headline statistics block on their BTC Open
Interest page, which is what the user sees, substituted below.

**Our side** — `GET /futures/data/openInterestHist?symbol=BTCUSDT&period=5m`, 300 rows,
2026-09-16 16:45 → 2026-09-17 17:40 UTC (~25 h):

| | start | end | change |
|---|---|---|---|
| `sumOpenInterest` (BTC) — **what our panel plots** | 107,297.788 | 108,554.070 | **+1.171 %** |
| `sumOpenInterestValue` (USDT notional) | 8,118,161,528 | 8,333,467,990 | **+2.652 %** |
| implied price (value ÷ OI) | 75,660.10 | 76,767.90 | +1.464 % |

**Coinalyze's side**, BTC Open Interest page, read 2026-09-17:

| | All | Perpetual | Futures |
|---|---|---|---|
| Open Interest | **$26.5 b** | $25.3 b | $1.2 b |
| OI Change 24 H | **+1.58 %** | +1.54 % | +2.57 % |

**Do they agree? No, and the gap decomposes cleanly:**

- **Level — scope.** Our whole series is one of their ~30 contracts. Binance BTC perps alone,
  priced at the 76,758.60 mark: `BTCUSDT` 108,586.985 BTC = **$8.335 b**, `BTCUSDC`
  19,567.660 BTC = **$1.502 b**, COIN-M `BTCUSD_PERP` 12,305,071 × $100 = **$1.231 b** —
  ≈ $11.07 b, about **44 % of their $25.3 b perpetual aggregate**, with our single plotted
  symbol at **33 %**. The remaining ~$14 b is Bybit, OKX, Hyperliquid, Deribit,
  Kraken, Huobi, Bitfinex, WOO X and dYdX — venues we do not touch — plus dated futures.
- **Slope — units.** Their +1.58 % is a **USD** change; the comparable number from our data is
  **+2.652 %**, not the **+1.171 %** on our chart. The 1.48 pp gap between our two columns is
  exactly the 1.464 % price move: *an OI line in USD moves when price moves even if not one
  contract changed hands.* Their figure sitting between the two is consistent with a
  price-inflated USD series diluted by venues whose contract count grew less than ours.
- **Not attributable to grain or bucketing.** Their `c` (close-of-interval) and our
  last-in-bucket are the same rule, and both series are far finer than a 24 h delta.

So: **scope explains the level, units explain the slope.** Neither number is wrong; they are
answers to different questions.

---

## 4. What we would gain, what it would cost

### Gain

1. **Daily OI with unbounded history.** This is the only thing here we genuinely cannot get.
   Binance hard-stops at 30 days; `data.binance.vision` 5 m CSVs (chart-layouts §4.3) are an
   offline path we have never built. A one-call-per-symbol daily series going back years is
   directly useful to the derivatives-positioning research package.
2. **Multi-venue context.** A Binance-only OI line silently mis-reads any regime where
   positioning migrates to Hyperliquid/Bybit. The aggregate is the honest denominator.
3. **Adjacent metrics for free** — funding, predicted funding, liquidations, long/short ratio
   — all on the same key and the same `MetricKind` extension point already reserved in
   `MetricKindSchema`.
4. **1 m intraday grain**, finer than Binance's 5 m floor — but see the retention trap below.

### Cost

1. **Intraday retention is a regression, not an upgrade.** At 5 m they keep ~5–7 days against
   our 30. We would be *adding* a source that must be polled continuously to accumulate what
   Binance hands us in one backfill. Their 1 m series survives about a day.
2. **Rate budget.** 40 calls/min, one call per symbol. Rebuilding their aggregate ourselves
   over the 53 BTC contracts they list is 53 calls (two minutes of budget) — for one
   instrument, one metric, one interval. Multi-instrument aggregate ingestion is not free the
   way our Binance calls are (~1 % of a 2400 weight/min budget).
3. **A key to provision, rotate and keep out of the repo** — a class of operational burden our
   market-data path does not currently have at all.
4. **No SLA, no accuracy warranty, no written licence.** See "Licensing, plainly".

### Engineering shape — does `MetricAdapter` already fit?

Checked hardest where the spec asked. **It does not fit, and the reason is the contract, not
the port.**

- **`MetricObservation.value` is an untagged scalar.** Its documented meaning is
  *"contracts outstanding in base-asset units"* — a comment, not a field. A USD aggregate
  would write dollars into the same slot with nothing on the wire, in the store, or in the
  chart axis to say so. Every existing consumer (`MetricCache`, `FileMetricStore`, the WS
  `metrics` topic, the panel) would render it silently and wrongly.
  This is **already a latent hazard without Coinalyze**: the moment anyone adds Binance COIN-M,
  `/dapi/v1/openInterest` returns *contracts* (12,305,071), not BTC — a third unit into the
  same field, off by ~10⁵.
- **`notional` does not rescue it.** It is optional, absent on the live snapshot (so the tip of
  every series has no USD value at all), and quote-currency — undefined for a cross-venue
  USD/USDT/USDC mixture.
- **The adapter registry is keyed by venue.** `buildMetricAdapters(): Map<Venue, MetricAdapter>`
  and `MetricIngestionService` resolves via `this.adapters.get(instrument.venue)`. Coinalyze is
  a *provider*, not a venue: `BTCUSDT` still trades on Binance. Adding `'coinalyze'` to
  `VenueSchema` would be a lie that propagates into `instruments.yaml`, `VenueStatus` and
  health. The honest change is a **source axis** — resolve an adapter by
  `(metric, source)` with `source` defaulting to the instrument's venue, and let a metric panel
  in `layouts.yaml` name a non-default source.
- **`fetchObservations` / `fetchLatest` themselves fit fine.** Ascending history with internal
  pagination, one snapshot per call — Coinalyze's `from`/`to`-in-seconds history and
  `/open-interest` map onto both without strain. `bucketObservations` also fits: take `c`.
- **An aggregate is a fan-out, not a fetch.** With no aggregate symbol in the API, one
  `fetchObservations` call becomes N market calls that must be summed on a common time grid,
  with a policy for a venue that is missing a bar. That is real logic with real failure modes,
  and it belongs behind the port, not in it.

Verdict: **a second scalar field is the wrong fix; a unit tag plus a source axis is the right
one.** Both are small, and the first is worth doing on its own merits.

---

## 5. Recommendation + routing

**Do not adopt Coinalyze as a replacement for the Binance feed, and do not adopt it alongside
yet.** The Binance direct feed is better on every axis we currently use — deeper at 5 m, no
key, no rate pressure, no third-party dependency — and the one thing Coinalyze uniquely offers
(unbounded daily OI, multi-venue) has no consumer in the codebase today. Building a
multi-venue aggregate now would be a source we would have to babysit in order to accumulate
history for a strategy that does not exist.

**One named next step — and it is not a Coinalyze integration:**

> **Add a unit tag to `MetricObservation`.** `unit: 'base' | 'quote' | 'contracts'` (required,
> written by every mapper, carried through `MetricPoint`, the store and the WS payload, and
> surfaced on the panel's axis label). This is a small, self-contained change that (a) fixes a
> real latent defect — Binance COIN-M would today write contract counts into a field
> documented as base units — and (b) is the unavoidable prerequisite for *any* second OI
> source, Coinalyze or otherwise. Ship it independently of this decision.

Revisit Coinalyze if and only if one of these becomes true: a strategy requires OI history
older than 30 days; or a strategy requires cross-venue positioning rather than Binance-only.
At that point the second step — a `source` axis on metric panels and adapter resolution — is
the gate to open, and the daily-granularity endpoint (unbounded history, 1 call) is the
cheapest possible first integration.

---

## 6. Для пользователя — чем их индикатор ОИ отличается от нашего

**Коротко: это два разных числа, и оба правильные — они просто отвечают на разные вопросы.**

*Открытый интерес (ОИ)* — это сколько всего фьючерсных позиций сейчас открыто и не закрыто.
Не «сколько наторговали за день», а «сколько висит прямо сейчас».

**Наш график** показывает **один контракт на одной бирже** — вечный фьючерс `BTCUSDT` на
Binance — и меряет его **в биткоинах**. Сегодня это ≈ 108 600 BTC.

**Их график (Coinalyze, по умолчанию)** складывает **десять бирж** (Binance, Bybit, OKX,
Deribit, Hyperliquid, Kraken, Huobi, Bitfinex, WOO X, dYdX), и вечные, и срочные контракты, и
меряет всё **в долларах**. Сегодня это ≈ 26,5 млрд $.

То есть: **у них — много бирж в долларах, у нас — одна биржа в биткоинах.** Обе разницы важны,
и вторая важнее первой:

1. **Масштаб (много бирж против одной).** Наша линия — это примерно **треть** их линии.
   Всё, что происходит на Bybit, OKX и Hyperliquid, мы просто не видим.
2. **Единицы (доллары против биткоинов) — вот главная ловушка.** Долларовая линия растёт, когда
   растёт цена биткоина, даже если не открылась **ни одна новая позиция**. Наша линия в
   биткоинах так не делает — она меняется только когда реально открывают или закрывают позиции.
   Живой пример за последние сутки (17.09.2026): наш ОИ **+1,17 % в биткоинах**, но тот же
   самый ОИ **+2,65 % в долларах**, потому что цена за те же сутки выросла на 1,46 %. У
   Coinalyze на главной написано **+1,58 %** — и это тоже долларовая цифра. Смотреть на
   долларовую линию и думать «позиций стало сильно больше» — типичная ошибка: часть роста это
   просто подорожавший биткоин.
3. **Глубина истории.** Тут мы неожиданно лучше. Binance отдаёт нам 5-минутные точки за
   **30 дней**. Coinalyze на 5-минутном масштабе хранит всего **1500–2000 точек ≈ 5–7 дней**, на
   1-минутном — около суток. Зато их **дневные** данные не удаляются никогда — вот это у нас
   получить неоткуда.
4. **Способ сборки свечи** — одинаковый. И у них, и у нас в точке за период стоит **последнее
   значение** внутри этого периода, а не среднее. Здесь расхождений нет.

**Что полезнее для того, что мы делаем?** Для торговых сигналов — **наша** линия: она в
биткоинах, значит движется только от реальных действий трейдеров, а не от цены, и по ней
честно видно «набирают позицию» или «закрывают». Их долларовая линия полезна как **фон**: она
показывает, куда смотрит весь рынок целиком, и предупреждает, если позиции переезжают с Binance
на другие биржи — тогда наша одна линия начнёт врать про общую картину.

**Стоит ли подключать Coinalyze?** Пока — **нет**. Их API бесплатный, но требует ключ, разрешает
только 40 запросов в минуту, каждая биржа считается отдельным запросом, никаких гарантий
точности и доступности они не дают, и на нашем рабочем 5-минутном масштабе истории у них
**меньше**, чем у Binance. Подключать имеет смысл только когда появится конкретная задача:
либо нужна история ОИ **старше 30 дней**, либо нужна картина **по всем биржам сразу**. До
этого момента разумнее сделать одну маленькую вещь у себя — **подписать единицы измерения**
прямо в данных (биткоины / доллары / контракты), чтобы никто и никогда не перепутал одно с
другим на графике.

---

## Sources

- Coinalyze API documentation (OpenAPI spec, incl. rate limit, retention, `candlestick_oi`
  OHLC fields, `oi_lq_vol_denominated_in`, `convert_to_usd`) — <https://api.coinalyze.net/v1/doc/>
- Coinalyze blog, "Aggregated Open Interest" (units of the three indicators) —
  <https://coinalyze.net/blog/aggregated-open-interest/>
- Coinalyze, Bitcoin (BTC) Open Interest (aggregate definition, exchange list, headline stats,
  "not updated in real-time yet") — <https://coinalyze.net/bitcoin/open-interest/>
- Coinalyze, Binance BTCUSDT Open Interest Chart ("Denominated in BTC") —
  <https://coinalyze.net/bitcoin/usdt/binance/open-interest-chart/btcusdt_perp_oi/>
- Coinalyze Disclaimer (as-is, no warranty) — <https://coinalyze.net/disclaimer/>
- Coinalyze Ad-Free Version ($10.95/month) — <https://coinalyze.net/subscription/ad-free-version/>
- Binance USDⓈ-M `/futures/data/openInterestHist`, `/fapi/v1/openInterest`,
  `/fapi/v1/premiumIndex` and COIN-M `/dapi/v1/openInterest`, queried live 2026-09-17.
- Ours: `libs/contracts/src/metric.ts`, `apps/signal-server/src/market-data/metrics/**`,
  `architecture/chart-layouts.md` §4, `architecture/panel-sync-and-oi-depth-diagnosis.md` Bug 2.
