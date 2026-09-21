import {
  CalendarNotification,
  Candle,
  Coverage,
  EconomicEvent,
  EventRevision,
  InstrumentId,
  MetricKind,
  MetricObservation,
  Signal,
  Timeframe,
} from '@trade-automation/contracts';
import { CandleStore } from './candle-store.port';
import { EventStore } from './event-store.port';
import { MetricStore } from './metric-store.port';
import { SignalStore } from './signal-store.port';

/**
 * BUG-006 (Tech Lead ruling: option a, extended to all four data stores) — with
 * `MARKET_DATA_MODE=replay` the server replays test fixtures through the ingestion pipeline, the
 * strategy engine and (via the fixture feed) the calendar. None of that may reach FILE_STORE_ROOT
 * or the bucket: it holds the real tape the backtest app replays from, and the real signals and
 * calendar history. In replay mode the candle, metric, signal and event stores are wrapped so every
 * **write is dropped** and every **read goes to the real store** (backtest coverage and history
 * keep reading the real data). The ScreenshotStore is not wrapped: it holds user uploads and
 * replay never reaches it.
 *
 * Done at the store boundary rather than in each writer, so every writer is covered at once:
 * ingestion backfill and gap fill, WriteBuffer, MetricWriteBuffer, the /api/candles fetch-on-miss,
 * the strategy runner's signal append, and the calendar's ingestion, actuals backfill and
 * notification scheduler.
 *
 * Accepted consequences in replay mode (Tech Lead, BUG-006):
 * - candles and open interest: none; the fixtures fit the in-memory caches the live endpoints read first;
 * - `GET /api/signals` returns no replay signals (markers still arrive over WS after page load);
 * - `GET /api/calendar/notifications` and event revisions have no replay history;
 * - the notification scheduler seeds its "already fired" set from the store at boot, so a
 *   replay-mode restart may fire a notification from the last two days again.
 */
export class NoPersistCandleStore implements CandleStore {
  constructor(private readonly inner: CandleStore) {}

  async upsert(_candles: Candle[]): Promise<void> {
    // replay mode: dropped, never persisted (BUG-006)
  }

  query(instrument: InstrumentId, tf: Timeframe, from: number, to: number): Promise<Candle[]> {
    return this.inner.query(instrument, tf, from, to);
  }

  latestOpenTime(instrument: InstrumentId, tf: Timeframe): Promise<number | null> {
    return this.inner.latestOpenTime(instrument, tf);
  }

  stream(instrument: InstrumentId, tf: Timeframe, from: number, to?: number): AsyncIterable<Candle> {
    return this.inner.stream(instrument, tf, from, to);
  }

  coverage(instrument: InstrumentId, tf: Timeframe): Promise<Coverage | null> {
    return this.inner.coverage(instrument, tf);
  }
}

export class NoPersistMetricStore implements MetricStore {
  constructor(private readonly inner: MetricStore) {}

  async upsert(_observations: MetricObservation[]): Promise<void> {
    // replay mode: dropped, never persisted (BUG-006)
  }

  query(instrument: InstrumentId, metric: MetricKind, from: number, to: number): Promise<MetricObservation[]> {
    return this.inner.query(instrument, metric, from, to);
  }

  latestTime(instrument: InstrumentId, metric: MetricKind): Promise<number | null> {
    return this.inner.latestTime(instrument, metric);
  }
}

export class NoPersistSignalStore implements SignalStore {
  constructor(private readonly inner: SignalStore) {}

  async append(_signals: Signal[]): Promise<void> {
    // replay mode: dropped, never persisted (BUG-006)
  }

  query(instrument: InstrumentId, from: number, to: number, strategyId?: string): Promise<Signal[]> {
    return this.inner.query(instrument, from, to, strategyId);
  }
}

export class NoPersistEventStore implements EventStore {
  constructor(private readonly inner: EventStore) {}

  async upsert(_events: EconomicEvent[]): Promise<void> {
    // replay mode: dropped, never persisted (BUG-006)
  }

  async appendRevisions(_rows: EventRevision[]): Promise<void> {
    // replay mode: dropped, never persisted (BUG-006)
  }

  async appendNotifications(_rows: CalendarNotification[]): Promise<void> {
    // replay mode: dropped, never persisted (BUG-006)
  }

  queryByScheduled(from: number, to: number): Promise<EconomicEvent[]> {
    return this.inner.queryByScheduled(from, to);
  }

  get(id: string): Promise<EconomicEvent | null> {
    return this.inner.get(id);
  }

  queryRevisions(eventId: string): Promise<EventRevision[]> {
    return this.inner.queryRevisions(eventId);
  }

  queryNotifications(from: number, to: number): Promise<CalendarNotification[]> {
    return this.inner.queryNotifications(from, to);
  }
}

/** True when replayed data must not be persisted. */
export function isReplayMode(mode: unknown): boolean {
  return mode === 'replay';
}
