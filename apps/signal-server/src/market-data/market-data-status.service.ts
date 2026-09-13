import { Injectable } from '@nestjs/common';
import { InstrumentId, Timeframe, VenueStatus } from '@trade-automation/contracts';

interface InstrumentStatus {
  venueStatus: VenueStatus;
  lastClosedCandleTime: number | null;
  gapCount24h: { at: number }[];
}

/** architecture/live-signal-server.md §12.3 — per (instrument, timeframe) Phase 2 progress. */
export type BackfillStatus = 'deepening' | 'complete';

function backfillKey(id: InstrumentId, tf: Timeframe): string {
  return `${id}|${tf}`;
}

/** Backs `GET /api/health` and the WS `status` frame (§3.5). */
@Injectable()
export class MarketDataStatusService {
  private readonly byInstrument = new Map<InstrumentId, InstrumentStatus>();
  private readonly backfillByInstrumentTf = new Map<string, BackfillStatus>();

  private entry(id: InstrumentId): InstrumentStatus {
    let e = this.byInstrument.get(id);
    if (!e) {
      e = { venueStatus: 'down', lastClosedCandleTime: null, gapCount24h: [] };
      this.byInstrument.set(id, e);
    }
    return e;
  }

  setVenueStatus(id: InstrumentId, status: VenueStatus): void {
    this.entry(id).venueStatus = status;
  }

  recordClosedCandle(id: InstrumentId, openTime: number): void {
    this.entry(id).lastClosedCandleTime = openTime;
  }

  recordGap(id: InstrumentId): void {
    const e = this.entry(id);
    e.gapCount24h.push({ at: Date.now() });
    const cutoff = Date.now() - 24 * 60 * 60_000;
    e.gapCount24h = e.gapCount24h.filter((g) => g.at >= cutoff);
  }

  get(id: InstrumentId) {
    return this.entry(id);
  }

  all(): Map<InstrumentId, InstrumentStatus> {
    return this.byInstrument;
  }

  /** §12.3: `'deepening'` until `IngestionService.deepenHistoryAsync` finishes this pair's 1m walk. */
  setBackfillStatus(id: InstrumentId, tf: Timeframe, status: BackfillStatus): void {
    this.backfillByInstrumentTf.set(backfillKey(id, tf), status);
  }

  /** Defaults to `'complete'` for a pair that never had a Phase 2 deepening pass tracked (e.g. non-`1m`). */
  getBackfillStatus(id: InstrumentId, tf: Timeframe): BackfillStatus {
    return this.backfillByInstrumentTf.get(backfillKey(id, tf)) ?? 'complete';
  }
}
