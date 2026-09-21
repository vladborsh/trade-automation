import { Injectable, inject } from '@angular/core';
import type {
  AdvanceRequest,
  AdvanceResult,
  AheadResponse,
  BacktestInstrumentsResponse,
  CancelRequest,
  CloseRequest,
  CloseResponse,
  CreateSessionRequest,
  ModifyOrderRequest,
  Order,
  OrderDetail,
  PatchSessionRequest,
  PlaceOrderRequest,
  PlaceOrderResponse,
  ReplayHistoryResponse,
  Session,
  SessionDetail,
  SessionStatsResponse,
  SessionSummariesResponse,
  Timeframe,
} from '@trade-automation/contracts';
import { AppConfigService } from '../config/app-config.service';
import { RestClient } from './rest.client';
import { serverUrl } from './server-url';

/**
 * backtest-app-system-design.md §7.2 — typed fetchers for the backtest API. Every call goes
 * through `RestClient.send`, so credentials, `ApiError` (status + contract code) and the
 * 401 → /login redirect behave exactly as for the rest of the app.
 */
@Injectable({ providedIn: 'root' })
export class BacktestClient {
  private readonly rest = inject(RestClient);
  private readonly config = inject(AppConfigService);

  /** Every configured instrument with its 1m coverage (null when nothing is stored). */
  getInstruments(): Promise<BacktestInstrumentsResponse> {
    return this.rest.send('GET', '/backtest/instruments');
  }

  listSessions(): Promise<SessionSummariesResponse> {
    return this.rest.send('GET', '/backtest/sessions');
  }

  getSession(id: string): Promise<SessionDetail> {
    return this.rest.send('GET', `/backtest/sessions/${encodeURIComponent(id)}`);
  }

  createSession(body: CreateSessionRequest): Promise<Session> {
    return this.rest.send('POST', '/backtest/sessions', { body });
  }

  patchSession(id: string, body: PatchSessionRequest): Promise<Session> {
    return this.rest.send('PATCH', `/backtest/sessions/${encodeURIComponent(id)}`, { body });
  }

  /**
   * §7.2 — closed `timeframe` bars behind `before` (`<= cursor`, else 422 FUTURE_REQUESTED), plus
   * the bar forming at `before`.
   */
  getReplayHistory(id: string, panelId: string, timeframe: Timeframe, before: number, limit: number): Promise<ReplayHistoryResponse> {
    return this.rest.send('GET', `/backtest/sessions/${encodeURIComponent(id)}/candles`, {
      params: { panelId, timeframe, before, limit },
    });
  }

  /** §5.3/§7.2 — up to `limit` 1m candles with `openTime >= fromMs`, compact tuples, clamped to the period. */
  getReplayAhead(id: string, panelId: string, fromMs: number, limit: number): Promise<AheadResponse> {
    return this.rest.send('GET', `/backtest/sessions/${encodeURIComponent(id)}/candles/ahead`, {
      params: { panelId, fromMs, limit },
    });
  }

  /** §7.2 — the journal: every order of the session by `seq`, optionally one status only. */
  listOrders(id: string, status?: Order['status']): Promise<Order[]> {
    return this.rest.send('GET', `${sessionPath(id)}/orders`, { params: { status } });
  }

  /** §7.2, §9.3 — one order with its modification history and the URLs of its screenshots (T-025). */
  getOrder(id: string, orderId: string): Promise<OrderDetail> {
    return this.rest.send('GET', orderPath(id, orderId));
  }

  /**
   * A screenshot by the URL `getOrder` returned (a server path, proxied — the bucket stays private),
   * fetched with the session cookie. Null when it cannot be had; the page shows a placeholder.
   */
  async fetchScreenshot(path: string): Promise<Blob | null> {
    try {
      const res = await fetch(serverUrl(this.config.get().apiBaseUrl, path, window.location.origin), { credentials: 'include' });
      return res.ok ? await res.blob() : null;
    } catch {
      return null;
    }
  }

  /** §7.2, decision 38 — the full recompute plus the stored aggregates and whether they drifted. */
  getStats(id: string): Promise<SessionStatsResponse> {
    return this.rest.send('GET', `${sessionPath(id)}/stats`);
  }

  // --- mutations (§5.5, §7.2): each body carries its opId; the AdvanceQueue builds them once --------

  advance(id: string, body: AdvanceRequest): Promise<AdvanceResult> {
    return this.rest.send('POST', `${sessionPath(id)}/advance`, { body });
  }

  placeOrder(id: string, body: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    return this.rest.send('POST', `${sessionPath(id)}/orders`, { body });
  }

  cancelOrder(id: string, orderId: string, body: CancelRequest): Promise<Order> {
    return this.rest.send('POST', `${orderPath(id, orderId)}/cancel`, { body });
  }

  closeOrder(id: string, orderId: string, body: CloseRequest): Promise<CloseResponse> {
    return this.rest.send('POST', `${orderPath(id, orderId)}/close`, { body });
  }

  modifyOrder(id: string, orderId: string, body: ModifyOrderRequest): Promise<Order> {
    return this.rest.send('PATCH', orderPath(id, orderId), { body });
  }

  /** Irreversible: the session, its orders and its screenshots (§3, decision 30b). */
  deleteSession(id: string): Promise<void> {
    return this.rest.send('DELETE', `/backtest/sessions/${encodeURIComponent(id)}`);
  }
}

function sessionPath(id: string): string {
  return `/backtest/sessions/${encodeURIComponent(id)}`;
}

function orderPath(id: string, orderId: string): string {
  return `${sessionPath(id)}/orders/${encodeURIComponent(orderId)}`;
}
