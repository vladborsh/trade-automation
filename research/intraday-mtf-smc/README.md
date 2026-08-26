# research/intraday-mtf-smc — multi-timeframe SMC (1h context / 5m execution)

Execution of `../intraday-mr-smc/MTF-SMC-DESIGN.md`, the Architect's
pre-committed research protocol for re-encoding SMC across two timeframes.

**Read `REPORT.md` for the findings.** Headline: all three pre-registered
rule-sets (Variant A, Variant B-sweep, Variant B-choch) **fail stage 1** — the
signal-level probe of design §5.3 — on very large samples, so stages 2 and 3
were not run and the holdout window was never read. Decision gate §5.7 resolves
to *retire SMC-as-entry in full*.

Imports v1 (`../intraday-mr-smc`: `indicators.py`, `strategies.py`,
`backtest.py`) and v2 (`strategies_v2.py`, for the control probe only) unchanged;
nothing in either package is modified. Data (`data/`) and caches (`cache/`) are
gitignored — regenerate with `fetch_mtf.py` and `prep.py`.

See `REPORT.md` §7 for the run order and a file-by-file map.
