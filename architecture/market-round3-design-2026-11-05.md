# Market, round 3: funding floor, quadrant zoom, table search + sticky header, flows help (2026-11-05)

**Author:** Architect (insight-bot stream).

**Input:** `reports/coordinator-market-feedback-3-2026-11-05.md` (the owner on the live site).

**Cluster:** `ib-market-3`. The owner's order is to queue after IB-133/134. The phone overflow (item 3, the bug) is **IB-BUG-041** (TL, dev-3) and is not repeated here.

**Builds on:** `market-page-design-2026-11-03.md`:
- D2 `RARITY_SHOW`;
- D9 the quadrant;
- D16 the table on a phone;
- D20 no forecasts.

Also on `alerts-liq-funding-levels-design-2026-11-05.md` F2/F3.

Every claim below about the code names its file; check them again at build time.

## 1. R5: rare **and** not trivial (IB-135)

### The finding (checked in code)

`R5` (`insights/rules.ts`) shows a coin when `fundingRate.rarity ≥ RARITY_SHOW` (0.90) and nothing else. The rarity is two-sided, against the coin's own 30-day settled rates (`positioning.service.ts`, `fundingSample`). A coin whose funding sits at the 0.01 % base rate for a month makes 0.0206 % "rare", and that is BNB. The same gap exists in `signalOf` (`positioning.rules.ts`): `crowded_long` / `crowded_short` need `rare(fundingRate)` and `rare(lsGlobal)`. So the same trivial BNB could also be labelled «толпа в лонгах» in the table.

### The fix: one floor, shared with the funding alerts

- **One constant** in `insights/thresholds.ts`, next to `RARITY_SHOW`:
  `FUNDING_FLOOR_PER_8H = 0.0003` (a fraction, so 0.03 % per 8 h). This is the owner's F-design floor.
- **IB-124 (funding alerts) imports it as its per-coin default** and does not declare a second one. The alerts design F3 and the IB-124 row are amended to say so.
- **Normalised to 8 h (F2):** `rate × 8 h / interval`, where the interval is the median spacing of the coin's last 3 settlements. `fundingTimes` already exists (IB-118), so this needs no extra call. Today R5 compares the venue's raw rate, and a 4 h coin at 0.02 % pays as much as an 8 h coin at 0.04 %.
- **One helper, `fundingExtreme(rate, rarity, intervalH)`,** in `insights/` (pure, own spec), returns `'high' | 'low' | null`:
  - high when `rarity ≥ RARITY_SHOW` and `rate_8h ≥ +FLOOR`;
  - low when `rarity ≥ RARITY_SHOW` and `rate_8h ≤ −FLOOR`.
- **Users of the helper:**
  - R5's filter (and its `count`, which counts the same set);
  - `signalOf`'s two crowded signals: my call, so that the table and the card cannot disagree about BNB;
  - IB-124's band check (F3 "one shared helper, with a spec that R5 and the alert give the same band").
- **Not changed:** the heat colour of the funding cell. Heat is "rare for this coin", which stays true; the floor decides only whether we **say** something.
- **The sample is still un-normalised.** A coin that switched interval inside its 30 days mixes 4 h and 8 h rates in its rarity sample. This is noted, not fixed here; IB-124's F3 normalises its sample, and when that lands R5 uses the same normalised sample through the helper.

**Spec:**
- BNB-like: rarity 0.95 at 0.0206 % per 8 h → null.
- 0.031 % per 8 h → high.
- A 4 h coin at 0.016 % (0.032 % per 8 h) → high.
- −0.031 % → low.
- R5 and `signalOf` read the same helper (a spec imports both).

### R4: can "rare but trivial" happen there? Yes, at 4h and 24h

`R4` needs `priceChangePct.rarity < RARITY_SHOW`, a non-`flat` quadrant, and ranks by OI rarity. Its only absolute guard is the quadrant's `|ΔOI| ≥ OI_FLAT_PCT` (1 %, `positioning.rules.ts` `quadrantOf`), **the same 1 % at 1h, 4h and 24h**. (7d never qualifies: `changeSample` is null on 7d.) A coin whose OI barely moves can have +1.2 % over 24 h at the top of its own history, and that would be the card. 1 % over a day is unremarkable for most of the universe.

**Proposed floor:** a market-relative one, not a constant.

```
oiFloor[period] = max(OI_FLAT_PCT, median over universe coins of (that coin's median |ΔOI| over `period` in its 30-day baseline))
```

- R4 requires `|ΔOI| ≥ oiFloor[period]`: rare for the coin **and** at least a typical move for the market.
- It is computed hourly with the baselines (`oiHourly`, already in memory), at zero weight.
- **Why not a fixed number like funding's:** funding has a natural zero and a base rate, so a floor in % per 8 h means the same thing every month. A typical OI move depends on the period and the regime. A constant fit to 24h would be wrong at 1h, and one fit to this month wrong next month.
- **Not measured yet.** I have no numbers for these medians. IB-135's report gives, from the box's baselines:
  - `oiFloor` per period now;
  - over a replay of the 30-day baseline at every hour, how many R4 winners the floor removes and which ones.
- If the replay shows it removes nothing, say so and drop it. No code is kept for a case that does not occur.

## 2. Quadrant «Цена × открытый интерес» (IB-137)

### Checked in code

`quadrantLayout` (`positioning/pos-layout.ts`) scales both axes to `niceMax(max |Δ|)`, symmetric around 0 (D9: the quadrant is the reading, so zero is the centre). One TRUMP at +38 % therefore puts every other coin inside a few pixels of the centre. A tap sets `selected` and prints the numbers under the chart (`pos-quadrant.component.ts`). There is no link.

### Views

**«без выбросов» (the default):**
- Each axis's half-range is `niceMax(P80 of |Δ| across placed coins)`, nearest-rank. With 30 coins, about 6 per axis fall outside, and the bulk fills the box.
- Each half-range is floored at `2 × PRICE_FLAT_PCT` (1 %) for price and `2 × OI_FLAT_PCT` (2 %) for OI, so a calm market is not zoomed into noise.
- It stays **symmetric around 0** (D9).

**Outliers are pinned, never dropped:**
- A coin beyond the range on either axis is drawn **on the box edge** at its clamped position. The sign is kept, so the quadrant stays right.
- It is drawn as a small outward arrow (▶ ◀ ▲ ▼, or a diagonal at a corner) with its label and its **true** values, «TRUMP +38 % / +12 %».
- Pinned labels win collisions over in-box labels, since they carry information the position does not.

**«весь»:** today's layout, the max over all coins.

### Zoom and pan

- The view is a **data domain** `{xMin, xMax, yMin, yMax}`. Zooming changes the domain, not a CSS scale, so dots keep their size and labels are re-laid out by the same greedy placer.
- **Pure helpers with specs**, in `pos-layout.ts` or a new `pos-zoom.ts`:
  - `bulkDomain(rows)`;
  - `fullDomain(rows)`;
  - `zoom(domain, factor, anchor)`;
  - `pan(domain, dx, dy)`;
  - `quadrantLayout(rows, size, domain)`, which takes the domain and pins anything outside it.
- **Buttons:** + / − / «весь» / «без выбросов» (the last two are a segmented pair).
- **Limits:**
  - zoom-in stops at a half-range of 0.25 % for price and 0.5 % for OI;
  - zoom-out stops at «весь».
- **Desktop:**
  - the wheel zooms around the pointer **only while the pointer is over the chart**;
  - drag pans when zoomed.
- **Phone:**
  - two-finger pinch zooms;
  - one-finger drag pans **only when zoomed in**. Otherwise the page scrolls: `touch-action: pan-y` unzoomed, `none` zoomed;
  - a page that cannot be scrolled past the chart is worse than no zoom.
- **Corner names** (the four quadrants) show only while the origin is in view. Once panned away from zero they would name the wrong areas. Instead a small «0» marker sits on whichever axis edge zero lies beyond.
- The view is not in the URL: it is a momentary look.

### Click

- **Pointer devices (`(hover: hover)` media query, not width):**
  - hovering a dot shows a tooltip with today's numbers (`positioning.quadrant.detail`);
  - a click opens `/instrument/<SYM>`.
- **Touch:**
  - the first tap shows the same tooltip **with «Открыть →» inside it**;
  - tapping the link opens the coin;
  - tapping elsewhere closes the tooltip.

  A second tap on the dot also opens the coin, but the link is the visible path. This is the coordinator's proposal and I agree with it: a one-tap open on a crowded phone chart would navigate on every mis-tap.
- **The link** is R4's: `/instrument/<SYM>?at=<now − period>` (`rules.ts` R4, IB-BUG-023), so the chart opens on the period the dot describes.
- **Keyboard:** dots are focusable in OI order. Enter opens, focus shows the tooltip.
- Pinned outliers behave the same.

**Acceptance:**
- a side-by-side at 1240 and 390 of «без выбросов» with a real outlier on the box (or a fixture with TRUMP-like +38 %);
- pinch and pan checked on a phone viewport in Playwright with touch emulation;
- the page still scrolls past the chart when unzoomed.

## 3. Table «По монетам»: search and a sticky header (IB-136, after IB-BUG-041)

### Search

- A text box above the table, «Найти монету», filters rows by ticker (`base`): case-insensitive, substring.
- It is in the URL as `?q=`, merged with `p`/`sort` as `positioning-page.component.ts` does.
- A non-empty query **shows all matches** and bypasses the phone «показать все» limit.
- No match: «Нет монет по «{q}»» plus a clear button.
- The quadrant is not filtered: it is a picture of the market. The matching dots may be outlined; that is optional and the dev's call.
- Pure filter function with a spec.

### Sticky header

**The constraint (checked in `pos-heat.component.scss`):** the table sits in `.scroll { overflow-x: auto }` for D16's pinned ticker column. A `position: sticky; top: 0` header inside an `overflow` box sticks to **that box**, not to the page. Because that box does not scroll vertically, a sticky `thead` does nothing today, however it is styled.

**The design:** make the table's own box the vertical scroller too, on /positioning only.
- `.scroll` gets `overflow: auto; max-height: calc(100dvh − <the sticky top nav height> − 16px)`.
- `thead th { position: sticky; top: 0; background: var(--card-bg); z-index: 2 }`.
- The corner cell (`thead th.coin`) is sticky on both axes: `left: 0; top: 0; z-index: 3`.
- The pinned body column stays at `z-index: 1`.
- Opaque backgrounds everywhere, so nothing shows through.
- The heat fills on `td` are translucent over `--card-bg`. Check that a sticky header over them does not show the hatch through.

**Not on the Market block** (`compact()`): it shows a short top-N, so there is nothing to stick.

**Phone:** the same box, one scroller for both axes. With IB-BUG-041's fix the box fits 390 px. The e2e from IB-BUG-041 (`scrollWidth == viewport` at 390 on /positioning and Market) must stay green. Add one assertion: after scrolling the box down, the header row's `getBoundingClientRect().top` equals the box's top.

**Why not page-level sticky:** it needs a JS-mirrored header synced to the horizontal scroll, two copies of the header (an a11y and sort-button duplication), and it breaks the moment the column widths change. The nested scroller is plain CSS.

## 4. Liquidations in the main menu

IB-132: nothing new.

## 5. «Деривативы и потоки» help (IB-138)

The help-block (`ui/help-block.component.ts`, IB-120/121) on the Market flows block: **one collapsed line, never opened by itself**, as the heat help in `compact` mode (`pos-heat-help.component.ts`).

### The draft, checked against code and sources

What each row actually is:

| Row | What the code reads | Draft claim | Verdict |
|---|---|---|---|
| DVOL | Deribit `get_volatility_index_data?currency=BTC`, closes (`flows.service.ts`, `parse.ts` `parseDvol`) | "what options price in for BTC's movement over the next 30 days, in annual %" | **True.** Deribit's DVOL is the 30-day implied volatility of BTC options, annualised. |
| | | "rising = the market pays more for protection and expects big moves" | **Change.** Options get dearer on both sides, not only "protection". "Expects" is a forecast word (D20). Say what the prices imply. |
| Put/call | **OKX** rubik `option/open-interest-volume-ratio?ccy=BTC&period=1D`, the `oiRatio` column, daily | "how many put options per call option" | **True, but name the venue.** This is **BTC options on OKX only**, not the whole market: most BTC options trade on Deribit. Without "на OKX" the row reads as market-wide. |
| | | "above 1, more people are insured against a fall" | **Change.** A put is not only insurance: it can be sold, or be a bet. Say "more open puts than calls". |
| | | "extremes often mean the crowd is already hedged" | **Drop.** It is a contrarian reading presented as a regularity, with no source in our code or data (D20). |
| Stablecoins | DefiLlama `stablecoincharts/all`, `totalCirculating.peggedUSD`: **the number of USD-pegged coins** across chains, daily, not coins × price (TL ruling 2026-11-04, `parse.ts` `parseStablecoinTotals`) | "how many dollar stablecoins exist in total" | **True.** Add "по данным DefiLlama, в монетах, а не по цене". A de-peg does not read as a burn. |
| | | "growth = new dollars came into crypto and can buy; shrinkage = money is leaving" | **Change.** Issuance and redemption are facts. "Can buy" and "money is leaving" claim a use the data does not show. |
| Coinbase premium | Coinbase `BTC-USD` ÷ (Binance **spot** `BTCUSDT` × Coinbase `USDT-USD`) − 1, the mean over the last 60 valid minutes (`premiumSeries`, `premiumTile`, D18) | "how much more (or less) BTC costs on Coinbase than on Binance" | **True; add "в долларах"** (USDT's own price is divided out, so the gap is not a USDT de-peg) and "в среднем за последний час". |
| | | "a positive premium held for a long time = buying through US platforms (often institutional)" | **Change.** It is a price difference; who is buying is not measured. "Often read as" is honest; "=" is not. |

### The text for the block (ru; en via i18n, same meaning)

- **DVOL** — сколько опционы на BTC закладывают в движение цены на ближайшие 30 дней, в % годовых (индекс Deribit). Растёт — опционы дорожают: за защиту и за ставки платят больше. О направлении ничего не говорит.
- **Put/call по открытому интересу** — сколько открыто опционов пут (право продать) на один колл (право купить), по опционам BTC на OKX (не весь рынок; основная торговля опционами BTC идёт на Deribit). Больше 1 — открытых путов больше, чем коллов. Пут бывает и страховкой, и ставкой, поэтому это не сигнал направления.
- **Стейблкоины** — сколько всего долларовых стейблкоинов в обращении, по данным DefiLlama, в монетах, а не по цене (отвязка от доллара не выглядит как сжигание). Рост — выпустили новые, падение — погасили. Куда эти доллары пойдут, отсюда не видно.
- **Премия Coinbase** — насколько BTC на Coinbase дороже (или дешевле) в долларах, чем на Binance, в среднем за последний час (цена USDT учтена). Устойчивая положительная премия часто читается как спрос через американские площадки, но кто покупает, здесь не измеряется.
- A closing line: «Это описание того, что происходит сейчас, а не прогноз.»

**At review, each factual clause names its source line in code** (the IB-120/121 lesson): the endpoint and `ccy`, `peggedUSD`, the D18 formula and the 60-minute window.

## 6. Rows

| Row | What | Depends on |
|---|---|---|
| **IB-135** | §1: `FUNDING_FLOOR_PER_8H`, `fundingExtreme` (normalised), R5 and `signalOf`; the R4 `oiFloor` with the replay report | — |
| **IB-136** | §3: search + sticky header | IB-BUG-041 (the same box and CSS) |
| **IB-137** | §2: quadrant views, pinned outliers, zoom/pan, hover/tap/open | — |
| **IB-138** | §5: the flows help | — |

- **Order:** the owner's, after IB-133/134: IB-BUG-041 → IB-135 → IB-136 → IB-137 → IB-138.
- `depends_on` carries only the technical link (IB-136 on IB-BUG-041). Order and priority are the TL's.

**Budget:**
- venue weight +0: the R4 floor uses baselines already in memory, the funding interval uses `fundingTimes`, and the rest is client work;
- memory: a few numbers per period;
- DB: none, no migration.
