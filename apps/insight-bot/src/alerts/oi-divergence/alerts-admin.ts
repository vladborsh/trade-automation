import type { WebAlertsAdminResponse, WebAlertSettingsPatch, WebAlertSymbolRefusal } from '@trade-automation/contracts';
import type { PgOiAlertStore } from './pg/oi-alerts.repo';
import { checkAlertSymbol } from './symbol-check';

/**
 * IB-112 (V17) — the admin page's server side, over the store: one read of the whole page, and the
 * writes, each answering with the whole page again. Adding a coin is checked against Binance's
 * `exchangeInfo` (cached, weight 1); if the venue does not answer nothing is added
 * (`venue_unavailable`) — a coin that might not exist must not go on the list unchecked.
 */
export class AlertsAdminRefusal extends Error {
  constructor(readonly code: WebAlertSymbolRefusal) {
    super(code);
  }
}

export class AlertsAdmin {
  constructor(
    private readonly store: Pick<PgOiAlertStore, 'settings' | 'symbols' | 'recentAlerts' | 'recentSkips' | 'addSymbol' | 'setSymbolEnabled' | 'removeSymbol' | 'updateSettings'>,
    private readonly exchangeInfo: () => Promise<unknown>,
  ) {}

  async page(): Promise<WebAlertsAdminResponse> {
    const [settings, symbols, alerts, skips] = await Promise.all([this.store.settings(), this.store.symbols(), this.store.recentAlerts(50), this.store.recentSkips(50)]);
    return { settings, symbols, alerts, skips };
  }

  async addSymbol(symbol: string, by: number): Promise<WebAlertsAdminResponse> {
    if ((await this.store.symbols()).some((s) => s.symbol === symbol)) throw new AlertsAdminRefusal('already_listed');
    let info: unknown;
    try {
      info = await this.exchangeInfo();
    } catch {
      throw new AlertsAdminRefusal('venue_unavailable');
    }
    const check = checkAlertSymbol(info, symbol);
    if (!check.ok) throw new AlertsAdminRefusal(check.refusal);
    if (!(await this.store.addSymbol(symbol, check.base, by))) throw new AlertsAdminRefusal('already_listed'); // a concurrent add
    return this.page();
  }

  /** Null when there is no such coin (the controller answers 404). */
  async setSymbolEnabled(symbol: string, enabled: boolean): Promise<WebAlertsAdminResponse | null> {
    return (await this.store.setSymbolEnabled(symbol, enabled)) ? this.page() : null;
  }

  async removeSymbol(symbol: string): Promise<WebAlertsAdminResponse | null> {
    return (await this.store.removeSymbol(symbol)) ? this.page() : null;
  }

  async patchSettings(patch: WebAlertSettingsPatch, by: number): Promise<WebAlertsAdminResponse> {
    await this.store.updateSettings(patch, by);
    return this.page();
  }
}

/** exchangeInfo, cached: an admin adding coins makes one call per 10 minutes at most (weight 1). */
export function cachedExchangeInfo(fetchInfo: () => Promise<unknown>, ttlMs = 10 * 60_000, now: () => number = Date.now): () => Promise<unknown> {
  let cached: { at: number; body: unknown } | null = null;
  return async () => {
    if (cached && now() - cached.at < ttlMs) return cached.body;
    const body = await fetchInfo();
    cached = { at: now(), body };
    return body;
  };
}
