# Perpetual-swap carry, basis and the margin path

Reference definitions for the hedged spot–perp carry family
(`research/hedged-carry/ARCHITECT-NOTE.md`, designed 2026-09-16) and for
anything that later prices funding as P&L. The measured facts cited are from
the closed funding-rate pass (`research/funding-rate-signals/REPORT.md`,
Запись 29). Status of the hedged family: **designed, not yet run.**

## Funding

- Binance USD-M perps exchange **funding** at 00:00 / 08:00 / 16:00 UTC.
  Rate `f` is per 8 h; positive → longs pay shorts. Paid only to positions
  open at the settlement instant; no pro-rata accrual.
- `f = premium component + interest component`; the interest component is
  **0.01 %/8 h** (≈ 11 % p.a.), so "zero premium" prints as 0.01 %, not 0.
- Archive: `data.binance.vision/data/futures/um/monthly/fundingRate/`,
  columns `calc_time, funding_interval_hours, last_funding_rate`. Interval
  is 8 h everywhere except SOLUSDT 2022-11-09 20:00 .. 2022-11-18 16:00 UTC
  (8→4→2→8 h, rate at the −2 % cap for part of it) — the standing SOL
  blackout (`ARCHITECT-RULING-2026-09-16-stage0.md`).
- Measured (2020–2025-07 fit, 8 symbols): the extreme-positive state (rolling
  90-settlement pct ≥ 90 and `f ≥ 0.03 %`) survives 3 settlements 40 % of
  the time and 9 settlements 28 %; forward mean rate ≈ 0.058 %/8 h ≈ 63 %
  annualised. Funding-selected entries collect 25–37× more carry than
  trailing-return-selected ones: **funding is not price in disguise**.
- Cost of ignoring it: a long-biased 1 h continuation strategy pays
  0.0009–0.0033R per trade in funding, 1.4–24 % of its edge (REPORT §4.4).

## Basis

`b_t = P_perp / P_spot − 1` from same-open-time 1 h closes. A short-perp /
long-spot position **receives** `b` at entry and **pays** `b` at unwind;
`hedge_pnl ≈ N·(b_entry − b_exit)`. Positive funding and positive basis go
together (the premium index is what funding is computed from), so a carry
position entered in a premium and unwound at par gains on basis as well as
on funding. The 1 h-close basis of two archive feeds is a proxy for the
tradable spread; bars with |b| > 5 % are data anomalies.

## The hedged carry trade (Schmeling, Schrimpf & Todorov, *Crypto Carry*)

Long spot, short perp, equal notional: flat in price to first order,
collects funding and the basis round trip. Literature: > 10 % p.a. average,
≈ 60 % in bull phases, on notional. In this project's units (capital =
notional + perp margin) the passive average is ≈ 6.7 % p.a. at 2× perp
leverage — between the kill (5 %) and build (10 %) bars of the hedged
family's ladder. Round trip at Binance VIP 0 taker: spot 0.10 % + perp
0.05 % per side = 0.30 %, plus spread; ≈ 6 days of carry at a 0.02 %/8 h
rate, ≈ 2 days at 0.058 %. **Holds must be weeks, not days.**

## The margin path (why a naive carry P&L overstates the trade)

Isolated USDT margin `M = N/L` on the short perp; spot gains sit in the spot
wallet and (on a plain account) cannot be posted. With maintenance margin
rate `mmr` and funding collected `F`:

```
liquidation when   M + F − N·x  ≤  mmr · N · (1 + x)
x_liq = (1/L + F/N − mmr) / (1 + mmr)
```

| L | x_liq (mmr 1 %) | re-centre trigger at ½ buffer |
|---|---|---|
| 2 | ≈ 48.5 % | ≈ +24 % |
| 3 | ≈ 32.0 % | ≈ +16 % |
| 5 | ≈ 18.8 % | ≈ +9.4 % |
| 10 | ≈ 8.9 % | ≈ +4.5 % |

A liquidation turns the hedge into a naked spot long at the top of a rally,
charges a liquidation fee, and forces a re-hedge at the worst basis. The
hedged family models it on the 1 h high, counts re-centres and liquidations,
and fails any build with a liquidation at 2×. Account types where spot is
collateral (Multi-Assets Mode for BTC/ETH/BNB; Portfolio Margin) change the
path fundamentally and are a descriptive counterfactual, not the primary.

## Units for a carry verdict

R (stop distance) is undefined for a hedged position. The verdict unit is
**one UTC day of a tier portfolio's return on allocated capital**; carry is
an accrual, so it reaches the mean unattenuated (`a = 1`, unlike the
0.45–0.60 of a ±1R bracket), and at plausible daily sd (≈ 0.1 %) the level
bar (10 % p.a.) binds long before the α gate. The +0.05R/+0.10R per-trade
ladder converts to ≈ 4.8 %/9.5 % p.a. of notional at the funding family's
frequency and risk unit, and is applied on capital (1.5× stricter).
