# session-liquidity — BoS pass (corrected, pinned-anchor mechanic)

The pass that finally measures break-of-structure correctly.
Read `REPORT.md` for findings, `HANDOFF.md` for the Architect summary,
`results/TABLES.md` for every number and `results/GALLERY.md` for the audit
panels. `DESIGN.md` is the Architect's brief, executed as written.

## Why this package exists

Phase 1 (`../session-liquidity/`) shipped BoS numbers computed by a mechanic
that **overwrote its tested level every time any new `k=3` pivot confirmed**,
including pivots confirming *after* the take-out. It was therefore testing a
level nobody was watching when the sweep happened. v2/v3/v4 excluded BoS
entirely rather than carry the defect forward. The diagnosis and the user's two
hand-drawn sketches are in
`../session-liquidity/corrections/BOS-CORRECTION-NOTE.md`.

## The mechanic (`DESIGN.md` §1, `knowledge/session-liquidity.md` §5.2 / V6)

High sweep; low sweep is the exact mirror.

1. **Anchor**, at the take-out bar `t0`: the most recent pivot **low**
   confirmed as of `t0` (`fractals(df, k=3)`, reused verbatim from
   `../intraday-mr-smc/indicators.py`).
2. **Pinned** — fixed for the life of the event, drawn as a forward ray.
   **No re-anchoring, ever.** That is the whole correction.
3. **Break** = the first **close** beyond it inside `[t0, end of sweep_block]`.
   One break maximum.
4. No qualifying pivot → **unanchorable**, its own reported category
   (measured: 0 of 23,423).
5. No break before block end → unconfirmed.

Everything else — sessions, the level pool, the block-scoped horizon, ATR
units, the from-confirmation geometry — is v2/v4 unchanged, and `checks.py`
asserts it.

## Headline

| | corrected BoS | phase-1 BoS | iFVG v4 |
|---|---|---|---|
| confirmation rate (primary) | **33.8%** | 82.4% | 64.4% |
| median delay | 18 bars | 19 bars | 15 bars |
| median stop proxy | 5.77 ATR | 3.86 ATR | 2.67 ATR |
| median R proxy | **0.41** | 0.51 | 0.84 |
| forward lift (non-circular) | **0.87** | 0.74 | 0.83 |

Both methods confirm only 15.6% of the same take-outs. Neither selects.

## Files

| file | what |
|---|---|
| `common.py` | forked v4 plumbing + the `k=3` pivot layer |
| `engine.py` | three arms on identical events: corrected BoS, phase-1 BoS, iFVG-v4 |
| `tables.py` | `results/TABLES.md` + a CSV per table (blocks B/T/D/M/W/H/A) |
| `charts.py` | `viz/01..07` — start with `05_selection.png` |
| `examples.py` | the panel renderer; **draws the anchor ray on every panel** |
| `gallery.py` | 28 stratified, seeded, un-curated panels + `results/GALLERY.md` |
| `checks.py` | 18 assertions incl. anchor precedence and immutability — all pass |
| `session_liquidity_bos.pine`, `RUNBOOK.md` | the manual TradingView audit |

## Run

```
cd research/session-liquidity-bos
python engine.py && python tables.py && python charts.py \
  && python examples.py && python gallery.py && python checks.py
```

`data/` is a symlink to the shared 5m cache. No new data pull.
