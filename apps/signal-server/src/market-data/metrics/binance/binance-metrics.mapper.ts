import { InstrumentId, MetricKind, MetricObservation } from '@trade-automation/contracts';
import { TipPrice } from '../metric-adapter.port';

/** One row of Binance's `GET /futures/data/openInterestHist` response. */
export interface BinanceOpenInterestHistRow {
  symbol: string;
  sumOpenInterest: string;
  sumOpenInterestValue: string;
  timestamp: number;
  // Additional fields (e.g. CMCCirculatingSupply) are present on the live response but not
  // part of this contract — the mapper reads only what MetricObservation needs.
}

/** The response of `GET /fapi/v1/openInterest`. */
export interface BinanceOpenInterestSnapshot {
  symbol: string;
  openInterest: string;
  time: number;
}

/**
 * architecture/chart-layouts.md §4.2 — `time` is the venue's own stamp, never Date.now()
 * (same rule as the candle mapper). `value` = sumOpenInterest / openInterest, in base-asset
 * units on USDⓈ-M (`unit: 'base'`, §11.1); `notional` = sumOpenInterestValue, the venue's own
 * figure (`notionalBasis: 'venue'`), present on history rows only. A live snapshot's notional is
 * derived at ingestion from the mark price (`notionalBasis: 'derived'`, §11.1 —
 * metric-ingestion.service.ts).
 */
export function mapOpenInterestHistRow(
  instrument: InstrumentId,
  metric: MetricKind,
  row: BinanceOpenInterestHistRow,
): MetricObservation {
  return {
    metric,
    instrument,
    time: row.timestamp,
    value: Number(row.sumOpenInterest),
    unit: 'base',
    notional: Number(row.sumOpenInterestValue),
    notionalBasis: 'venue',
  };
}

export function mapOpenInterestSnapshot(
  instrument: InstrumentId,
  metric: MetricKind,
  snapshot: BinanceOpenInterestSnapshot,
): MetricObservation {
  return {
    metric,
    instrument,
    time: snapshot.time,
    value: Number(snapshot.openInterest),
    unit: 'base',
  };
}

/** The response of `GET /fapi/v1/premiumIndex?symbol=` (fields this mapper reads). */
export interface BinancePremiumIndex {
  symbol: string;
  markPrice: string;
  time: number;
}

/** One row of `GET /fapi/v1/markPriceKlines`: [openTime, open, high, low, close, …]. */
export type BinanceMarkPriceKline = [number, string, string, string, string, ...unknown[]];

const ONE_MINUTE_MS = 60_000;

/** §11.1 — the live mark price, stamped with the venue's own `time`. */
export function mapPremiumIndex(row: BinancePremiumIndex): TipPrice {
  return { time: row.time, price: Number(row.markPrice) };
}

/**
 * §11.1 legacy-row repair — a closed 1m mark-price bar as a price point stamped at its close
 * boundary (`openTime + 1m`): the join measurement (binance-metrics.adapter.ts header) found
 * `sumOpenInterestValue` = OI × the close of the mark bar ending at the row's stamp.
 */
export function mapMarkPriceKline(row: BinanceMarkPriceKline): TipPrice {
  return { time: row[0] + ONE_MINUTE_MS, price: Number(row[4]) };
}
