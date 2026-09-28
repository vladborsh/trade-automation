import { TableSpec } from './upsert';

/**
 * One `TableSpec` per §3.3 table, and a pure row mapper beside it. Keeping the column list and
 * the mapper adjacent is the point: the tuple order is the contract between them, and a spec
 * asserts it for every table.
 */

export type Source = 'ws' | 'rest' | 'archive';
export type Market = 'perp' | 'spot';
export type AggTimeframe = '15m' | '1h' | '4h' | '1d';
export type LongShortKind = 'global_account' | 'top_account' | 'top_position' | 'taker';
/** The side LIQUIDATED — normalised at the mapper, never the venue's raw order side (§3.3). */
export type LiquidationSide = 'long' | 'short';

export interface Candle1mRow {
  venue: string;
  market: Market;
  symbol: string;
  openTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume?: number | null;
  trades?: number | null;
  takerBuyVolume?: number | null;
  takerBuyQuoteVolume?: number | null;
  source: Source;
}

export const CANDLES_1M: TableSpec = {
  table: 'candles_1m',
  columns: [
    'venue', 'market', 'symbol', 'open_time',
    'open', 'high', 'low', 'close', 'volume',
    'quote_volume', 'trades', 'taker_buy_volume', 'taker_buy_quote_volume', 'source',
  ],
  conflict: ['venue', 'market', 'symbol', 'open_time'],
};

export function candle1mTuple(row: Candle1mRow): unknown[] {
  return [
    row.venue, row.market, row.symbol, row.openTime,
    row.open, row.high, row.low, row.close, row.volume,
    row.quoteVolume ?? null, row.trades ?? null, row.takerBuyVolume ?? null, row.takerBuyQuoteVolume ?? null,
    row.source,
  ];
}

export interface CandleAggRow extends Omit<Candle1mRow, 'source'> {
  tf: AggTimeframe;
  /** 1m rows folded into this bar. */
  bars: number;
  complete: boolean;
}

export const CANDLES_AGG: TableSpec = {
  table: 'candles_agg',
  columns: [
    'venue', 'market', 'symbol', 'tf', 'open_time',
    'open', 'high', 'low', 'close', 'volume',
    'quote_volume', 'trades', 'taker_buy_volume', 'taker_buy_quote_volume', 'bars', 'complete',
  ],
  conflict: ['venue', 'market', 'symbol', 'tf', 'open_time'],
};

export function candleAggTuple(row: CandleAggRow): unknown[] {
  return [
    row.venue, row.market, row.symbol, row.tf, row.openTime,
    row.open, row.high, row.low, row.close, row.volume,
    row.quoteVolume ?? null, row.trades ?? null, row.takerBuyVolume ?? null, row.takerBuyQuoteVolume ?? null,
    row.bars, row.complete,
  ];
}

export interface MarkFundingRow {
  venue: string;
  symbol: string;
  ts: Date;
  markPrice?: number | null;
  indexPrice?: number | null;
  predictedFundingRate?: number | null;
  nextFundingTime?: Date | null;
  source: Source;
}

export const MARK_FUNDING_1M: TableSpec = {
  table: 'mark_funding_1m',
  columns: ['venue', 'symbol', 'ts', 'mark_price', 'index_price', 'predicted_funding_rate', 'next_funding_time', 'source'],
  conflict: ['venue', 'symbol', 'ts'],
};

export function markFundingTuple(row: MarkFundingRow): unknown[] {
  return [
    row.venue, row.symbol, row.ts,
    row.markPrice ?? null, row.indexPrice ?? null, row.predictedFundingRate ?? null, row.nextFundingTime ?? null,
    row.source,
  ];
}

export interface FundingSettlementRow {
  venue: string;
  symbol: string;
  fundingTime: Date;
  rate: number;
  markPrice?: number | null;
  source: Source;
}

export const FUNDING_SETTLEMENTS: TableSpec = {
  table: 'funding_settlements',
  columns: ['venue', 'symbol', 'funding_time', 'rate', 'mark_price', 'source'],
  conflict: ['venue', 'symbol', 'funding_time'],
};

export function fundingSettlementTuple(row: FundingSettlementRow): unknown[] {
  return [row.venue, row.symbol, row.fundingTime, row.rate, row.markPrice ?? null, row.source];
}

export interface OpenInterestRow {
  venue: string;
  symbol: string;
  ts: Date;
  oiBase: number;
  oiQuote?: number | null;
  source: Source;
}

export const OPEN_INTEREST_5M: TableSpec = {
  table: 'open_interest_5m',
  columns: ['venue', 'symbol', 'ts', 'oi_base', 'oi_quote', 'source'],
  conflict: ['venue', 'symbol', 'ts'],
};

export function openInterestTuple(row: OpenInterestRow): unknown[] {
  return [row.venue, row.symbol, row.ts, row.oiBase, row.oiQuote ?? null, row.source];
}

export interface LongShortRow {
  venue: string;
  symbol: string;
  ts: Date;
  kind: LongShortKind;
  longRatio?: number | null;
  shortRatio?: number | null;
  ratio?: number | null;
  source: Source;
}

export const LONG_SHORT_5M: TableSpec = {
  table: 'long_short_5m',
  columns: ['venue', 'symbol', 'ts', 'kind', 'long_ratio', 'short_ratio', 'ratio', 'source'],
  conflict: ['venue', 'symbol', 'ts', 'kind'],
};

export function longShortTuple(row: LongShortRow): unknown[] {
  return [row.venue, row.symbol, row.ts, row.kind, row.longRatio ?? null, row.shortRatio ?? null, row.ratio ?? null, row.source];
}

export interface LiquidationRow {
  venue: string;
  symbol: string;
  ts: Date;
  side: LiquidationSide;
  price: number;
  qty: number;
  notional: number;
  orderStatus?: string | null;
  source: Source;
}

/**
 * D6's natural key is the six-column one, not `id` (a bigserial the insert never supplies).
 * `do nothing` on conflict: a liquidation event is immutable, and the only columns outside the
 * key are `notional` (a product of two key columns), `order_status` and `source` — replaying the
 * same event must not rewrite which collector saw it first.
 */
export const LIQUIDATIONS: TableSpec = {
  table: 'liquidations',
  columns: ['venue', 'symbol', 'ts', 'side', 'price', 'qty', 'notional', 'order_status', 'source'],
  conflict: ['venue', 'symbol', 'ts', 'side', 'price', 'qty'],
  update: [],
};

export function liquidationTuple(row: LiquidationRow): unknown[] {
  return [row.venue, row.symbol, row.ts, row.side, row.price, row.qty, row.notional, row.orderStatus ?? null, row.source];
}

/** §9.3, §16.7 — the vocabulary of `calendar_events.status`; the veto reads `'scheduled'`. */
export type CalendarEventStatus = 'scheduled' | 'cancelled' | 'rescheduled';

export interface CalendarEventRow {
  id: string;
  revision: number;
  source: string;
  seriesId?: string | null;
  eventTime: Date;
  currency?: string | null;
  title?: string | null;
  impact?: string | null;
  status: CalendarEventStatus;
  forecast?: string | null;
  previous?: string | null;
  actual?: string | null;
  actualSource?: string | null;
  fetchedAt: Date;
}

export const CALENDAR_EVENTS: TableSpec = {
  table: 'calendar_events',
  columns: [
    'id', 'revision', 'source', 'series_id', 'event_time', 'currency', 'title', 'impact',
    'status', 'forecast', 'previous', 'actual', 'actual_source', 'fetched_at',
  ],
  conflict: ['id', 'revision'],
};

export function calendarEventTuple(row: CalendarEventRow): unknown[] {
  return [
    row.id, row.revision, row.source, row.seriesId ?? null, row.eventTime,
    row.currency ?? null, row.title ?? null, row.impact ?? null, row.status,
    row.forecast ?? null, row.previous ?? null, row.actual ?? null, row.actualSource ?? null,
    row.fetchedAt,
  ];
}

export interface CollectorGapRow {
  stream: string;
  venue: string;
  market?: Market | null;
  symbol?: string | null;
  gapFrom: Date;
  gapTo: Date;
  expected: number;
  repaired?: number;
  error?: string | null;
  detectedAt: Date;
}

/**
 * The only append-only table here: `id` is a bigserial and every insert is a new observation, so
 * there is no natural key to conflict on. `CollectorGapsWriter` inserts without `ON CONFLICT`
 * (see `batch-writer.ts`); a repair updates its row by id afterwards.
 */
export const COLLECTOR_GAPS: TableSpec = {
  table: 'collector_gaps',
  columns: ['stream', 'venue', 'market', 'symbol', 'gap_from', 'gap_to', 'expected', 'repaired', 'error', 'detected_at'],
  conflict: [],
  update: [],
};

export function collectorGapTuple(row: CollectorGapRow): unknown[] {
  return [
    row.stream, row.venue, row.market ?? null, row.symbol ?? null,
    row.gapFrom, row.gapTo, row.expected, row.repaired ?? 0, row.error ?? null, row.detectedAt,
  ];
}

// ---------------------------------------------------------------------------------------------
// IB-036 — market context (§10). Small, unpartitioned series; forward-only for market_cap_global.
// ---------------------------------------------------------------------------------------------

export interface FearGreedWriteRow {
  day: string;
  value: number;
  classification: string;
  fetchedAt: Date;
}

export const FEAR_GREED: TableSpec = {
  table: 'fear_greed',
  columns: ['day', 'value', 'classification', 'fetched_at'],
  conflict: ['day'],
};

export function fearGreedTuple(row: FearGreedWriteRow): unknown[] {
  return [row.day, row.value, row.classification, row.fetchedAt];
}

export interface MarketCapGlobalWriteRow {
  ts: Date;
  totalUsd: number;
  btcPct?: number | null;
  ethPct?: number | null;
  dominance: Record<string, number>;
  fetchedAt: Date;
}

export const MARKET_CAP_GLOBAL: TableSpec = {
  table: 'market_cap_global',
  columns: ['ts', 'total_usd', 'btc_pct', 'eth_pct', 'dominance', 'fetched_at'],
  conflict: ['ts'],
};

export function marketCapGlobalTuple(row: MarketCapGlobalWriteRow): unknown[] {
  // `dominance` is jsonb: pg takes the object through as JSON, so it is stringified here once
  // rather than relying on the driver's object handling.
  return [row.ts, row.totalUsd, row.btcPct ?? null, row.ethPct ?? null, JSON.stringify(row.dominance), row.fetchedAt];
}

export interface MarketCapCoinWriteRow {
  day: string;
  coin: string;
  capUsd?: number | null;
  priceUsd?: number | null;
  fetchedAt: Date;
}

export const MARKET_CAP_COIN: TableSpec = {
  table: 'market_cap_coin',
  columns: ['day', 'coin', 'cap_usd', 'price_usd', 'fetched_at'],
  conflict: ['day', 'coin'],
};

export function marketCapCoinTuple(row: MarketCapCoinWriteRow): unknown[] {
  return [row.day, row.coin, row.capUsd ?? null, row.priceUsd ?? null, row.fetchedAt];
}
