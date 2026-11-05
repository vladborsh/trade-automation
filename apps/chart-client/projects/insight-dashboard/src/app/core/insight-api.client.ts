import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import type {
  WebInviteResponse, WebMemberResponse, WebMemberSettings, WebMemberSettingsPatch, WebMembersResponse,
  WebAlertsAdminResponse,
  WebLiqAlertsAdminResponse,
  WebLiqAlertSettingsPatch, WebAlertSettingsPatch, WebAlertSymbolAdd, WebAlertSymbolPatch,
  WebOpenInterestResponse, OiDivergenceTf, WebOiDivergenceSeriesResponse,
  WebAuthContext, WebCandlesResponse, WebChangePasswordRequest, WebCredentialsInfoResponse, WebDbHealthResponse,
  WebLoginEventsResponse, WebLoginRequest, WebLoginResponse, WebMarketCardsResponse, WebSetCredentialsRequest,
  WebFundingResponse, WebLiquidationsResponse, WebCapsResponse, WebFlowsResponse, WebInsightsResponse, WebPositioningResponse, WebKpisResponse, WebMarketPeriod,
  WebLiquidationEventsResponse, WebLiquidationsOverviewResponse, WebLongShortResponse,
  WebCalendarEventsResponse, WebPushSubscription, WebPushVapidKeyResponse, WebStreamsResponse, WebTimeframe, WebTopLiquidation, WebUniverseSummaryResponse, WebUniverseTopResponse,
  WebLiquidationsLargeQuery,
  WebLiquidationsLargeResponse,
  WebLiquidationEpisodesResponse,
} from '@trade-automation/contracts';
import { WebLiquidationEpisodesResponseSchema } from '@trade-automation/contracts';
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
/** Pages a visitor is on WITHOUT a session by design: a 401 there is normal, never a redirect. */
export const PUBLIC_PAGES: readonly string[] = ['/login', '/set-password'];

@Injectable({ providedIn: 'root' })
export class InsightApiClient {
  private readonly config = inject(AppConfigService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  async streams(): Promise<WebStreamsResponse> {
    return this.get<WebStreamsResponse>('/health/streams');
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

  // ------------------------------------------------------ IB-031, the instrument view

  async universeTop(n = 20): Promise<WebUniverseTopResponse> {
    return this.get<WebUniverseTopResponse>('/universe/top', { n });
  }

  /** The symbol dropdown's figures, read live from Binance and cached about a minute server-side. */
  async universeSummary(n = 20): Promise<WebUniverseSummaryResponse> {
    return this.get<WebUniverseSummaryResponse>('/universe/summary', { n });
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

  // IB-081: the contract's type, not a hand-written copy of it — the copy lacked `coverageFrom`/`truncated`
  /** IB-110 (V11): the OI divergence lines of a coin on 15m, 1h or 4h, computed by the server on open. */
  async oiDivergences(symbol: string, tf: OiDivergenceTf): Promise<WebOiDivergenceSeriesResponse> {
    return this.get<WebOiDivergenceSeriesResponse>('/series/oi-divergences', { symbol, tf });
  }

  async openInterest(symbol: string, fromMs: number, toMs: number): Promise<WebOpenInterestResponse> {
    return this.get<WebOpenInterestResponse>('/series/oi', { symbol, from: fromMs, to: toMs });
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
   * IB-039 §12.5 — individual liquidations for the chart's markers.
   *
   * The server REFUSES a window holding more than 2 000 events rather than truncating it, and
   * the `RANGE_TOO_WIDE` it answers with carries the `minUsd` that would fit. A silently
   * truncated list would draw a chart that goes calm halfway through a cascade.
   *
   * IB-068: with `tf`, the server groups the events per `tf` bar (one row per bar, side and venue,
   * carrying `count` and `maxUsd`) and the 2 000 cap no longer applies, so a dense window still
   * draws its bubbles. Without it, the individual events as before.
   */
  async liquidationEvents(
    symbol: string, fromMs: number, toMs: number, minUsd = 0, tf?: WebTimeframe,
  ): Promise<WebLiquidationEventsResponse> {
    return this.get<WebLiquidationEventsResponse>('/series/liquidations/events', {
      symbol, from: fromMs, to: toMs, min_usd: minUsd, ...(tf ? { tf } : {}),
    });
  }

  // ------------------------------------------------------ IB-059, the economic calendar

  /** USD high-impact events and holidays in `[fromMs, toMs)`; the server refuses over 90 days. */
  async calendarEvents(fromMs: number, toMs: number): Promise<WebCalendarEventsResponse> {
    return this.get<WebCalendarEventsResponse>('/calendar/events', { from: fromMs, to: toMs });
  }

  /** High-impact USD events from 5 minutes ago to `withinMin` ahead — the browser alerts' read. */
  async calendarUpcoming(withinMin = 60): Promise<WebCalendarEventsResponse> {
    return this.get<WebCalendarEventsResponse>('/calendar/upcoming', { withinMin });
  }

  // ------------------------------------------------------ IB-038, the liquidation surfaces

  /**
   * One call behind the card, the table and the feed (§12.3).
   *
   * No `from`/`to`: the windows are 1 h / 4 h / 24 h ending now, by definition, and letting a
   * caller choose them would invite a card labelled «сейчас» showing last Tuesday. The server
   * caches for 15 s, so the page may poll without multiplying the query.
   */
  async liquidationsOverview(feedMinUsd = 100_000, feedLimit = 30, period: WebMarketPeriod = '24h'): Promise<WebLiquidationsOverviewResponse> {
    return this.get<WebLiquidationsOverviewResponse>('/liquidations/overview', {
      symbols: 'top20', feed_min_usd: feedMinUsd, feed_limit: feedLimit, period,
    });
  }

  /**
   * IB-120 — the /liquidations page: the period's large liquidations, filtered, ≤ 1 000 newest first.
   * Our tape only (venue weight 0); the server caches each filter set for 10 s.
   */
  async liquidationsLarge(q: WebLiquidationsLargeQuery): Promise<WebLiquidationsLargeResponse> {
    return this.get<WebLiquidationsLargeResponse>('/liquidations/large', {
      period: q.period, symbol: q.symbol, minUsd: q.minUsd, side: q.side, venue: q.venue,
    });
  }

  /**
   * IB-134 — the /liquidations episodes (design E7): the norm, the summary, ≤ 10/5 episodes with their
   * price paths. Parsed by the contract (E7: "zod-parsed by the client"): the cards do arithmetic on
   * these fields, so an answer that breaks the schema's invariants is an error, not a wrong card.
   */
  async liquidationEpisodes(q: WebLiquidationsLargeQuery): Promise<WebLiquidationEpisodesResponse> {
    const body = await this.get<unknown>('/liquidations/episodes', {
      period: q.period, symbol: q.symbol, minUsd: q.minUsd, side: q.side, venue: q.venue,
    });
    return WebLiquidationEpisodesResponseSchema.parse(body);
  }

  // ------------------------------------------------------ IB-037, the market cards

  /**
   * One call behind the whole market page (§12.1).
   *
   * The payload **is** the cards: every figure already carries its unit, the instant it was
   * measured and the venue it came from, so the page renders and derives nothing. There is no
   * `from`/`to` — a card has no range picker, and the deltas it shows are fixed by their labels
   * (previous published day, 24 h, 7 d, 30 d) rather than by whatever window a reader chose.
   */
  async marketCards(): Promise<WebMarketCardsResponse> {
    return this.get<WebMarketCardsResponse>('/context/cards');
  }

  // ------------------------------------------------------ IB-088, the market page shell

  /** D10: the six KPI tiles (server cache 60 s). */
  async marketKpis(): Promise<WebKpisResponse> {
    return this.get<WebKpisResponse>('/market/kpis');
  }

  /** D1: «Главное сейчас» for the page's period (server cache 60 s). */
  async marketInsights(period: WebMarketPeriod): Promise<WebInsightsResponse> {
    return this.get<WebInsightsResponse>('/market/insights', { period });
  }

  // ------------------------------------------------------ IB-090, positioning and caps blocks

  /** D9: one row per crypto coin for the period (server cache 60 s, baselines hourly). */
  async marketPositioning(period: WebMarketPeriod): Promise<WebPositioningResponse> {
    return this.get<WebPositioningResponse>('/market/positioning', { period });
  }

  /** D11: treemap coins and the dominance bar (server cache 120 s; 4h is refused by the source). */
  async marketCaps(period: WebMarketPeriod): Promise<WebCapsResponse> {
    return this.get<WebCapsResponse>('/market/caps', { period });
  }

  /** IB-091: «Деривативы и потоки» — DVOL, put/call, stablecoin supply, Coinbase premium (server cache 60 s, sources 1–60 min). */
  async marketFlows(period: WebMarketPeriod): Promise<WebFlowsResponse> {
    return this.get<WebFlowsResponse>('/market/flows', { period });
  }

  // ------------------------------------------------------ IB-079, login + password (IB-078's server)
  //
  // None of these redirect on failure: a wrong password is 401 INVALID_CREDENTIALS, not
  // UNAUTHENTICATED, and each page branches on the code itself.

  /** Which bot to tell people to message (`/password`). Public. */
  async authContext(): Promise<WebAuthContext> {
    return this.get<WebAuthContext>('/auth/context');
  }

  async login(body: WebLoginRequest): Promise<WebLoginResponse> {
    return this.sendJson<WebLoginResponse>('POST', '/auth/login', body);
  }

  /** Whether the set-password page asks for a login. Does not spend the link. */
  async credentialsInfo(token: string): Promise<WebCredentialsInfoResponse> {
    return this.get<WebCredentialsInfoResponse>('/auth/credentials', { t: token });
  }

  async setCredentials(body: WebSetCredentialsRequest): Promise<void> {
    await this.send('POST', '/auth/credentials', body);
  }

  async changePassword(body: WebChangePasswordRequest): Promise<void> {
    await this.send('POST', '/auth/password', body);
  }

  async logout(): Promise<void> {
    await this.send('POST', '/auth/logout', {});
  }

  async logoutAll(): Promise<void> {
    await this.send('POST', '/auth/logout-all', {});
  }

  /** Admin only: the login journal, newest first. */
  async loginEvents(limit = 200): Promise<WebLoginEventsResponse> {
    return this.get<WebLoginEventsResponse>('/admin/login-events', { limit });
  }

  // ------------------------------------------------------ IB-112, OI divergence alerts (admin)

  /** Admin only: the settings, the coin list, the last 50 journal rows and skips — the whole page. */
  async alertsAdmin(): Promise<WebAlertsAdminResponse> {
    return this.get<WebAlertsAdminResponse>('/admin/alerts');
  }

  /** Admin only: add a coin; checked against Binance (409 with a refusal code otherwise). */
  async addAlertSymbol(symbol: string): Promise<WebAlertsAdminResponse> {
    return this.sendJson<WebAlertsAdminResponse>('POST', '/admin/alerts/symbols', { symbol } satisfies WebAlertSymbolAdd);
  }

  async setAlertSymbolEnabled(symbol: string, enabled: boolean): Promise<WebAlertsAdminResponse> {
    return this.sendJson<WebAlertsAdminResponse>('PATCH', `/admin/alerts/symbols/${encodeURIComponent(symbol)}`, { enabled } satisfies WebAlertSymbolPatch);
  }

  /** Removing a coin stops evaluating it; its OI rows and journal stay (V3). */
  async removeAlertSymbol(symbol: string): Promise<WebAlertsAdminResponse> {
    return (await (await this.send('DELETE', `/admin/alerts/symbols/${encodeURIComponent(symbol)}`, {})).json()) as WebAlertsAdminResponse;
  }

  async patchAlertSettings(patch: WebAlertSettingsPatch): Promise<WebAlertsAdminResponse> {
    return this.sendJson<WebAlertsAdminResponse>('PATCH', '/admin/alerts/settings', patch);
  }

  // ------------------------------------------------------ IB-122, large-liquidation alerts (admin)

  /** Admin only: the «Large liquidations» section — switches, per-coin thresholds, the last 50 journal rows. */
  async liqAlertsAdmin(): Promise<WebLiqAlertsAdminResponse> {
    return this.get<WebLiqAlertsAdminResponse>('/admin/alerts/liq');
  }

  async patchLiqAlerts(patch: WebLiqAlertSettingsPatch): Promise<WebLiqAlertsAdminResponse> {
    return this.sendJson<WebLiqAlertsAdminResponse>('PATCH', '/admin/alerts/liq', patch);
  }

  // ------------------------------------------------------ IB-035, members and own settings

  /** Admin only: everyone with access, with their site login, last sign-in and live sessions. */
  async members(): Promise<WebMembersResponse> {
    return this.get<WebMembersResponse>('/admin/members');
  }

  /** Admin only: a new invite. The link is in this answer only. */
  async createInvite(): Promise<WebInviteResponse> {
    return this.sendJson<WebInviteResponse>('POST', '/admin/invites', {});
  }

  /** Admin only: disabling also signs the member out everywhere (the server deletes their sessions). */
  async setMemberDisabled(id: number, disabled: boolean): Promise<WebMemberResponse> {
    return this.sendJson<WebMemberResponse>('POST', `/admin/members/${id}/${disabled ? 'disable' : 'enable'}`, {});
  }

  async memberSettings(): Promise<WebMemberSettings> {
    return this.get<WebMemberSettings>('/me/settings');
  }

  async updateMemberSettings(patch: WebMemberSettingsPatch): Promise<WebMemberSettings> {
    return this.sendJson<WebMemberSettings>('PATCH', '/me/settings', patch);
  }

  // ------------------------------------------------------ IB-069, browser push

  /** `publicKey: null` — push is off on this server; the in-tab alerts still work. */
  async pushVapidKey(): Promise<WebPushVapidKeyResponse> {
    return this.get<WebPushVapidKeyResponse>('/push/vapid-key');
  }

  async pushSubscribe(subscription: WebPushSubscription): Promise<void> {
    await this.send('POST', '/push/subscription', subscription);
  }

  async pushUnsubscribe(endpoint: string): Promise<void> {
    await this.send('DELETE', '/push/subscription', { endpoint });
  }

  private async send(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown): Promise<Response> {
    const url = buildUrl(this.config.get().apiBaseUrl, path, window.location.origin);
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw toWebApiError(method, path, response.status, await this.safeJson(response));
    return response;
  }

  private async sendJson<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
    return (await (await this.send(method, path, body)).json()) as T;
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
      // IB-079: /set-password is the other page a visitor is on with no session by design
      const onPublicPage = PUBLIC_PAGES.includes(this.document.location.pathname);
      if (error.code === 'UNAUTHENTICATED' && !onPublicPage) void this.router.navigateByUrl('/login');
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
