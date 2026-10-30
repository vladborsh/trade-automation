import { WEB_MAX_1M_RANGE_DAYS, WEB_MAX_POINTS, type WebTimeframe } from '@trade-automation/contracts';

/**
 * IB-031 — how wide a range may be, and how a too-dense one is thinned
 * (architecture/insight-bot-web-dashboard.md §4).
 *
 * The box is a 1 GB t4g.micro running Postgres and Node together, so this is a real limit, not
 * a formality. Two different mechanisms, deliberately:
 *
 * - **Refuse** a 1m range over 90 days (`400 RANGE_TOO_WIDE`). The caller asked for something
 *   the box will not do; answering with a quietly trimmed window would let a page believe it is
 *   showing a year when it is showing a month.
 * - **Downsample** anything that merely exceeds the point cap, and say so in the response
 *   (`downsampled: true`). Fewer points than the grain implies is fine as long as the client
 *   knows — the alternative, silently dropping the tail, is what makes a chart lie.
 *
 * The distinction matters for the same reason IB-011's report distinguishes `missing` from
 * `unavailable`: a consumer must be able to tell "there is no data" from "we did not send it".
 */

const MS = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
  '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000, '1w': 604_800_000,
} as const satisfies Record<WebTimeframe, number>;

export const DAY_MS = 86_400_000;

export function timeframeMs(tf: WebTimeframe): number {
  return MS[tf];
}

/**
 * IB-065: where a timeframe's bar grid starts, as an offset from the epoch. Every width up to a day
 * divides the epoch evenly, so their bars open on multiples of the width; a Binance WEEK opens on
 * Monday 00:00 UTC and the epoch (1970-01-01) was a Thursday, so 1w bars sit 4 days off the
 * epoch's multiples. Pinned against real weekly klines in `test/fixtures/binance/*-klines-1w.json`.
 */
export const WEEK_OFFSET_MS = 4 * DAY_MS;

export function gridOffsetMs(tf: WebTimeframe): number {
  return tf === '1w' ? WEEK_OFFSET_MS : 0;
}

/** The open time of the `tf` bar (or of a `span`-wide block of them) that contains `ms`. */
export function floorToGrid(ms: number, tf: WebTimeframe, span = timeframeMs(tf)): number {
  const offset = gridOffsetMs(tf);
  return Math.floor((ms - offset) / span) * span + offset;
}

/**
 * IB-068: how many `tf` bars the window `[fromMs, toMs)` touches, counting a bar it only partly
 * covers at either edge. Zero for an empty window.
 */
export function barsTouched(fromMs: number, toMs: number, tf: WebTimeframe): number {
  if (toMs <= fromMs) return 0;
  const span = timeframeMs(tf);
  return (floorToGrid(toMs - 1, tf) - floorToGrid(fromMs, tf)) / span + 1;
}

export type RangeCheck =
  | { ok: true; fromMs: number; toMs: number }
  | { ok: false; code: 'BAD_REQUEST'; message: string }
  | { ok: false; code: 'RANGE_TOO_WIDE'; maxDays: number; message: string };

/**
 * Validates a requested window. `from`/`to` are epoch milliseconds; `to` is exclusive.
 */
export function checkRange(fromMs: number, toMs: number, tf: WebTimeframe): RangeCheck {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'from and to must be epoch milliseconds' };
  }
  if (toMs <= fromMs) {
    return { ok: false, code: 'BAD_REQUEST', message: 'to must be after from' };
  }
  if (tf === '1m' && toMs - fromMs > WEB_MAX_1M_RANGE_DAYS * DAY_MS) {
    return {
      ok: false,
      code: 'RANGE_TOO_WIDE',
      maxDays: WEB_MAX_1M_RANGE_DAYS,
      message: `a 1m range may span at most ${WEB_MAX_1M_RANGE_DAYS} days`,
    };
  }
  return { ok: true, fromMs, toMs };
}

/**
 * How many source rows to skip so a window fits the point cap: `1` keeps every row.
 *
 * Postgres does the thinning (`row_number() % stride = 0`), not Node — pulling 500k rows into
 * the process to throw most away is exactly what the cap exists to prevent.
 */
export function strideFor(fromMs: number, toMs: number, tf: WebTimeframe, maxPoints = WEB_MAX_POINTS): number {
  const expected = Math.ceil((toMs - fromMs) / timeframeMs(tf));
  return expected <= maxPoints ? 1 : Math.ceil(expected / maxPoints);
}

/** Thins an already-fetched array, keeping the FIRST and LAST points so the range is honest. */
export function thin<T>(rows: readonly T[], maxPoints = WEB_MAX_POINTS): { rows: T[]; downsampled: boolean } {
  if (rows.length <= maxPoints) return { rows: [...rows], downsampled: false };

  const stride = Math.ceil(rows.length / maxPoints);
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += stride) out.push(rows[i] as T);

  // the last row always survives: a chart whose right edge is silently older than the range
  // asked for reads as "the data stops here", which is a different claim
  const last = rows[rows.length - 1] as T;
  if (out[out.length - 1] !== last) out.push(last);
  return { rows: out, downsampled: true };
}
