import { InstrumentId, MetricKind, MetricObservation } from '@trade-automation/contracts';

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
 * (same rule as the candle mapper). `value` = sumOpenInterest / openInterest (base-asset
 * units); `notional` = sumOpenInterestValue, present on history rows only.
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
    notional: Number(row.sumOpenInterestValue),
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
  };
}
