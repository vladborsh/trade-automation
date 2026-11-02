import { z } from 'zod';

/**
 * IB-031 — the pieces of the dashboard's wire contract that are **not** specific to one page
 * (architecture/insight-bot-web-dashboard.md §4).
 *
 * Landed on its own, ahead of the instrument view, because every `/api/web` page needs the same
 * error body and the same limits. Two pages inventing near-identical `HealthError` and
 * `SeriesError` types is how a client ends up with two error handlers that disagree about what
 * a failure looks like.
 *
 * Everything is `Web`-prefixed: `libs/contracts` is one flat barrel shared with the backtest
 * app, so an unprefixed name compiles silently against that app's export and the error surfaces
 * far from its cause (the standing rule from IB-029).
 */

/**
 * The error body every `/api/web` endpoint returns, at every status.
 *
 * One shape for all of them on purpose: the client has a single place that turns a failure into
 * something a person reads, and a new endpoint cannot quietly invent a third format. `code` is
 * the machine-readable part and the only thing a client should branch on; `message` is for the
 * log and the developer, never the sole carrier of meaning.
 */
export const WEB_ERROR_CODES = [
  'BAD_REQUEST',
  'NOT_FOUND',
  'RANGE_TOO_WIDE',
  'TOKEN_INVALID',
  'TOKEN_USED',
  'TOKEN_EXPIRED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  /** The exchange did not answer a live read (or our weight budget is spent): retry later. */
  'VENUE_UNAVAILABLE',
  // IB-078 — login + password (auth.ts). Listed here too, because the dashboard parses every error
  // body with WebErrorSchema; a code missing here would reach it as `null`.
  'INVALID_CREDENTIALS',
  'TOO_MANY_ATTEMPTS',
  'LOGIN_TAKEN',
  'BAD_LOGIN',
  'WEAK_PASSWORD',
] as const;
export type WebErrorCode = (typeof WEB_ERROR_CODES)[number];

export const WebErrorSchema = z.object({
  code: z.enum(WEB_ERROR_CODES),
  message: z.string().optional(),
  /** On `RANGE_TOO_WIDE`: the widest range allowed, so a client can retry correctly. */
  maxDays: z.number().int().positive().optional(),
});
export type WebError = z.infer<typeof WebErrorSchema>;

/**
 * The candle timeframes the dashboard serves. Since IB-063 they are read from Binance on demand, so
 * each id is also the venue's kline `interval` verbatim — which is why the week is `'1w'`, lower
 * case, while the button reads 1W (IB-065). A Binance week opens Monday 00:00 UTC.
 */
export const WebTimeframeSchema = z.enum(['1m', '3m', '5m', '15m', '1h', '4h', '1d', '1w']);
export type WebTimeframe = z.infer<typeof WebTimeframeSchema>;

/**
 * The limits, which are part of the contract rather than an implementation detail: the box is a
 * 1 GB t4g.micro running Postgres and Node together, and one page asking for a year of
 * 1-minute rows would take it down.
 *
 * They are enforced by two different mechanisms, and the difference is deliberate:
 *
 * - a 1m range wider than `WEB_MAX_1M_RANGE_DAYS` is **refused** (`RANGE_TOO_WIDE`), because a
 *   silently trimmed window would let a page believe it is showing a year of data;
 * - anything merely over `WEB_MAX_POINTS` is **downsampled**, and the response says so, because
 *   fewer points than the grain implies is fine as long as the caller knows.
 *
 * A consumer must always be able to tell "there is no data" from "we did not send it all".
 */
export const WEB_MAX_POINTS = 5_000;
export const WEB_MAX_1M_RANGE_DAYS = 90;

/**
 * IB-063: the most candles one `/series/candles` read may span, at any timeframe; wider is refused
 * (`RANGE_TOO_WIDE`). Candles come from Binance page by page, so thinning would only start after
 * every page was bought — the bot's `candle-pages.ts` has the arithmetic. Here so the dashboard
 * can check its own windows against it (IB-065).
 */
export const WEB_MAX_CANDLE_BARS = 10_080;
