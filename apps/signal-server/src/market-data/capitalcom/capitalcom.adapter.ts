import { Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Candle, Instrument, Timeframe, VenueStatus } from '@trade-automation/contracts';
import { VenueAdapter } from '../venue-adapter.port';
import { CapitalComSession } from './capitalcom.session';
import { CAP_COM_RESOLUTION_1M, CapComMarketDataResponse, mapPriceRow } from './capitalcom.mapper';

// Capital.com's price-history endpoint caps `max` at 720 bars/request — ported from
// cmc-bot-main's CapitalComClient.getCandles chunking (differenceInMinutes <= 720 fast path,
// 720-minute windows otherwise). Verify against current venue docs before relying on it in prod.
const REST_PAGE_LIMIT_BARS = 720;

// Poll a little after the minute boundary so the venue has settled the bar (§4.6 BarClock).
const BOUNDARY_JITTER_MS = 2000;

export class CapitalComAdapter implements VenueAdapter {
  readonly venue = 'capitalcom' as const;
  private readonly logger = new Logger(CapitalComAdapter.name);

  constructor(
    private readonly baseUrl: string,
    private readonly session: CapitalComSession,
  ) {}

  async fetchCandles(instrument: Instrument, tf: Timeframe, from: number, to: number): Promise<Candle[]> {
    if (tf !== '1m') {
      throw new Error('CapitalComAdapter.fetchCandles only supports 1m; coarser bars are resampled');
    }
    const out: Candle[] = [];
    let windowStart = from;
    const windowMs = REST_PAGE_LIMIT_BARS * 60_000;

    while (windowStart <= to) {
      const windowEnd = Math.min(windowStart + windowMs, to);
      const rows = await this.request(instrument.symbol, windowStart, windowEnd);
      out.push(...rows.map((row) => mapPriceRow(instrument.id, row, true)));
      windowStart = windowEnd + 60_000;
    }

    return out;
  }

  private async request(epic: string, from: number, to: number) {
    const headers = await this.session.authHeaders();
    const url = new URL(`/api/v1/prices/${epic}`, this.baseUrl);
    url.searchParams.set('resolution', CAP_COM_RESOLUTION_1M);
    url.searchParams.set('max', String(REST_PAGE_LIMIT_BARS));
    url.searchParams.set('from', new Date(from).toISOString().split('.')[0]);
    url.searchParams.set('to', new Date(to).toISOString().split('.')[0]);

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Capital.com prices request failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as CapComMarketDataResponse;
    return body.prices;
  }

  /**
   * §4.1/§4.6: "Live via polling on the bar boundary: at HH:MM:00 + jitter fetch the last 2
   * bars, emit the previous one as closed:true, the current one as closed:false." The venue's
   * streaming endpoint exists but is intentionally not used here — see §4.1's noted follow-up.
   */
  streamCandles(instrument: Instrument): Observable<Candle> {
    return new Observable<Candle>((subscriber) => {
      let stopped = false;
      let timer: NodeJS.Timeout;
      let lastEmittedClosedOpenTime: number | null = null;

      const msToNextBoundary = () => {
        const now = Date.now();
        return 60_000 - (now % 60_000) + BOUNDARY_JITTER_MS;
      };

      const poll = async () => {
        if (stopped) return;
        try {
          const headers = await this.session.authHeaders();
          const url = new URL(`/api/v1/prices/${instrument.symbol}`, this.baseUrl);
          url.searchParams.set('resolution', CAP_COM_RESOLUTION_1M);
          url.searchParams.set('max', '2');
          const res = await fetch(url, { headers });
          if (!res.ok) {
            throw new Error(`Capital.com prices poll failed: ${res.status} ${res.statusText}`);
          }
          const body = (await res.json()) as CapComMarketDataResponse;
          const rows = body.prices;
          if (rows.length >= 1) {
            const forming = rows[rows.length - 1];
            subscriber.next(mapPriceRow(instrument.id, forming, false));
          }
          if (rows.length >= 2) {
            const closed = rows[rows.length - 2];
            const closedCandle = mapPriceRow(instrument.id, closed, true);
            if (closedCandle.openTime !== lastEmittedClosedOpenTime) {
              lastEmittedClosedOpenTime = closedCandle.openTime;
              subscriber.next(closedCandle);
            }
          }
        } catch (err) {
          this.logger.warn(`Capital.com poll error for ${instrument.symbol}: ${(err as Error).message}`);
        } finally {
          if (!stopped) timer = setTimeout(poll, msToNextBoundary());
        }
      };

      timer = setTimeout(poll, msToNextBoundary());

      return () => {
        stopped = true;
        clearTimeout(timer);
      };
    });
  }

  health(): Observable<VenueStatus> {
    return new Observable<VenueStatus>((subscriber) => {
      subscriber.next('up');
    });
  }
}
