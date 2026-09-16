import { Injectable } from '@angular/core';
import { AppConfigService } from '../config/app-config.service';
import type {
  Candle,
  IndicatorPoint,
  InstrumentId,
  Layout,
  MetricKind,
  MetricPoint,
  Signal,
  Timeframe,
} from '@trade-automation/contracts';
import type { Health, InstrumentWithStatus, StrategyInfo } from '../contracts/derived';
import type { CalendarNotification, CalendarWeekResponse, EconomicEvent, EventDetailResponse } from '../contracts/calendar';

/**
 * Typed fetchers for the REST surface in §3.5. Plain `fetch`, no RxJS here —
 * RxJS is reserved for the WS boundary (live.socket.ts).
 */
@Injectable({ providedIn: 'root' })
export class RestClient {
  constructor(private readonly config: AppConfigService) {}

  private get baseUrl(): string {
    return this.config.get().apiBaseUrl;
  }

  private async getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(this.baseUrl.replace(/\/$/, '') + path, window.location.origin);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`GET ${path} failed: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  getInstruments(): Promise<InstrumentWithStatus[]> {
    return this.getJson<InstrumentWithStatus[]>('/instruments');
  }

  getCandles(
    instrument: InstrumentId,
    timeframe: Timeframe,
    from?: number,
    to?: number,
    limit = 1500,
  ): Promise<Candle[]> {
    return this.getJson<Candle[]>('/candles', { instrument, timeframe, from, to, limit });
  }

  getSignals(instrument: InstrumentId, from?: number, to?: number, strategyId?: string): Promise<Signal[]> {
    return this.getJson<Signal[]>('/signals', { instrument, from, to, strategyId });
  }

  getStrategies(): Promise<StrategyInfo[]> {
    return this.getJson<StrategyInfo[]>('/strategies');
  }

  getIndicators(instrument: InstrumentId, from?: number, to?: number, strategyId?: string): Promise<IndicatorPoint[]> {
    return this.getJson<IndicatorPoint[]>('/indicators', { instrument, from, to, strategyId });
  }

  getHealth(): Promise<Health> {
    return this.getJson<Health>('/health');
  }

  getLayouts(): Promise<Layout[]> {
    return this.getJson<Layout[]>('/layouts');
  }

  getMetrics(
    instrument: InstrumentId,
    metric: MetricKind,
    timeframe: Timeframe,
    from?: number,
    to?: number,
    limit = 1500,
  ): Promise<MetricPoint[]> {
    return this.getJson<MetricPoint[]>('/metrics', { instrument, metric, timeframe, from, to, limit });
  }

  /** §6.1 `GET /api/calendar/week?at?` — the ET Sun–Sat window containing `at` (default now). */
  getCalendarWeek(at?: number): Promise<CalendarWeekResponse> {
    return this.getJson<CalendarWeekResponse>('/calendar/week', { at });
  }

  getCalendarEvents(from: number, to: number): Promise<EconomicEvent[]> {
    return this.getJson<EconomicEvent[]>('/calendar/events', { from, to });
  }

  getCalendarEvent(id: string): Promise<EventDetailResponse> {
    return this.getJson<EventDetailResponse>(`/calendar/events/${encodeURIComponent(id)}`);
  }

  getCalendarNotifications(from?: number, limit = 50): Promise<CalendarNotification[]> {
    return this.getJson<CalendarNotification[]>('/calendar/notifications', { from, limit });
  }
}
