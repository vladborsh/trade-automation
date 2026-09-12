import { Candle, Instrument, TIMEFRAME_MS, VenueStatus } from '@trade-automation/contracts';
import { VenueAdapter } from './venue-adapter.port';

export interface GapRepairResult {
  /** Bars to forward downstream, in ascending order: any repaired bars, then `candle`. */
  ordered: Candle[];
  gap: { from: number; to: number; count: number } | null;
}

/**
 * architecture/live-signal-server.md §4.1 — for every (instrument, 1m) tracks the last closed
 * openTime; on each closed candle, if the delta isn't exactly one bar and the venue is open,
 * fetches the missing range via `fetchCandles`, inserting it in order ahead of the new candle.
 * Deliberately decoupled from Nest/events so gap-repair ordering is unit-testable directly.
 */
export class GapRepair {
  private readonly lastClosedOpenTime = new Map<string, number>();

  async onClosed1m(
    instrument: Instrument,
    candle: Candle,
    adapter: VenueAdapter,
    venueStatus: VenueStatus,
  ): Promise<GapRepairResult> {
    const key = instrument.id;
    const last = this.lastClosedOpenTime.get(key);
    const oneBar = TIMEFRAME_MS['1m'];

    if (last === undefined || candle.openTime <= last) {
      this.lastClosedOpenTime.set(key, candle.openTime);
      return { ordered: [candle], gap: null };
    }

    const delta = candle.openTime - last;
    if (delta === oneBar || venueStatus !== 'up') {
      this.lastClosedOpenTime.set(key, candle.openTime);
      return { ordered: [candle], gap: null };
    }

    const gapFrom = last + oneBar;
    const gapTo = candle.openTime - oneBar;
    const repaired = await adapter.fetchCandles(instrument, '1m', gapFrom, gapTo);
    const ordered = [...repaired.sort((a, b) => a.openTime - b.openTime), candle];
    this.lastClosedOpenTime.set(key, candle.openTime);

    return { ordered, gap: { from: gapFrom, to: gapTo, count: repaired.length } };
  }

  lastKnownOpenTime(instrumentId: string): number | undefined {
    return this.lastClosedOpenTime.get(instrumentId);
  }

  seed(instrumentId: string, openTime: number): void {
    this.lastClosedOpenTime.set(instrumentId, openTime);
  }
}
