import { Observable } from 'rxjs';
import { Candle, Instrument, Timeframe, Venue, VenueStatus } from '@trade-automation/contracts';

/**
 * architecture/live-signal-server.md §4.1.
 * Ported from cmc-bot-main's `IExchangeClient { getCandles, getCandlesStream }` — same
 * two-method shape, sharpened contract (closed-only REST, forming+closed stream).
 */
export interface VenueAdapter {
  readonly venue: Venue;

  /** REST, paginated internally by the adapter, ascending, closed bars only. */
  fetchCandles(instrument: Instrument, tf: Timeframe, from: number, to: number): Promise<Candle[]>;

  /** 1m only; emits forming (closed:false) and closed (closed:true) bars. */
  streamCandles(instrument: Instrument): Observable<Candle>;

  health(): Observable<VenueStatus>;
}

export const VENUE_ADAPTERS = Symbol('VENUE_ADAPTERS');
