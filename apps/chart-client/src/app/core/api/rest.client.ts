import { Injectable, inject } from '@angular/core';
import { AppConfigService } from '../config/app-config.service';
import type {
  AcceptInviteRequest,
  AcceptInviteResponse,
  InviteInfo,
  LoginRequest,
  LoginResponse,
  MeResponse,
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
import { buildUrl, toApiError } from './api-error';
import { UNAUTHORIZED_HANDLER } from './unauthorized-handler';

/**
 * Typed fetchers for the REST surface in §3.5. Plain `fetch`, no RxJS here —
 * RxJS is reserved for the WS boundary (live.socket.ts).
 *
 * backtest-app-system-design.md §7.1: every request carries the `bt_session` cookie
 * (`credentials: 'include'`), and a 401 on a data request means "go to /login". Auth calls
 * (`/auth/*`) report their own 401s (wrong password, no session yet) to the caller instead.
 * Failures throw `ApiError` (status + contract error code).
 */
@Injectable({ providedIn: 'root' })
export class RestClient {
  private readonly onUnauthorized = inject(UNAUTHORIZED_HANDLER);

  constructor(private readonly config: AppConfigService) {}

  private get baseUrl(): string {
    return this.config.get().apiBaseUrl;
  }

  private async getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    return this.request<T>('GET', path, { params, redirectOn401: true });
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: { params?: Record<string, string | number | undefined>; body?: unknown; redirectOn401: boolean },
  ): Promise<T> {
    const response = await fetch(buildUrl(this.baseUrl, path, window.location.origin, opts.params), {
      method,
      credentials: 'include',
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    if (!response.ok) {
      if (response.status === 401 && opts.redirectOn401) {
        this.onUnauthorized();
      }
      const body: unknown = await response.json().catch(() => null);
      throw toApiError(method, path, response.status, body);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  // --- auth (§7.1) ---------------------------------------------------------------------------

  getMe(): Promise<MeResponse> {
    return this.request<MeResponse>('GET', '/auth/me', { redirectOn401: false });
  }

  login(body: LoginRequest): Promise<LoginResponse> {
    return this.request<LoginResponse>('POST', '/auth/login', { body, redirectOn401: false });
  }

  logout(): Promise<void> {
    return this.request<void>('POST', '/auth/logout', { redirectOn401: false });
  }

  getInvite(token: string): Promise<InviteInfo> {
    return this.request<InviteInfo>('GET', `/auth/invites/${encodeURIComponent(token)}`, { redirectOn401: false });
  }

  acceptInvite(token: string, body: AcceptInviteRequest): Promise<AcceptInviteResponse> {
    return this.request<AcceptInviteResponse>('POST', `/auth/invites/${encodeURIComponent(token)}/accept`, {
      body,
      redirectOn401: false,
    });
  }

  // --- market data ---------------------------------------------------------------------------

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
