import { STREAM_LIQUIDATION as BYBIT_LIQUIDATION } from '../bybit/bybit-collector';
import { STREAM_LIQUIDATION as OKX_LIQUIDATION } from '../okx/okx-collector';

/**
 * WD-009 — the three liquidation collectors whose uptime the health page reports. One list, so the
 * page cannot report a stream the collectors never heartbeat under (or miss one they do).
 *
 * Binance's id is new in WD-009: until then its `forceOrder` stream wrote no heartbeat at all, so
 * its outages were never recorded and "no Binance liquidations" could not be told from "nobody was
 * listening" — the IB-BUG-010 failure, for the venue with the most volume.
 */
export const BINANCE_LIQUIDATION_STREAM = 'binance:forceOrder';

export const LIQUIDATION_STREAMS: ReadonlyArray<{ stream: string; venue: string }> = [
  { stream: BINANCE_LIQUIDATION_STREAM, venue: 'binance' },
  { stream: BYBIT_LIQUIDATION, venue: 'bybit' },
  { stream: OKX_LIQUIDATION, venue: 'okx' },
];
