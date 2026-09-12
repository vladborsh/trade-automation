import * as fs from 'fs';
import * as path from 'path';
import { Observable } from 'rxjs';
import { Candle, Instrument, Timeframe, Venue, VenueStatus } from '@trade-automation/contracts';
import { VenueAdapter } from '../venue-adapter.port';

export type ReplaySpeed = 'realtime' | 'fast';

/**
 * architecture/live-signal-server.md §4.1 — "This adapter is in the scaffold scope, not a
 * nice-to-have: it is how the pipeline is testable without live venues."
 *
 * Reads 1m candles from a local JSONL fixture (one line per Candle, ascending by openTime)
 * and replays them as a stream with the same forming/closed semantics a live venue adapter
 * would produce: each bar is emitted once `closed:false` (the "tick" that opens the bar)
 * and once `closed:true` (the bar's close), before moving to the next bar.
 *
 * Fixture layout: `<fixturesDir>/<venue>/<symbol>/1m.jsonl`.
 */
export class ReplayAdapter implements VenueAdapter {
  constructor(
    public readonly venue: Venue,
    private readonly fixturesDir: string,
    private readonly speed: ReplaySpeed = 'fast',
  ) {}

  private fixturePath(instrument: Instrument): string {
    return path.join(this.fixturesDir, instrument.venue, instrument.symbol, '1m.jsonl');
  }

  private loadFixture(instrument: Instrument): Candle[] {
    const file = this.fixturePath(instrument);
    if (!fs.existsSync(file)) {
      return [];
    }
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Candle)
      .sort((a, b) => a.openTime - b.openTime);
  }

  async fetchCandles(instrument: Instrument, tf: Timeframe, from: number, to: number): Promise<Candle[]> {
    if (tf !== '1m') {
      // The scaffold's fixtures are 1m only; coarser history is derived by the Resampler.
      return [];
    }
    return this.loadFixture(instrument)
      .filter((c) => c.openTime >= from && c.openTime <= to)
      .map((c) => ({ ...c, closed: true, source: 'venue-rest' as const }));
  }

  streamCandles(instrument: Instrument): Observable<Candle> {
    const bars = this.loadFixture(instrument);
    const speed = this.speed;
    return new Observable<Candle>((subscriber) => {
      let stopped = false;
      let i = 0;

      const emitNext = async () => {
        if (stopped || i >= bars.length) {
          if (!stopped) subscriber.complete();
          return;
        }
        const bar = bars[i];
        subscriber.next({ ...bar, closed: false, source: 'venue-stream' });
        subscriber.next({ ...bar, closed: true, source: 'venue-stream' });
        i += 1;

        if (speed === 'fast') {
          setImmediate(emitNext);
        } else {
          const next = bars[i];
          const delayMs = next ? Math.min(next.openTime - bar.openTime, 60_000) : 0;
          setTimeout(emitNext, delayMs);
        }
      };

      emitNext();

      return () => {
        stopped = true;
      };
    });
  }

  health(): Observable<VenueStatus> {
    return new Observable<VenueStatus>((subscriber) => {
      subscriber.next('up');
    });
  }
}
