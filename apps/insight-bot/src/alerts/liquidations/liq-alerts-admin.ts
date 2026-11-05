import type { LiqParams, WebLiqAlertSettingsPatch, WebLiqAlertsAdminResponse, WebLiqCoin } from '@trade-automation/contracts';
import type { PgLiqAlertStore } from './pg/liq-alerts.repo';

/**
 * IB-122 (design §1 Settings, L4) — the «Ликвидации» section of `/admin/alerts`, over the store: one read
 * of the whole section, and one write answering with it again. A coin's setting is merged into `perCoin`
 * per coin, so one coin's edit carries no other coin's values. A coin must be on `alert_symbols` (the
 * shared list) to be set; a coin on the list with no entry has no threshold, so it is off (L4).
 */
export class LiqAlertsAdminNotListed extends Error {
  constructor(readonly symbols: string[]) {
    super(`not on the alert list: ${symbols.join(', ')}`);
  }
}

type Store = Pick<PgLiqAlertStore, 'settings' | 'allCoins' | 'journalPage' | 'updateSettings'>;

export class LiqAlertsAdmin {
  constructor(private readonly store: Store) {}

  async page(): Promise<WebLiqAlertsAdminResponse> {
    const [settings, coins, alerts] = await Promise.all([this.store.settings(), this.store.allCoins(), this.store.journalPage(50)]);
    return { settings, coins: coins.map((c) => coinView(c, settings.params)), alerts };
  }

  async patch(patch: WebLiqAlertSettingsPatch, by: number): Promise<WebLiqAlertsAdminResponse> {
    let params: LiqParams | undefined;
    if (patch.perCoin !== undefined) {
      const listed = new Set((await this.store.allCoins()).map((c) => c.symbol));
      const unknown = Object.keys(patch.perCoin).filter((s) => !listed.has(s));
      if (unknown.length > 0) throw new LiqAlertsAdminNotListed(unknown);
      const current = (await this.store.settings()).params;
      params = { perCoin: { ...current.perCoin, ...patch.perCoin } };
    }
    await this.store.updateSettings({ enabled: patch.enabled, membersVisible: patch.membersVisible, params }, by);
    return this.page();
  }
}

export function coinView(c: { symbol: string; base: string; enabled: boolean }, params: LiqParams): WebLiqCoin {
  const p = params.perCoin[c.symbol];
  return { symbol: c.symbol, base: c.base, listed: c.enabled, enabled: p?.enabled ?? false, thresholdUsd: p?.thresholdUsd ?? null };
}
