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
 * IB-028 — GoPlus field presence per chain family, as a RATE over a window.
 *
 * A single absent field is not evidence of anything: GoPlus's EVM payload varies per token, and two
 * real responses share only 5 of 29 field names. So "this field vanished from the API" is **not
 * detectable in one response** — it exists only as a rate, and a field that was answered for 90 % of
 * tokens dropping to 0 % is the signal. This block is what makes `dex_token_security.absent_fields`
 * a measurement rather than an honesty column with no consumer.
 */
export const WebDexFieldPresenceSchema = z.object({
  chainFamily: z.enum(['solana', 'evm']),
  field: z.string(),
  /** Answered asks for this family in the window — the population the rate is over. */
  answered: z.number().int(),
  /** Of those, how many carried the field. */
  present: z.number().int(),
  /** `present / answered`, or null when nothing was answered — never 0, which would read as "gone". */
  presentRate: z.number().nullable(),
  /** What the mapper declares: `always` is reported loudly when absent, `optional` is not. */
  presence: z.enum(['always', 'optional']),
});
export type WebDexFieldPresence = z.infer<typeof WebDexFieldPresenceSchema>;

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
   * IB-028's GoPlus field presence, per chain family per field. Its own block for the same reason
   * as `frames`: a venue's per-token optionality is not a collector problem and must not read as
   * one.
   */
  dexFields: z.array(WebDexFieldPresenceSchema).default([]),
  /** The window `collectors` was computed over, so the page can state its basis. */
  windowDays: z.number().int().default(30),
});
export type WebCoverageResponse = z.infer<typeof WebCoverageResponseSchema>;
