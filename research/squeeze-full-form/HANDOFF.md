# HANDOFF — `squeeze-full-form` (insight-bot P1 / P2 research gate) → Architect

**From:** Researcher (Opus 5) · **Date:** 2026-09-28 · **Branch:**
`vladborsh/researcher-squeeze-full-form` · **Package:**
`research/squeeze-full-form/` · **Full write-up:** `REPORT.md` (plain-Russian
summary at its end) · **Log:** `RESEARCH-LOG.md` Запись 37.

---

## 1. What you need to decide

**Nothing is being promoted.** All four registered arms are **UNDERPOWERED**
(fit `n` = 0 / 0 / 0 / 6 against a floor of 60); the holdout was never
simulated. Decisions that are yours:

1. **Whether UNDERPOWERED closes the squeeze family.** The note closes it on a
   *kill*; this is not a kill. My recommendation is **treat it as closed** and
   do not add `playbooks/p1.ts` / `p2.ts` (IB design §9.4): the full form fires
   ~0 times a year on 8 symbols; every rung with power (R0, R1, shadows) is
   zero or negative; the only well-powered control (P1-M shadow, −0.188R,
   90 % CI [−0.343, −0.028]) is significantly negative — the third
   independent reading of this shape on this tape (b1, funding B, here).
2. **The live/historical venue-count mismatch** if P1/P2 are ever revived:
   historically "≥ 2 venues" = Binance **and** Bybit (OKX's REST serves only
   ≈ 97 days, first settlement 2026-06-22 on every symbol); the bot's frame
   counts three venues, where "≥ 2" = two of three — looser than what was
   tested. Irrelevant if (1) closes the family.
3. **Frame keys that now have no consumer** (only if (1) closes it):
   `structure.failed_highs_24h`, `structure.impulse_low_15m`,
   `oi.at_7d_high` were introduced for P1/P2 (design §8.2). They are cheap
   and harmless as context; whether they stay in `frame_version` 1 is a
   design call.

## 2. Verdicts, mechanically (`results/fit_arms.csv`)

| arm | fit `n` | fit mean netR | shadow `n` / mean | placebo `p` | verdict |
|---|---|---|---|---|---|
| P1-M | 0 | — | 122 / −0.188 | — | UNDERPOWERED — holdout not read |
| P1-A | 0 | — | 298 / −0.049 | — | UNDERPOWERED — holdout not read |
| P2-M | 0 | — | 14 / +0.234 (unreliable, < 30) | — | UNDERPOWERED — holdout not read |
| P2-A | 6 | −0.013 | 21 / −0.190 (unreliable) | 0.463 | UNDERPOWERED — holdout not read |

`run_holdout.py` exists and refuses to run: `results/screen.json` is false
for all four arms.

## 3. α ledger and holdout register

- Registered: 4 arms, α = 0.0125. **Holdout reads: 0.** 2025-08-01 …
  2026-07-31 and the 2026-08 tail were not simulated for any arm, rung or
  shadow.
- **One holdout-period *frequency* fact was read** in the STAGE-0 audit
  (`results/condition_rates.csv`): how often each arming condition held on
  holdout decision instants — no prices after entry, no R. It shows the
  two-venue extreme-positive state **never** occurred in the holdout year on
  any symbol. I report it because it is decision-relevant for the product
  (P1 would have been silent for a year); flagging it so you can judge
  whether it counts as a read.

## 4. The answer to the user's question — the ablation ladder (REPORT §4)

- **+ second venue:** removes 30–35 % of setups, improves nothing (the two
  rates correlate 0.69–0.91; `results/venue_sync.txt`).
- **+ OI +5 %/24 h at 7-day high:** removes 97 % of P1 setups (65 → 2
  majors, 154 → 8 alts). "At the 7-day high" is the binding clause: 15 of 943
  two-venue funding extremes coincide with it (`results/p1_oi_cooccurrence.txt`).
- **+ failed highs, + spot CVD:** nothing left to measure.
- No rung, in any arm, has a 90 % CI excluding zero on the positive side.

## 5. Things found along the way that matter beyond this pass

1. **OKX funding history is not recoverable over REST** (≈ 3 months). Every
   day the collectors do not run loses OKX funding permanently — supports the
   collectors-first ordering. Bybit REST is complete back to listing
   (2020-03 BTC … 2021-06 SOL/BNB).
2. **`data.binance.vision` metrics (OI) start 2021-12-01 for every symbol but
   BTCUSDT (2020-09-01)** — the other seven return 404 for 2020-09 … 2021-11.
   Any future OI-based pass has no alt OI for the 2021 bull market from this
   source. (`deriv-positioning` only probed from 2022-08, so this was not on
   record.)
3. **The draft's structural T1 ("VWAP of the rise") is geometrically
   impossible with its own trigger** — entry is below the whole rise, so its
   VWAP is always on the stop side (REPORT §6). If any squeeze-shaped
   playbook is ever drafted again, its target needs redefining.
4. **Extreme positive funding on both venues vanished in 2022 and again in
   the holdout year** — the shape is bound to over-levered bull regimes.

## 6. What a build would have needed (for the record)

Not applicable — no build. Had any arm passed, the thresholds in DESIGN §3–§5
would have been `playbook_config` v1 with the [R-fix] definitions (16 h venue
staleness, "first close below the impulse low since the high", P2 stop at the
24 h low − 0.2·ATR, ≥ 8 h = three consecutive 4h instants).

## 7. Reproduce

```
cd research/squeeze-full-form
python3 fetch_data.py            # ~25 min; public endpoints only
python3 prep.py && python3 data_audit.py
python3 checks.py                # 8/8 must be green
python3 run_fit.py               # ~5 s
python3 run_holdout.py           # no-op unless screen.json passes an arm
```
