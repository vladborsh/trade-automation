import { Candle, InstrumentId } from '@trade-automation/contracts';
import { CandleStore } from '../storage/candle-store.port';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** How far back "the last revealed 1m candle" is searched (weekends and holidays fit inside). */
export const LAST_REVEALED_LOOKBACK_DAYS = 7;

/**
 * architecture/backtest-app-system-design.md §5.1, §6 — the last 1m candle revealed at the cursor:
 * the latest with `openTime + 60_000 <= cursorMs`. Its close is `lastClose`; its `openTime` is a
 * market fill's `entry_time_ms` and a manual close's `exit_time_ms`. Walks back one UTC day at a
 * time, at most `LAST_REVEALED_LOOKBACK_DAYS` and never before the instrument's 1m coverage;
 * `null` when nothing is found (the caller answers 422 `NO_PRICE_AT_CURSOR`).
 */
export async function lastRevealed1m(
  store: CandleStore,
  instrument: InstrumentId,
  cursorMs: number,
  lookbackDays = LAST_REVEALED_LOOKBACK_DAYS,
): Promise<Candle | null> {
  const coverage = await store.coverage(instrument, '1m');
  if (!coverage) return null;
  const floor = Math.max(coverage.from, cursorMs - lookbackDays * DAY);
  let to = Math.min(cursorMs - MIN, coverage.to);
  while (to >= floor) {
    const from = Math.max(floor, Math.floor(to / DAY) * DAY);
    const bars = await store.query(instrument, '1m', from, to);
    if (bars.length > 0) return bars[bars.length - 1];
    to = from - 1;
  }
  return null;
}
