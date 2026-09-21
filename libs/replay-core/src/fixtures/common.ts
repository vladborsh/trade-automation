import { Costs } from '@trade-automation/contracts';
import { PathBar } from '../fill/types';

/**
 * Shared vocabulary of the §6 reference fixtures. Numbers are chosen so every expected value can
 * be checked by hand against the table: spread 2 → half-spread 1, commission 0.1 % per side.
 */
export const FIXTURE_COSTS_ON: Costs = { enabled: true, commissionPct: 0.1, spread: 2 };
/** Same parameters, switched off: no spread and no commission anywhere. */
export const FIXTURE_COSTS_OFF: Costs = { enabled: false, commissionPct: 0.1, spread: 2 };

export const FIXTURE_LONG_ID = '00000000-0000-4000-8000-000000000001';
export const FIXTURE_SHORT_ID = '00000000-0000-4000-8000-000000000002';

/** Monday 2026-01-05 14:00 UTC — the first path candle; candle `i` opens at `T0 + i * 60_000`. */
export const FIXTURE_T0 = Date.UTC(2026, 0, 5, 14, 0);
export const FIXTURE_MIN = 60_000;

export function fixtureTime(i: number): number {
  return FIXTURE_T0 + i * FIXTURE_MIN;
}

/** A path candle `i` minutes after `FIXTURE_T0`. */
export function fixtureBar(i: number, open: number, high: number, low: number, close: number): PathBar {
  return { openTime: fixtureTime(i), open, high, low, close };
}
