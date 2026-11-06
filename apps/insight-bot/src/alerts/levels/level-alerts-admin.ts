import {
  LEVEL_KINDS, levelEventOn, levelKindEvents, type LevelEvent, type LevelKind, type LevelParams, type WebLevelAlertSettingsPatch,
  type WebLevelAlertsAdminResponse, type WebLevelCoin,
} from '@trade-automation/contracts';
import type { PgLevelAlertStore } from './pg/level-alerts.repo';

/**
 * IB-126 (design §1 Settings, P2) — the «Levels» section of `/admin/alerts`, over the store: one read of the whole
 * section, and one write answering with it again. Coins and event switches are merged into params per coin and per
 * (kind, event). An event switched back ON is removed from params rather than stored as `true`, so params only ever
 * hold the exceptions and a default stays a default. A coin must be on `alert_symbols` to be set.
 */
export class LevelAlertsAdminNotListed extends Error {
  constructor(readonly symbols: string[]) {
    super(`not on the alert list: ${symbols.join(', ')}`);
  }
}

type Store = Pick<PgLevelAlertStore, 'settings' | 'allCoins' | 'journalPage' | 'updateSettings' | 'stateCounts'>;

export class LevelAlertsAdmin {
  constructor(private readonly store: Store) {}

  async page(): Promise<WebLevelAlertsAdminResponse> {
    const [settings, coins, alerts, counts] = await Promise.all([this.store.settings(), this.store.allCoins(), this.store.journalPage(50), this.store.stateCounts()]);
    return {
      settings, events: effectiveEvents(settings.params), alerts,
      coins: coins.map((c) => levelCoinView(c, settings.params, counts.get(c.symbol) ?? 0)),
    };
  }

  async patch(patch: WebLevelAlertSettingsPatch, by: number): Promise<WebLevelAlertsAdminResponse> {
    let params: LevelParams | undefined;
    if (patch.perCoin !== undefined || patch.events !== undefined || patch.touchBand !== undefined) {
      if (patch.perCoin !== undefined) {
        const listed = new Set((await this.store.allCoins()).map((c) => c.symbol));
        const unknown = Object.keys(patch.perCoin).filter((s) => !listed.has(s));
        if (unknown.length > 0) throw new LevelAlertsAdminNotListed(unknown);
      }
      const current = (await this.store.settings()).params;
      params = { touchBand: patch.touchBand ?? current.touchBand, events: mergeEvents(current.events, patch.events ?? {}), perCoin: { ...current.perCoin, ...(patch.perCoin ?? {}) } };
    }
    await this.store.updateSettings({ enabled: patch.enabled, membersVisible: patch.membersVisible, params }, by);
    return this.page();
  }
}

/** Every kind × every event that applies to it, on or off. */
export function effectiveEvents(params: Pick<LevelParams, 'events'>): Record<LevelKind, Partial<Record<LevelEvent, boolean>>> {
  const out = {} as Record<LevelKind, Partial<Record<LevelEvent, boolean>>>;
  for (const kind of LEVEL_KINDS) out[kind] = Object.fromEntries(levelKindEvents(kind).map((e) => [e, levelEventOn(params, kind, e)]));
  return out;
}

/** Applies a patch of switches: `false` is stored, `true` removes the exception; empty kinds are dropped. */
export function mergeEvents(current: LevelParams['events'], patch: LevelParams['events']): LevelParams['events'] {
  const out: LevelParams['events'] = {};
  for (const kind of LEVEL_KINDS) {
    const merged: Partial<Record<LevelEvent, boolean>> = { ...(current[kind] ?? {}) };
    for (const [event, on] of Object.entries(patch[kind] ?? {}) as Array<[LevelEvent, boolean]>) {
      if (on) delete merged[event];
      else merged[event] = false;
    }
    if (Object.keys(merged).length > 0) out[kind] = merged;
  }
  return out;
}

export function levelCoinView(c: { symbol: string; base: string; enabled: boolean }, params: LevelParams, stateRows: number): WebLevelCoin {
  const p = params.perCoin[c.symbol];
  return { symbol: c.symbol, base: c.base, listed: c.enabled, enabled: p?.enabled ?? true, daily: p?.daily ?? false, stateRows };
}
