/**
 * IB-012 — one archive file → rows the writers already accept (§5, D8: archive and live share
 * one schema, distinguished only by `source`).
 *
 * Pure apart from the client call, so the mapping is specced without a network.
 */

import {
  dailyKlinesUrl, dailyMetricsUrl, monthlyFundingUrl, monthlyKlinesUrl,
  parseFunding, parseKlines, parseMetrics, type ArchiveClient,
} from '@trade-automation/binance-client';
import type {
  Candle1mRow, FundingSettlementRow, LongShortKind, LongShortRow, Market, OpenInterestRow,
} from '../collectors/writers/tables';

export const ARCHIVE_SOURCE = 'archive' as const;
export const BINANCE = 'binance';

/** `absent` means the archive does not serve this file — a fact, never an error (§5). */
export type SourceResult<T> = { kind: 'ok'; rows: T[] } | { kind: 'absent' };

export async function fetchKlineMonth(
  client: ArchiveClient, market: Market, symbol: string, month: string,
): Promise<SourceResult<Candle1mRow>> {
  return klines(client, monthlyKlinesUrl(market, symbol, month), market, symbol);
}

export async function fetchKlineDay(
  client: ArchiveClient, market: Market, symbol: string, day: string,
): Promise<SourceResult<Candle1mRow>> {
  return klines(client, dailyKlinesUrl(market, symbol, day), market, symbol);
}

async function klines(
  client: ArchiveClient, url: string, market: Market, symbol: string,
): Promise<SourceResult<Candle1mRow>> {
  const file = await client.get(url);
  if (file.kind === 'absent') return { kind: 'absent' };
  const { rows } = parseKlines(file.text);
  return {
    kind: 'ok',
    rows: rows.map((k) => ({
      venue: BINANCE, market, symbol, openTime: k.openTime,
      open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
      quoteVolume: k.quoteVolume, trades: k.trades,
      takerBuyVolume: k.takerBuyVolume, takerBuyQuoteVolume: k.takerBuyQuoteVolume,
      source: ARCHIVE_SOURCE,
    })),
  };
}

export async function fetchFundingMonth(
  client: ArchiveClient, symbol: string, month: string,
): Promise<SourceResult<FundingSettlementRow>> {
  const file = await client.get(monthlyFundingUrl(symbol, month));
  if (file.kind === 'absent') return { kind: 'absent' };
  return {
    kind: 'ok',
    rows: parseFunding(file.text).map((f) => ({
      venue: BINANCE, symbol, fundingTime: f.fundingTime, rate: f.rate, markPrice: null, source: ARCHIVE_SOURCE,
    })),
  };
}

export interface MetricsRows {
  openInterest: OpenInterestRow[];
  longShort: LongShortRow[];
}

/** The four ratio columns, in the order the metrics CSV carries them. */
const RATIO_KINDS: ReadonlyArray<[keyof import('@trade-automation/binance-client').ArchiveMetric, LongShortKind]> = [
  ['globalAccountLongShort', 'global_account'],
  ['topAccountLongShort', 'top_account'],
  ['topPositionLongShort', 'top_position'],
  ['takerLongShort', 'taker'],
];

export type MetricsResult = { kind: 'ok'; rows: MetricsRows } | { kind: 'absent' };

export async function fetchMetricsDay(
  client: ArchiveClient, symbol: string, day: string,
): Promise<MetricsResult> {
  const file = await client.get(dailyMetricsUrl(symbol, day));
  if (file.kind === 'absent') return { kind: 'absent' };

  const openInterest: OpenInterestRow[] = [];
  const longShort: LongShortRow[] = [];
  for (const m of parseMetrics(file.text)) {
    if (m.oiBase !== null) {
      openInterest.push({ venue: BINANCE, symbol, ts: m.ts, oiBase: m.oiBase, oiQuote: m.oiQuote, source: ARCHIVE_SOURCE });
    }
    for (const [field, kind] of RATIO_KINDS) {
      const ratio = m[field] as number | null;
      // a missing ratio is left out entirely: a row of nulls would claim we know it is absent
      if (ratio === null) continue;
      longShort.push({ venue: BINANCE, symbol, ts: m.ts, kind, ratio, longRatio: null, shortRatio: null, source: ARCHIVE_SOURCE });
    }
  }
  return { kind: 'ok', rows: { openInterest, longShort } };
}
