import type { TableSpec } from '../../src/collectors/writers/upsert';
import type { Market, Source } from '../../src/collectors/writers/tables';

type AggTimeframe = '15m' | '1h' | '4h' | '1d';

/**
 * WD-010 — the TableSpecs of tables the box no longer WRITES (candles, mark/funding), kept here only
 * so the migration-002 spec can still exercise the schema. WD-006 (migration 024) drops the tables;
 * the migration-002 spec migrates to 023, where they still exist, and keeps using this file.
 * Copied verbatim from src/collectors/writers/tables.ts @ master.
 */
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

