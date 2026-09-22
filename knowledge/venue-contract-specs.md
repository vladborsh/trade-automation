# Venue contract specifications — leverage caps, lot sizes, minimum sizes

Reference for anything that sizes an order against a real venue: the manual
backtest app (`architecture/backtest-app-system-design.md` §6, decision 25 as
amended 2026-09-22) and, later, the Integration Engineer's live sizing rules.
Researched by the Architect on 2026-09-22 for T-035. **Every figure below is
configuration** (`apps/signal-server/config/instruments.yaml`, `contract:`
block) — this file explains where the numbers come from and which regime was
chosen; the YAML is what the code reads.

## 0. The one model both venues fit

Every instrument this project trades quotes a **quantity** whose notional in
the quote currency is

```
notional = qty × multiplier × price
```

- **Binance USDⓈ-M perpetuals**: `qty` is coins; `multiplier = 1` (one
  contract = 1 BTC / 1 ETH); price in USDT.
- **Capital.com CFDs**: `qty` is what the platform calls "quantity" /
  "trade size"; Capital.com computes exposure as *quantity × price* for every
  market ("the full position size – also known as the notional value"; e.g.
  "0.6 contracts on the US Tech 100, priced at 20140. Your full exposure would
  be $12,084" — [pricing page][cc-pricing]). So `multiplier = 1` for indices
  (one contract = one index unit = 1 USD per index point), for DXY (one
  contract = one index unit = 1 USD per index point, same exposure formula;
  the API's `lotSize` for epic `DXY` is the field that confirms it — §4), and
  for FX, where `qty` is **units of the base currency** and the notional is in
  the quote currency. The "standard lot = 100,000" the user quoted is a
  *display* convention (`displayLot` in the YAML), not a contract multiplier:
  Capital.com's minimum FX trade is 100 units, not 0.001 lots.

Because every `multiplier` is 1 today, adding the concept changes no existing
number; it exists so gold-style contracts (`lotSize` ≠ 1) or a venue that
quotes in lots can be added by configuration alone (brief decision 15).

## 1. Leverage depends on the regulated entity, not the instrument alone

Capital.com runs several entities and shows a different margin requirement
per entity for the same market. Read on 2026-09-22 from the public market
pages (retail defaults; the footer of each page names the entity):

| Market | EU — Capital Com Group Ltd, CySEC 463/25 (`/en-eu/`) | UK — Capital Com (UK) Ltd, FCA 793714 (`/en-gb/`) | International — Capital Com Online Investments Ltd, SCB Bahamas SIA-F245 (`/en-int/`, `capital.com/…`) |
|---|---|---|---|
| US100 (US Tech 100) | margin **5.00 %** (20:1), min qty 0.001 [[eu-us100]] | page not published under `/en-gb/` at the time of reading | margin 1.00 % (100:1), min qty 0.001 [[int-us100]] |
| US500 (US 500) | margin **5.00 %** (20:1), min qty 0.01 [[eu-us500]] | — | margin 1.00 % (100:1), min qty 0.01 [[int-us500]] |
| DXY (US Dollar Index) | margin **10.00 %** (10:1), min qty 1 [[eu-dxy]] | margin 10.00 % (10:1), min qty 1 [[gb-dxy]] | margin 1.00 % (100:1), min qty 1 [[int-dxy]] |
| EURUSD | margin **3.33 %** (30:1), min qty 100 [[eu-eurusd]] | — | — |
| GBPUSD | margin **3.33 %** (30:1), min qty 100 [[eu-gbpusd]] | — | — |
| GBPCHF | — | margin 3.33 % (30:1), min qty 100 [[gb-gbpchf]] | — |
| EURCHF | — | — | margin 1.00 % (100:1), min qty 100 [[int-eurchf]] |
| BTC/USD CFD (not ours, for scale) | margin 50.00 % (2:1) [[eu-btc]] | | |

The EU/UK column is the ESMA product-intervention regime, mirrored by the
FCA since 1 August 2019: "30:1 for major currency pairs; 20:1 for non-major
currency pairs, gold and major indices; 10:1 for commodities other than gold
and non-major equity indices; 5:1 for individual equities and other reference
values; 2:1 for cryptocurrencies" [[esma]] [[fca]]. A *major currency pair*
under ESMA is any two of USD, EUR, JPY, GBP, CAD, CHF — so all four of our
pairs (EURUSD, GBPUSD, EURCHF, GBPCHF) are majors at 30:1; the two US
indices are major indices at 20:1; DXY is "other" at 10:1 (Capital.com's own
EU and UK pages agree: 10 %).

**Regime chosen for the app: EU/UK retail (ESMA/FCA).** Reasons: (1) the
user's own figure for FX, "~30×", is exactly this regime and is *not* the
international entity's 100×; (2) it is the conservative one — a trader who
practises at 100× on indices would learn sizes an EU/UK account rejects,
whereas the reverse only leaves margin unused; (3) EURCHF's international page
(100×) contradicts the user's 30× for the same pair, which settles that the
user's account is not on the SCB entity. If the account turns out to be on
another entity, the numbers change in the YAML only (§4 says how to check).

Binance is one regime, but **tiered**: the headline 125× applies to the
first notional bracket only and steps down as the position grows (the
bracket table is `GET /fapi/v1/leverageBracket`, authenticated; the public
page is [[binance-lev]]). Third-party sources report 150× on BTCUSDT/ETHUSDT
in 2025–26 for small notionals; the user's brief says 125× and that is what
the YAML carries. Bracket-dependent caps are out of scope for v1: the app
checks against the *first-bracket cap*, which is the most permissive, and the
journal shows the implied leverage so a trader sees when they lean on it.

## 2. Lot, step and minimum size

| Instrument | qty unit | multiplier | min qty | qty step | min notional | source |
|---|---|---|---|---|---|---|
| binance:BTCUSDT | BTC | 1 | 0.001 | 0.001 | 50 USDT | `fapi/v1/exchangeInfo` LOT_SIZE / MIN_NOTIONAL, read 2026-09-22 [[binance-ei]] |
| binance:ETHUSDT | ETH | 1 | 0.001 | 0.001 | 20 USDT | same |
| capitalcom:US100 | contracts (1 USD/pt) | 1 | 0.001 | 0.001 † | — | [[eu-us100]] |
| capitalcom:US500 | contracts (1 USD/pt) | 1 | 0.01 | 0.01 † | — | [[eu-us500]] |
| capitalcom:DXY | contracts (1 USD/pt) | 1 ‡ | 1 | 1 † | — | [[eu-dxy]] |
| capitalcom:EURUSD | EUR (base units) | 1 | 100 | 100 † | — | [[eu-eurusd]] |
| capitalcom:GBPUSD | GBP | 1 | 100 | 100 † | — | [[eu-gbpusd]] |
| capitalcom:EURCHF | EUR | 1 | 100 | 100 † | — | min from [[int-eurchf]]; leverage per §1 regime |
| capitalcom:GBPCHF | GBP | 1 | 100 | 100 † | — | [[gb-gbpchf]] |

† Capital.com's public pages show the minimum but not the increment. The
increment is the API's `dealingRules.minSizeIncrement` (§4). Until it is
read, **the step is set equal to the minimum** — the conservative choice
(a coarser step only rounds a size down further; it never lets through a
size the venue would refuse).

‡ DXY's multiplier of 1 is inferred from Capital.com's uniform
"quantity × price" exposure formula and its DXY page quoting a *quantity* of
1 at a ~100 price (≈ 100 USD notional, 10 USD margin at 10 %). It is the one
figure in this table not read off a page that states it; the API's
`instrument.lotSize` for `DXY` confirms or corrects it (§4).

## 3. Where the numbers live and how they are used

`instruments.yaml` → `contract:` block per instrument (schema
`ContractSpecSchema` in `libs/contracts/src/instrument.ts`):

```yaml
contract:
  unit: BTC            # what qty counts, for display
  multiplier: 1        # quote-currency value of a 1.0 price move per 1 qty
  minQty: 0.001
  qtyStep: 0.001
  minNotional: 50      # optional; venue's minimum order notional
  maxLeverage: 125     # the regime's cap for this market
  displayLot: 100000   # optional; FX only — "20,000 EUR (0.20 lots)"
  # source: <url>, read <date>, entity <…>
```

Sizing, margin and the refusal rules are replay-core's (`sizing/`) — see the
system design §6 (amended). In one line each: qty from risk is **rounded
down** to `qtyStep`; below `minQty`/`minNotional` the order is **refused**
(`SIZE_BELOW_MINIMUM`); initial margin is `notional / maxLeverage`; an order
whose margin exceeds `equity − usedMargin` is **refused**
(`INSUFFICIENT_MARGIN`); no maintenance margin, no liquidation (decision 25's
"no liquidation" stands).

## 4. Confirming with the live API (needs the broker credentials)

The market pages are per-entity marketing pages; the account's *own*
dealing rules come from the authenticated API and also reveal which entity
the account is on. The Architect must not call it (credentials). Request for
the Tech Lead, with the user's go-ahead, from the coordinator's checkout
(the `CAPITAL_COM_*` env already holds the key):

```
POST {CAPITAL_COM_BASE_URL}/api/v1/session
  headers: X-CAP-API-KEY: <key>;  body: {"identifier": "<login>", "password": "<api password>"}
  → response headers CST and X-SECURITY-TOKEN

GET {CAPITAL_COM_BASE_URL}/api/v1/markets/{epic}    for epic in US100 US500 DXY EURUSD GBPUSD EURCHF GBPCHF
  headers: CST: <cst>;  X-SECURITY-TOKEN: <token>
  keep: instrument.lotSize, instrument.marginFactor, instrument.marginFactorUnit, instrument.currency,
        dealingRules.minDealSize, dealingRules.minSizeIncrement, dealingRules.maxDealSize
```

Seven GETs, once; no polling, no venue weight concern. Paste the seven
`instrument`+`dealingRules` objects (no account fields) into the T-035 task
thread. Mapping: `marginFactor` (PERCENTAGE) → `maxLeverage = 100 /
marginFactor`; `minDealSize` → `minQty`; `minSizeIncrement` → `qtyStep`;
`lotSize` → `multiplier`. Differences from §2 are YAML edits, not code.

## Sources

- [cc-pricing]: https://capital.com/en-eu/ways-to-trade/pricing — worked examples ("1 contract on the UK 100 … 1 contract × 1 point = £1"; "0.6 contracts on the US Tech 100, priced at 20140 … exposure $12,084"), read 2026-09-22.
- [eu-us100]: https://capital.com/en-eu/markets/indices/us-tech-100-index-1 — margin 5.00 %, min 0.001, CySEC 463/25.
- [eu-us500]: https://capital.com/en-eu/markets/indices/us-500-index-1 — margin 5.00 %, min 0.01.
- [eu-dxy]: https://capital.com/en-eu/markets/indices/us-dollar-index-index-1 — margin 10.00 %, min 1, spread 0.054.
- [gb-dxy]: https://capital.com/en-gb/us-dollar-index — margin 10.00 %, min 1, FCA 793714.
- [int-us100]: https://capital.com/en-int/markets/indices/us-tech-100-index-1 — margin 1.00 %, min 0.001.
- [int-us500]: https://capital.com/en-int/markets/indices/us-500-index-1 — margin 1.00 %, min 0.01.
- [int-dxy]: https://capital.com/us-dollar-index — margin 1.00 %, min 1.
- [eu-eurusd]: https://capital.com/en-eu/markets/forex/euro-us-dollar-rate-2 — margin 3.33 %, min 100.
- [eu-gbpusd]: https://capital.com/en-eu/markets/forex/british-pound-us-dollar-rate-2 — margin 3.33 %, min 100.
- [gb-gbpchf]: https://capital.com/en-gb/markets/forex/gbp-chf-rate — margin 3.33 %, min 100, FCA.
- [int-eurchf]: https://capital.com/eur-chf-rate — margin 1.00 %, min 100, SCB SIA-F245.
- [eu-btc]: https://capital.com/en-eu/markets/cryptocurrencies/bitcoin-to-us-dollar-chart — margin 50.00 %.
- [esma]: https://www.esma.europa.eu/press-news/esma-news/esma-agrees-prohibit-binary-options-and-restrict-cfds-protect-retail-investors — the 30:1 … 2:1 list.
- [fca]: https://www.fca.org.uk/publications/policy-statements/ps19-18-restricting-contract-difference-products-sold-retail-clients — "between 30:1 and 2:1", from 1 August 2019.
- [binance-ei]: https://fapi.binance.com/fapi/v1/exchangeInfo — public; BTCUSDT/ETHUSDT LOT_SIZE stepSize 0.001, minQty 0.001; MIN_NOTIONAL 50 / 20.
- [binance-lev]: https://www.binance.com/en/futures/trading-rules/perpetual/leverage-margin — bracket table (client-rendered; not readable without a browser).
- Capital.com API field names (`lotSize`, `marginFactor`, `dealingRules.minSizeIncrement`, …): https://open-api.capital.com/ and https://github.com/capital-com-sv/capital-api-postman.
- Capital.com help centre pages ("What is the maximum leverage?", "What is the minimum trade size?") returned 403 to automated fetches on 2026-09-22; their content as quoted by search engines (indices min 0.1 "depends on the instrument", forex min 500 units) is *older* than the market pages above and was not used.
