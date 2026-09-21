import { Injectable, inject } from '@angular/core';
import type {
  AheadResponse,
  BacktestInstrumentsResponse,
  CreateSessionRequest,
  PatchSessionRequest,
  ReplayHistoryResponse,
  Session,
  SessionDetail,
  SessionSummariesResponse,
  Timeframe,
} from '@trade-automation/contracts';
import { RestClient } from './rest.client';

/**
 * backtest-app-system-design.md §7.2 — typed fetchers for the backtest API. Every call goes
 * through `RestClient.send`, so credentials, `ApiError` (status + contract code) and the
 * 401 → /login redirect behave exactly as for the rest of the app.
 */
@Injectable({ providedIn: 'root' })
export class BacktestClient {
  private readonly rest = inject(RestClient);

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

  /** Irreversible: the session, its orders and its screenshots (§3, decision 30b). */
  deleteSession(id: string): Promise<void> {
    return this.rest.send('DELETE', `/backtest/sessions/${encodeURIComponent(id)}`);
  }
}
