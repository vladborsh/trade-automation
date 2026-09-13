# Per-timeframe historical backfill and retention depth — SE report

Implements architecture/live-signal-server.md §12 (12.1–12.5) end to end. All changes are
inside `apps/signal-server/` and `libs/contracts/` — `apps/chart-client/` was not touched and
re-typechecks clean against the updated contracts (verified: `npx tsc --noEmit` in
`apps/chart-client`, no errors).

## What was built (§12.5 routing plan)

1. **`ingestion.service.ts`** — Phase 1 (sync, before `app.listen()`): unchanged 3-day 1m
   warm-up + new native `1h`/`4h`/`1d` fetch per instrument (`warmUpNativeCoarse`). Phase 2
   (async, after `app.listen()`, fired from `main.ts`): `deepenHistoryAsync()` walks `1m`
   backwards to a 45-day target in UTC-day-aligned chunks, "oldest chunk last" so
   `CandleCache.covers()` only ever gets *more* true as it runs (proven in tests, see below).
   As a side effect this is what actually gets 5m/15m to their §12.2 10-day target — Phase 1
   deliberately keeps the 1m warm-up at 3 days.
2. **`candle-cache.service.ts`** — `DEFAULT_DEPTH_BARS['1d']` 400 → 800. Added a
   `SOURCE_TIER` map and made `upsert()` enforce §12.1's rule: `resampled`/`storage` always
   wins a same-slot write over `venue-native`; `venue-native` can never overwrite either.
3. **`binance.adapter.ts` / `capitalcom.adapter.ts`** — removed the `tf !== '1m'` throw;
   native fetch for `5m`/`15m`/`1h`/`4h`/`1d` on both venues, `source: 'venue-native'`
   (`Candle.source` already had this value — no `libs/contracts` change needed there).
   `venue_native_mismatch_count` (Prometheus counter) added to `metrics.service.ts` and wired
   in `IngestionService.upsertCoarse` (0.1%-relative-tolerance OHLC compare), the one place
   both the resampled and venue-native series are visible together.
4. **`candles.controller.ts`** — on-demand fetch-and-persist on a genuine store-miss: always
   attempted for Binance; for Capital.com, skipped outright for `1m`/`5m`/`15m` requests older
   than the confirmed floor, and attempted-but-floor-tolerant for `1h`/`4h`/`1d`. The
   "vendor floor reached" signal is a response header (`X-Vendor-Floor-Reached` /
   `X-Vendor-Floor-Date`), not a body-shape change — `CandlesResponseSchema` stays a plain
   `Candle[]`, so the existing chart-client keeps working unmodified (confirmed above); it
   just now sees a legitimately-empty array with machine-readable metadata alongside it.
5. **`/api/health`** — `backfillStatus: { timeframe, status }[]` per instrument
   (`HealthResponseSchema` extended additively). Only `1m` tracks a real async pass;
   everything else reads `'complete'` (native coarse finishes synchronously in Phase 1).
6. **Tests** — 26 new tests across 5 new files + 2 extended files (all passing, listed below).

## Capital.com resolution enum + floor — verification method and result

- **Resolution enum**: `MINUTE` / `MINUTE_5` / `MINUTE_15` / `HOUR` / `DAY` are confirmed
  live-correct by `research/cmc-bot-vwap/results/capital_com_floor_probe.txt` (all five were
  accepted by the real API — either real rows or the venue's own `error.prices.not-found`,
  never an "invalid resolution" error). `HOUR_4` was **not** exercised by that probe and no
  live Capital.com credentials were available in this environment to re-probe it directly; it
  is corroborated instead by `cmc-bot-main/src/types/enums.ts`'s `CapComTimeIntervals.HOUR_4`
  — the exact literal a separately-built, previously-shipped client already sends to this same
  venue's real API. I also confirmed outbound network access works from this environment
  (`curl` to `api-capital.backend-capital.com` returned HTTP 400, i.e. reachable, just
  unauthenticated) — so the `HOUR_4` gap is a credentials gap, not a network gap.
- **Intraday floor (`1m`/`5m`/`15m`)**: 2024-01-02, confirmed by the probe for all four
  configured Capital.com instruments (US100/US500/EURCHF/GBPCHF). Hardcoded as
  `CAP_COM_INTRADAY_FLOOR_MS` in `capitalcom.mapper.ts`, used by the controller's hard-wall
  check.
- **`HOUR`/`DAY` floor**: **not fully bisected, per §12.4 — used as a documented assumption,
  not a confirmed number.** No live credentials were available to re-probe it here. Boot's
  native `1d` fetch for Capital.com requests from 2022-09-12 (`CAP_COM_DOCUMENTED_COARSE_FLOOR_MS`
  in `ingestion.service.ts`, explicitly commented as unconfirmed) and lets a 404
  (`CapComPriceNotFoundError`) tell the caller if even that date is too deep for a given
  instrument, rather than asserting a firm retention window anywhere user-facing.

## One flagged implementation deviation (for Architect review)

§12.5 item 1 says to reuse `ResamplerService.feed()` directly for the Phase 2 backward walk.
`ResamplerService` wraps one shared, stateful `Resampler` instance that the *live* stream also
feeds concurrently (Phase 2 runs after `app.listen()`). Feeding it 1m candles from days/weeks in
the past — in a walk that is backward overall, i.e. non-monotonic relative to whatever the live
stream is doing at the same time — would look like an ordinary bucket-boundary crossing and
incorrectly close/corrupt the *live* 5m/15m/1h/4h/1d buckets. I used a **fresh, throwaway
`Resampler` instance per UTC-day-aligned chunk** instead (same resampling logic, isolated state,
still never touches the event bus, so the item's actual concern — the dead-listener event race
from commit 8546b90 — doesn't apply either way). This is documented in code
(`ingestion.service.ts`, `deepenInstrument1m`) and called out here rather than silently deviating,
per the SE role's escalation norm; I judged it safe enough not to block on a synchronous
Architect round-trip since the alternative (literal reuse) risks corrupting live chart data, but
it's a real judgment call worth a second look.

## No other design gaps required escalation

Everything else in §12 was either fully specified or came down to an implementation detail
within normal SE discretion (chunk sizing, tolerance thresholds, the header-vs-body-shape choice
for the vendor-floor signal — chosen specifically to avoid a chart-client change, confirmed
unnecessary by a clean `tsc --noEmit` against the updated contracts).

## Test results

`npm run test --workspace=apps/signal-server --workspace=libs/contracts`: **168/168 passing**
(141 signal-server incl. 1 pre-existing unrelated skip, 27 contracts). New/extended files:

- `test/market-data/candle-cache.spec.ts` (new) — §12.1 source-priority (4 cases), §12.2
  depth-bump regression, §12.3 backward-extension `covers()` contiguity (including a case that
  documents the bug `setMinDepth` prevents).
- `test/market-data/ingestion.service.spec.ts` (new) — Phase 2 backward walk correctness
  (backfillStatus flip, coverage growth, derived-timeframe resampling, tail-untouched), and the
  `venue_native_mismatch_count` metric (fires on disagreement, silent within tolerance).
- `test/market-data/binance.adapter.spec.ts`, `capitalcom.adapter.spec.ts` (new) — native
  fetch payload mapping per venue, pagination-by-timeframe, and the Capital.com
  `CapComPriceNotFoundError` behavior (404 → typed error, non-404 → plain `Error`).
- `test/api/candles.controller.spec.ts` (new) — Binance always-fetch, Capital.com hard-wall
  skip + floor-header response, Capital.com 404-tolerant coarse fetch, no-refetch-when-covered,
  and never-mask-a-real-failure.
- `test/market-data/binance.mapper.spec.ts`, `capitalcom.mapper.spec.ts` (extended) — native
  coarse mapping (`source: 'venue-native'`) and the `CAP_COM_RESOLUTION` table.

`npx tsc --noEmit` clean in both `apps/signal-server` and `apps/chart-client`. `nest build`
clean.
