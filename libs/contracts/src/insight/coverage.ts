import { z } from 'zod';

/**
 * architecture/insight-bot-web-dashboard.md §2, §4 — `GET /api/web/coverage`: per symbol × series,
 * the first and last row held and the months missing between them (IB-012's coverage report, read
 * live). Behind the session guard, like everything else under `/api/web` except the exchange.
 */
export const WebCoverageRowSchema = z.object({
  symbol: z.string(),
  series: z.string(),
  /** ms UTC of the first and last stored row; null when the series holds nothing for the symbol. */
  firstRow: z.number().int().nullable(),
  lastRow: z.number().int().nullable(),
  /** Months (YYYY-MM) with no rows between `firstRow` and `lastRow` — the holes worth backfilling. */
  missingMonths: z.array(z.string()).default([]),
});
export type WebCoverageRow = z.infer<typeof WebCoverageRowSchema>;

/**
 * IB-BUG-010 — how much of a window a collector stream actually covered.
 *
 * This exists because the series rows above cannot answer it. "No liquidation in this hour" and
 * "nobody was listening in this hour" look identical in the data, and a statistic that cannot tell
 * them apart reads downtime as a quiet market: measured on `insight_coord`, only 9 of the 226 hours
 * since 2026-09-28 hold any liquidation at all, because the collectors were down through the pause.
 * A ratio computed on elapsed hours is then understated 25-fold. Consumers divide by
 * `coveredHours`, never by `elapsedHours`.
 */
export const WebCollectorCoverageSchema = z.object({
  /** The collector stream id, e.g. `bybit:allLiquidation`. An identifier — not translated. */
  stream: z.string(),
  venue: z.string(),
  /** Hours inside the window during which the stream was running. The honest denominator. */
  coveredHours: z.number(),
  /**
   * Hours the window spans, clipped to `firstSeen`: time before the collector ever ran is not
   * counted as elapsed either, so a new database does not report a huge uncovered span it was
   * never responsible for.
   */
  elapsedHours: z.number(),
  /** ms UTC of the first and last known liveness; null when the stream has never run. */
  firstSeen: z.number().int().nullable(),
  lastSeen: z.number().int().nullable(),
  /** Number of recorded outages overlapping the window. */
  outages: z.number().int(),
});
export type WebCollectorCoverage = z.infer<typeof WebCollectorCoverageSchema>;

/**
 * IB-BUG-010 — a `liquidations` row whose `(venue, symbol)` matches no spelling in `symbols`.
 *
 * Such a row is unreachable from any canonical id: it is stored, counted by nothing and reaches no
 * page. Measured 0 on 2026-10-07 (dev-2) and 0 again on 2026-10-12 — two observations, both zero,
 * which is a note rather than a guarantee. It is surfaced for the day it stops being zero, which is
 * the day a venue renames a contract.
 */
export const WebUnmappedLiquidationSchema = z.object({
  venue: z.string(),
  symbol: z.string(),
  rows: z.number().int(),
});
export type WebUnmappedLiquidation = z.infer<typeof WebUnmappedLiquidationSchema>;

/**
 * IB-015 — where the unhealed-gap counter is READ, which until this block existed was nowhere.
 *
 * Its own block with its own fields, deliberately NOT folded into `collectors` above. The two
 * measure different things and merging them would make a frame problem look like a collector
 * problem: a stream can be up for every hour of the window while every frame in it refuses,
 * because collector liveness says a socket was connected and says nothing about whether the
 * buckets it fed ever healed.
 *
 * Four counts, and the distinctions between them are the point:
 *
 * - **`expected` vs `written`** — a frame that was never written is invisible in any count of
 *   frames, which is IB-BUG-010 one layer up: "the pass was not running" and "nothing was wrong"
 *   must not look alike. `expected` is computed from the window and the timeframe, not from the
 *   rows.
 * - **`incomplete` is not `complete = false`.** A frame refusing only `explained_absence` keys
 *   is `complete = false` for ever and there is nothing to chase: the venue did not produce
 *   those minutes and never will. Counting it here would be an alarm that cannot be cleared,
 *   and an alarm that cannot be cleared stops being read. `incomplete` counts frames holding at
 *   least one `incomplete_input` key; `explainedOnly` counts the permanent ones separately so
 *   they are visible without being actionable.
 * - **`unhealed` is the only number anyone should act on**: frames still holding an
 *   `incomplete_input` key after the heal window closed, so no further heal pass will reach
 *   back for them. Before that deadline an incomplete frame is simply young.
 */
export const WebFrameCoverageSchema = z.object({
  /** `15m` or `4h`. An identifier — not translated. */
  tf: z.string(),
  /** Frames the window should hold, computed from the window and the timeframe. */
  expected: z.number().int(),
  /** Frames actually stored. Below `expected` means the pass did not run, not that data is fine. */
  written: z.number().int(),
  /** Frames holding at least one `incomplete_input` key — chaseable, whatever their age. */
  incomplete: z.number().int(),
  /** Frames whose only refusals are permanent. Visible, never actionable, never an alarm. */
  explainedOnly: z.number().int(),
  /** Still `incomplete_input` past the heal window. The actionable figure, and normally zero. */
  unhealed: z.number().int(),
  /** ms UTC of the oldest unhealed frame's close, or null when there is none. */
  oldestUnhealed: z.number().int().nullable(),
});
export type WebFrameCoverage = z.infer<typeof WebFrameCoverageSchema>;

/**
 * IB-056 — one row per `(symbol, market, tf)`: what `candles_agg` holds against what the 1m tape
 * could support.
 *
 * The distinction this exists to draw is between **two shortfalls that are spelled identically
 * everywhere else in the system**. A feature key refuses `insufficient_history` whether the 1m
 * bars are sitting in `candles_1m` underived or were never collected at all — and those call for
 * opposite responses: run a pass, or fetch from the venue. Three times on 2026-10-12 that question
 * was answered by an ad-hoc query, and each answer changed a conclusion (480 refusals became 4,
 * 188 became 0, and a shortfall asserted to be unfillable turned out to be 88 % derivable).
 *
 * `derivable` is therefore the only number here anyone should act on, and acting on it is a
 * decision for a person: this report never triggers a derive. A check that silently repaired what
 * it measures would hide the very backlog it exists to show.
 *
 * Keyed by symbol **and** market because `candles_agg` is: spot and perp are separate series, and
 * collapsing them halves every average. That conflation was the most repeated measurement error of
 * 2026-10-11/12 — three instances in a day.
 */
export const WebAggCoverageSchema = z.object({
  /** An identifier — not translated. */
  symbol: z.string(),
  /** `spot` or `perp`. Its own field, never folded into `symbol`. */
  market: z.string(),
  /** `15m`, `1h`, `4h` or `1d`. An identifier — not translated. */
  tf: z.string(),
  /** Buckets `candles_agg` holds with `complete = true`. */
  held: z.number().int(),
  /**
   * Buckets whose every expected 1m bar is in `candles_1m`, but which `candles_agg` has no
   * complete row for. **A pass we have not run** — the actionable figure.
   */
  derivable: z.number().int(),
  /**
   * Buckets the 1m tape cannot support: the minutes themselves are missing, so no derive will
   * ever produce them and only the venue's archive can. Not an alarm — a different task.
   */
  unfetchable: z.number().int(),
  /** ms UTC of the oldest derivable bucket, or null when there is none. */
  oldestDerivable: z.number().int().nullable(),
});
export type WebAggCoverage = z.infer<typeof WebAggCoverageSchema>;

export const WebCoverageResponseSchema = z.object({
  rows: z.array(WebCoverageRowSchema),
  /** Defaulted, so a client built against the earlier shape keeps parsing. */
  collectors: z.array(WebCollectorCoverageSchema).default([]),
  unmapped: z
    .object({ total: z.number().int(), rows: z.array(WebUnmappedLiquidationSchema) })
    .default({ total: 0, rows: [] }),
  /**
   * IB-015's frame block, one row per timeframe. Its own field rather than a member of
   * `collectors`: a collector count and a frame count answer different questions and a reader
   * who sees them in one table will treat one as evidence about the other.
   */
  frames: z.array(WebFrameCoverageSchema).default([]),
  /**
   * IB-056's aggregate-coverage block. Computed over the same `windowDays` as the rest of the
   * page — the figure is a window's worth, not all history, and the page must say so. Full
   * history is the CLI's job (`npm run agg-coverage`), because an unbounded scan of the 1m
   * partitions is seconds of work, not milliseconds.
   */
  agg: z.array(WebAggCoverageSchema).default([]),
  /** The window `collectors` was computed over, so the page can state its basis. */
  windowDays: z.number().int().default(30),
});
export type WebCoverageResponse = z.infer<typeof WebCoverageResponseSchema>;
