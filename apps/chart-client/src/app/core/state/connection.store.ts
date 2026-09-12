import { Injectable, signal } from '@angular/core';
import type { InstrumentId, VenueStatus } from '../contracts/contracts';
import type { ConnectionState } from '../api/live.socket';

@Injectable({ providedIn: 'root' })
export class ConnectionStore {
  private readonly state = signal<ConnectionState>('connecting');
  private readonly venueStatuses = signal<Map<InstrumentId, { venueStatus: VenueStatus; lastClosedCandleTime: number | null }>>(
    new Map(),
  );

  readonly connectionState = this.state.asReadonly();
  readonly perInstrumentStatus = this.venueStatuses.asReadonly();

  setConnectionState(state: ConnectionState): void {
    this.state.set(state);
  }

  setVenueStatus(instrument: InstrumentId, venueStatus: VenueStatus, lastClosedCandleTime: number | null): void {
    this.venueStatuses.update((current) => {
      const next = new Map(current);
      next.set(instrument, { venueStatus, lastClosedCandleTime });
      return next;
    });
  }

  statusFor(instrument: InstrumentId): { venueStatus: VenueStatus; lastClosedCandleTime: number | null } | null {
    return this.venueStatuses().get(instrument) ?? null;
  }
}
