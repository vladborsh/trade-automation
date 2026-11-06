import type { FundingParams, WebFundingAlertSettingsPatch, WebFundingAlertsAdminResponse, WebFundingCoin } from '@trade-automation/contracts';
import { FUNDING_FLOOR_PER_8H } from '../../insights/thresholds';
import type { PgFundingAlertStore } from './pg/funding-alerts.repo';

/**
 * IB-124 (design §1 Settings, F3, F5) — the «Funding» section of `/admin/alerts`, over the store: one read of the
 * whole section, and one write answering with it again. A coin's setting is merged into `perCoin` per coin. A coin's
 * floor `null` removes its override, so it uses the shared default again; the default itself is
 * `FUNDING_FLOOR_PER_8H`, sent as `defaultFloorPer8h` and never stored. A coin must be on `alert_symbols` to be set.
 */
export class FundingAlertsAdminNotListed extends Error {
  constructor(readonly symbols: string[]) {
    super(`not on the alert list: ${symbols.join(', ')}`);
  }
}

type Store = Pick<PgFundingAlertStore, 'settings' | 'allCoins' | 'journalPage' | 'updateSettings'>;

export class FundingAlertsAdmin {
  constructor(private readonly store: Store) {}

  async page(): Promise<WebFundingAlertsAdminResponse> {
    const [settings, coins, alerts] = await Promise.all([this.store.settings(), this.store.allCoins(), this.store.journalPage(50)]);
    return { settings, defaultFloorPer8h: FUNDING_FLOOR_PER_8H, coins: coins.map((c) => fundingCoinView(c, settings.params)), alerts };
  }

  async patch(patch: WebFundingAlertSettingsPatch, by: number): Promise<WebFundingAlertsAdminResponse> {
    let params: FundingParams | undefined;
    if (patch.perCoin !== undefined || patch.minEpisodeHours !== undefined || patch.flipWithinHours !== undefined) {
      if (patch.perCoin !== undefined) {
        const listed = new Set((await this.store.allCoins()).map((c) => c.symbol));
        const unknown = Object.keys(patch.perCoin).filter((s) => !listed.has(s));
        if (unknown.length > 0) throw new FundingAlertsAdminNotListed(unknown);
      }
      const current = (await this.store.settings()).params;
      const perCoin = { ...current.perCoin };
      for (const [symbol, c] of Object.entries(patch.perCoin ?? {})) {
        perCoin[symbol] = c.floorPer8h === null ? { enabled: c.enabled } : { enabled: c.enabled, floorPer8h: c.floorPer8h };
      }
      params = {
        minEpisodeHours: patch.minEpisodeHours ?? current.minEpisodeHours,
        flipWithinHours: patch.flipWithinHours ?? current.flipWithinHours,
        perCoin,
      };
    }
    await this.store.updateSettings({ enabled: patch.enabled, membersVisible: patch.membersVisible, params }, by);
    return this.page();
  }
}

export function fundingCoinView(c: { symbol: string; base: string; enabled: boolean }, params: FundingParams): WebFundingCoin {
  const p = params.perCoin[c.symbol];
  return { symbol: c.symbol, base: c.base, listed: c.enabled, enabled: p?.enabled ?? true, floorPer8h: p?.floorPer8h ?? null };
}
