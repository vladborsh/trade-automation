import { Injectable, inject } from '@angular/core';
import type {
  WebCoverageResponse, WebDbHealthResponse, WebExchangeRequest, WebExchangeResponse, WebGapReportsResponse, WebStreamsResponse,
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

  async coverage(): Promise<WebCoverageResponse> {
    return this.get<WebCoverageResponse>('/coverage');
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
