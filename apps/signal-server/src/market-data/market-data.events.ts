import { Candle, InstrumentId, Timeframe, VenueStatus } from '@trade-automation/contracts';

/** architecture/live-signal-server.md §4.2 — event names on @nestjs/event-emitter's in-process bus. */
export const MarketDataEvents = {
  CandleForming: 'market-data.candle.forming',
  CandleClosed: 'market-data.candle.closed',
  GapRepaired: 'market-data.gap.repaired',
  VenueStatusChanged: 'market-data.venue.status-changed',
} as const;

export class CandleFormingEvent {
  constructor(public readonly candle: Candle) {}
}

export class CandleClosedEvent {
  constructor(public readonly candle: Candle) {}
}

export class GapRepairedEvent {
  constructor(
    public readonly instrument: InstrumentId,
    public readonly timeframe: Timeframe,
    public readonly from: number,
    public readonly to: number,
    public readonly count: number,
  ) {}
}

export class VenueStatusChangedEvent {
  constructor(
    public readonly instrument: InstrumentId,
    public readonly venueStatus: VenueStatus,
  ) {}
}
