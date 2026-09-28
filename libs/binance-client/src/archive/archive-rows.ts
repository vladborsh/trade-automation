/**
 * IB-012 — the three archive CSV layouts, as rows the insight-bot writers already accept.
 *
 * Parsing is strict about what matters and forgiving about what does not: a field Binance added
 * to the end of a row is ignored, but a malformed number is an error rather than a silent 0.
 * `Number('')` is 0 in JavaScript, which is how IB-008 stored real zero prices — `requiredNum`
 * exists so that cannot happen again.
 */

import { parseCsv } from './csv';
import { detectTimeUnit, toEpochMs, type TimeUnit } from './time-unit';

export interface ArchiveKline {
  openTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number | null;
  trades: number | null;
  takerBuyVolume: number | null;
  takerBuyQuoteVolume: number | null;
}

export interface ArchiveFunding {
  fundingTime: Date;
  rate: number;
}

/** One 5-minute metrics row: open interest plus the four long/short ratios (§3.3). */
export interface ArchiveMetric {
  ts: Date;
  oiBase: number | null;
  oiQuote: number | null;
  globalAccountLongShort: number | null;
  topAccountLongShort: number | null;
  topPositionLongShort: number | null;
  takerLongShort: number | null;
}

export class ArchiveParseError extends Error {}

function requiredNum(raw: string | undefined, what: string): number {
  const text = (raw ?? '').trim();
  // '' would become 0, which is a price, not a missing value
  if (text.length === 0) throw new ArchiveParseError(`missing ${what}`);
  const n = Number(text);
  if (!Number.isFinite(n)) throw new ArchiveParseError(`${what} is not a number: ${JSON.stringify(raw)}`);
  return n;
}

function optionalNum(raw: string | undefined): number | null {
  const text = (raw ?? '').trim();
  if (text.length === 0) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * `open_time, open, high, low, close, volume, close_time, quote_volume, trades,
 *  taker_buy_base, taker_buy_quote, ignore`
 */
export function parseKlines(text: string): { rows: ArchiveKline[]; unit: TimeUnit } {
  const raw = parseCsv(text);
  const unit = detectTimeUnit(raw.map((r) => r[0] ?? ''));
  const rows = raw.map((r) => ({
    openTime: new Date(toEpochMs(r[0] as string, unit)),
    open: requiredNum(r[1], 'open'),
    high: requiredNum(r[2], 'high'),
    low: requiredNum(r[3], 'low'),
    close: requiredNum(r[4], 'close'),
    volume: requiredNum(r[5], 'volume'),
    quoteVolume: optionalNum(r[7]),
    trades: optionalNum(r[8]),
    takerBuyVolume: optionalNum(r[9]),
    takerBuyQuoteVolume: optionalNum(r[10]),
  }));
  return { rows, unit };
}

/** `calc_time, funding_interval_hours, last_funding_rate` */
export function parseFunding(text: string): ArchiveFunding[] {
  const raw = parseCsv(text);
  const unit = detectTimeUnit(raw.map((r) => r[0] ?? ''));
  return raw.map((r) => ({
    fundingTime: new Date(toEpochMs(r[0] as string, unit)),
    rate: requiredNum(r[2], 'funding rate'),
  }));
}

/**
 * `create_time, symbol, sum_open_interest, sum_open_interest_value,
 *  count_toptrader_long_short_ratio, sum_toptrader_long_short_ratio,
 *  count_long_short_ratio, sum_taker_long_short_vol_ratio`
 *
 * `create_time` here is a formatted datetime (`2026-09-27 00:05:00`), not an epoch — the metrics
 * files differ from klines in exactly this, which is why they get their own parser.
 */
export function parseMetrics(text: string): ArchiveMetric[] {
  return parseCsv(text).map((r) => {
    const stamp = (r[0] ?? '').trim();
    const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(stamp) ? stamp : `${stamp.replace(' ', 'T')}Z`);
    if (!Number.isFinite(ms)) throw new ArchiveParseError(`unparseable metrics timestamp: ${JSON.stringify(r[0])}`);
    return {
      ts: new Date(ms),
      oiBase: optionalNum(r[2]),
      oiQuote: optionalNum(r[3]),
      topAccountLongShort: optionalNum(r[4]),
      topPositionLongShort: optionalNum(r[5]),
      globalAccountLongShort: optionalNum(r[6]),
      takerLongShort: optionalNum(r[7]),
    };
  });
}
