import { Injectable } from '@nestjs/common';
import { InstrumentId, VenueStatus } from '@trade-automation/contracts';

interface InstrumentStatus {
  venueStatus: VenueStatus;
  lastClosedCandleTime: number | null;
  gapCount24h: { at: number }[];
}

/** Backs `GET /api/health` and the WS `status` frame (§3.5). */
@Injectable()
export class MarketDataStatusService {
  private readonly byInstrument = new Map<InstrumentId, InstrumentStatus>();

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
}
