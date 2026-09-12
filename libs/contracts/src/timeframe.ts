import { z } from 'zod';

/** architecture/live-signal-server.md §3.2 — '1m' is the only timeframe ingested live; the rest are derived. */
export const TimeframeSchema = z.enum(['1m', '5m', '15m', '1h', '4h', '1d']);
export type Timeframe = z.infer<typeof TimeframeSchema>;

/** Timeframe length in milliseconds. */
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

/** How many 1m bars compose one bar of `tf`. */
export function timeframeToMinutes(tf: Timeframe): number {
  return TIMEFRAME_MS[tf] / 60_000;
}
