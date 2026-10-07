import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import type {
  WebCandlesResponse, WebCoverageResponse, WebDbHealthResponse, WebExchangeRequest,
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
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

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
      const error = toWebApiError('GET', path, response.status, await this.safeJson(response));
      // IB-BUG-008: with no session every page used to render the raw
      // `GET /health/streams failed: UNAUTHENTICATED`, which tells a member nothing they can act
      // on. One redirect here covers every guarded call rather than each page remembering to
      // check — and the login screen says how to get a link. The error is still thrown so the
      // caller's own state machine settles.
      //
      // **Never from /login itself.** The shell calls /auth/me on every load, including on the
      // login page, where a 401 is the NORMAL state — there is no session yet, that is the point
      // of being there. Redirecting then navigates /login?t=<token> to /login and destroys the
      // token in the URL, so the link the bot just sent becomes "this link carries no token".
      // Found on a real run: it would have broken the exact flow this task exists to fix.
      //
      // The current page comes from `location`, NOT from `router.url`: /auth/me is fired by the
      // shell during bootstrap, before the first navigation has settled, and until it does
      // `router.url` is still '/'. Measured on a live run — the guard written against the router
      // let the redirect through and the token was destroyed anyway. `location.pathname` is
      // correct from the first byte.
      const onLogin = this.document.location.pathname === '/login';
      if (error.code === 'UNAUTHENTICATED' && !onLogin) void this.router.navigateByUrl('/login');
      throw error;
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
