import { Injectable, inject } from '@angular/core';
import type {
  WebCandlesResponse, WebCoverageResponse, WebDbHealthResponse, WebExchangeRequest, WebFearGreedResponse, WebMarketCapResponse,
  WebExchangeResponse, WebFundingResponse, WebGapReportsResponse, WebLiquidationsResponse,
  WebLongShortResponse, WebStreamsResponse, WebTimeframe, WebTopLiquidation,
  WebUniverseTopResponse,
} from '@trade-automation/contracts';
import { AppConfigService } from '@backtest-core/config/app-config.service';
import { buildUrl } from '@backtest-core/api/api-error';
import { toWebApiError } from './web-api-error';

/**
 * architecture/insight-bot-web-dashboard.md §3, §4 — the dashboard's REST surface, all under
 * `/api/web` and all carrying the `ib_session` cookie.
 *
 * **This is the first proof of the shared-import pattern (risk §8.1)**, written up in
 * `apps/chart-client/README.md`: `AppConfigService` and `buildUrl` come from the
 * backtest SPA's `core/` through the `@backtest-core/*` tsconfig alias, never copied. What is
 * *not* reused is the backtest `RestClient` itself: its methods are typed per backtest endpoint
 * and it carries the `bt_session` cookie's 401 semantics, so aliasing it here would mean either
 * forking it or bending it around a second app. The genuinely app-agnostic parts are the URL
 * builder, the error envelope and the config loader, and those are exactly what this imports.
 *
 * `credentials: 'include'` on every call: the session is a cookie, and the dev server runs on a
 * different origin from the API (`:4215` against `:3015`).
 */
@Injectable({ providedIn: 'root' })
export class InsightApiClient {
  private readonly config = inject(AppConfigService);

  async streams(): Promise<WebStreamsResponse> {
    return this.get<WebStreamsResponse>('/health/streams');
  }

  async gapReports(days = 14): Promise<WebGapReportsResponse> {
    return this.get<WebGapReportsResponse>('/health/gap-reports', { days });
  }

  async dbHealth(): Promise<WebDbHealthResponse> {
    return this.get<WebDbHealthResponse>('/health/db');
  }

  /**
   * The signed-in member. IB-029 owns the contract; the dashboard needs it for two things: whether
   * there is a session at all, and the member's `lang` (§11 — the dashboard follows the bot).
   */
  async me(): Promise<{ user?: { lang?: unknown } }> {
    return this.get<{ user?: { lang?: unknown } }>('/auth/me');
  }

  async coverage(): Promise<WebCoverageResponse> {
    return this.get<WebCoverageResponse>('/coverage');
  }

  // ------------------------------------------------------ IB-031, the instrument view

  async universeTop(n = 20): Promise<WebUniverseTopResponse> {
    return this.get<WebUniverseTopResponse>('/universe/top', { n });
  }

  /**
   * Every series call takes the same `from`/`to` in epoch **milliseconds**. The server refuses a
   * 1m range over 90 days with `RANGE_TOO_WIDE` rather than trimming it, so a caller that wants
   * a wider window must coarsen the timeframe — `toWebApiError` keeps `maxDays` on the message
   * so the page can say which.
   */
  async candles(symbol: string, fromMs: number, toMs: number, tf: WebTimeframe, market = 'perp'): Promise<WebCandlesResponse> {
    return this.get<WebCandlesResponse>('/series/candles', { symbol, from: fromMs, to: toMs, tf, market });
  }

  async funding(symbol: string, fromMs: number, toMs: number): Promise<WebFundingResponse> {
    return this.get<WebFundingResponse>('/series/funding', { symbol, from: fromMs, to: toMs });
  }

  async openInterest(symbol: string, fromMs: number, toMs: number): Promise<{ symbol: string; venue: string; points: Array<{ time: number; value: number; notional: number | null }>; downsampled: boolean }> {
    return this.get('/series/oi', { symbol, from: fromMs, to: toMs });
  }

  async longShort(symbol: string, fromMs: number, toMs: number, kind: string): Promise<WebLongShortResponse> {
    return this.get<WebLongShortResponse>('/series/ls', { symbol, from: fromMs, to: toMs, kind });
  }

  async liquidations(symbol: string, fromMs: number, toMs: number, bucket: string, venue = 'all'): Promise<WebLiquidationsResponse> {
    return this.get<WebLiquidationsResponse>('/series/liquidations', { symbol, from: fromMs, to: toMs, bucket, venue });
  }

  async topLiquidations(symbol: string, fromMs: number, toMs: number, n = 50): Promise<{ symbol: string; rows: WebTopLiquidation[] }> {
    return this.get('/series/liquidations/top', { symbol, from: fromMs, to: toMs, n });
  }

  /** IB-037 §10: Fear & Greed for a window, plus the whole series' newest point for the gauge. */
  async fearGreed(fromMs: number, toMs: number): Promise<WebFearGreedResponse> {
    return this.get<WebFearGreedResponse>('/context/fear-greed', { from: fromMs, to: toMs });
  }

  /** IB-037 §10: the top-20 stacked shares, the current table and the dominance line. */
  async marketCap(fromMs: number, toMs: number): Promise<WebMarketCapResponse> {
    return this.get<WebMarketCapResponse>('/context/market-cap', { from: fromMs, to: toMs });
  }

  /**
   * IB-029's one-time login link. The only POST here, and the only call that may be made without
   * a session — it is how the session is obtained. `toWebApiError` keeps the server's `{code}`, which
   * is what the page branches on (a forwarded link and an expired one need different sentences).
   */
  async exchange(token: string): Promise<WebExchangeResponse> {
    const body: WebExchangeRequest = { token };
    const url = buildUrl(this.config.get().apiBaseUrl, '/auth/exchange', window.location.origin);
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw toWebApiError('POST', '/auth/exchange', response.status, await this.safeJson(response));
    }
    return (await response.json()) as WebExchangeResponse;
  }

  private async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = buildUrl(this.config.get().apiBaseUrl, path, window.location.origin, params);
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      throw toWebApiError('GET', path, response.status, await this.safeJson(response));
    }
    return (await response.json()) as T;
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null; // a proxy's HTML error page is not an envelope; toApiError copes with null
    }
  }
}
