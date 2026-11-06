import {
  FUNDING_ALERT_TF, FundingParamsSchema, type FundingAlertEvent, type FundingParams, type FundingSide, type MarketAlertControlKind, type MarketAlertMutedBy, type MarketAlertSource,
  type WebFundingAlertRow,
} from '@trade-automation/contracts';
import type { Db, DbHandle } from '../../../db/db.port';
import { PgLiqAlertStore } from '../../liquidations/pg/liq-alerts.repo';
import type { FundingSideState } from '../funding-state';

/**
 * IB-124 (design §3, F4–F8) — the funding loop's reads and writes (SQL under `pg/`, IB-004), on IB-122's generic
 * tables plus `alert_funding_state` (migration 034). A check's state rows and the alerts they produced are written
 * in ONE transaction (`commit`), so a crash cannot leave an `enter` without its state, which would re-enter at the
 * next check under a new once-key, nor a state without its `enter`, which would lose the alert.
 */
export interface FundingSettings { enabled: boolean; membersVisible: boolean; params: FundingParams; updatedAt: number }

export interface NewFundingAlert {
  event: FundingAlertEvent;
  symbol: string;
  direction: 'bullish' | 'bearish';
  atMs: number;
  details: Record<string, unknown>;
  dedupeKey: string;
  /** IB-151: the switch that keeps it from being sent; absent = none (the journal gets it either way). */
  mutedBy?: MarketAlertMutedBy;
}

export interface NewFundingControl {
  kind: Extract<MarketAlertControlKind, 'random' | 'near_miss'>;
  symbol: string;
  direction: 'bullish' | 'bearish' | null;
  atMs: number;
  details: Record<string, unknown>;
  dedupeKey: string;
}

/** What one check writes for one coin, in one transaction. */
export interface FundingCommit {
  source: MarketAlertSource;
  build: string;
  params: FundingParams;
  confirmedAtMs: number;
  symbol: string;
  states: ReadonlyArray<{ side: FundingSide; state: FundingSideState }>;
  alerts: readonly NewFundingAlert[];
}

/** The port the loop is written against; `PgFundingAlertStore` below, an in-memory one in the specs. */
export interface FundingAlertStore {
  settings(): Promise<FundingSettings>;
  listedCoins(): Promise<Array<{ symbol: string; base: string }>>;
  /** Every state row of `source`, keyed `symbol|side`. */
  states(source: MarketAlertSource): Promise<Map<string, FundingSideState>>;
  /** The alerts' ids in order; null where the once-key already existed. */
  commit(x: FundingCommit): Promise<Array<number | null>>;
  insertControl(source: MarketAlertSource, build: string, params: FundingParams, x: NewFundingControl): Promise<number | null>;
  insertPaths(subject: { marketAlertId: number } | { marketControlId: number }, symbol: string, t0Sec: number): Promise<void>;
  recipients(): Promise<Array<{ chatId: number; lang: 'ru' | 'en' }>>;
  markFired(id: number, firedAtMs: number, recipients: number): Promise<void>;
}

export const stateKey = (symbol: string, side: FundingSide): string => `${symbol}|${side}`;

const ms = (d: Date | string): number => new Date(d).getTime();
const msOrNull = (d: Date | null): number | null => (d === null ? null : ms(d));
const dateOrNull = (v: number | null): Date | null => (v === null ? null : new Date(v));

interface StateRow {
  symbol: string; side: FundingSide; zone: 'normal' | 'extreme'; since: Date; out_checks: number; out_since: Date | null;
  episode_start: Date | null; episode_end: Date | null; opp_checks: number; opp_since: Date | null; flip_sent: boolean; last_check_at: Date;
}

export class PgFundingAlertStore implements FundingAlertStore {
  /** The type-agnostic writes (paths by subject id, the fired stamp) are IB-122's, reused as they are. */
  private readonly generic: PgLiqAlertStore;

  constructor(private readonly db: Db) {
    this.generic = new PgLiqAlertStore(db);
  }

  async settings(): Promise<FundingSettings> {
    const [r] = await this.db.query<{ enabled: boolean; members_visible: boolean; params: unknown; updated_at: Date }>(
      `select enabled, members_visible, params, updated_at from alert_type_settings where type = 'funding'`,
    );
    if (!r) throw new Error(`alert_type_settings has no 'funding' row (migration 034 seeds it)`);
    return { enabled: r.enabled, membersVisible: r.members_visible, params: FundingParamsSchema.parse(r.params), updatedAt: Math.floor(ms(r.updated_at) / 1000) };
  }

  async listedCoins(): Promise<Array<{ symbol: string; base: string }>> {
    return this.db.query<{ symbol: string; base: string }>('select symbol, base from alert_symbols where enabled order by symbol');
  }

  async states(source: MarketAlertSource): Promise<Map<string, FundingSideState>> {
    const rows = await this.db.query<StateRow>(
      `select symbol, side, zone, since, out_checks, out_since, episode_start, episode_end, opp_checks, opp_since, flip_sent, last_check_at
         from alert_funding_state where source = $1`,
      [source],
    );
    return new Map(rows.map((r) => [stateKey(r.symbol, r.side), {
      zone: r.zone, since: ms(r.since), outChecks: r.out_checks, outSince: msOrNull(r.out_since),
      episodeStart: msOrNull(r.episode_start), episodeEnd: msOrNull(r.episode_end), oppChecks: r.opp_checks, oppSince: msOrNull(r.opp_since),
      flipSent: r.flip_sent, lastCheckAt: ms(r.last_check_at),
    }]));
  }

  async commit(x: FundingCommit): Promise<Array<number | null>> {
    return this.db.transaction(async (tx) => {
      const ids: Array<number | null> = [];
      for (const a of x.alerts) ids.push(await insertAlert(tx, x, a));
      for (const { side, state: s } of x.states) {
        await tx.query(
          `insert into alert_funding_state
             (source, symbol, side, zone, since, out_checks, out_since, episode_start, episode_end, opp_checks, opp_since, flip_sent, last_check_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           on conflict (source, symbol, side) do update set
             zone = excluded.zone, since = excluded.since, out_checks = excluded.out_checks, out_since = excluded.out_since,
             episode_start = excluded.episode_start, episode_end = excluded.episode_end, opp_checks = excluded.opp_checks,
             opp_since = excluded.opp_since, flip_sent = excluded.flip_sent, last_check_at = excluded.last_check_at, updated_at = now()`,
          [x.source, x.symbol, side, s.zone, new Date(s.since), s.outChecks, dateOrNull(s.outSince), dateOrNull(s.episodeStart),
            dateOrNull(s.episodeEnd), s.oppChecks, dateOrNull(s.oppSince), s.flipSent, new Date(s.lastCheckAt)],
        );
      }
      return ids;
    });
  }

  async insertControl(source: MarketAlertSource, build: string, params: FundingParams, x: NewFundingControl): Promise<number | null> {
    const rows = await this.db.query<{ id: string }>(
      `insert into market_alert_controls (type, kind, symbol, at, direction, details, params, source, build, dedupe_key)
       values ('funding', $1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (source, type, dedupe_key) do nothing returning id`,
      [x.kind, x.symbol, new Date(x.atMs), x.direction, JSON.stringify(x.details), JSON.stringify(params), source, build, x.dedupeKey],
    );
    return rows[0] ? Number(rows[0].id) : null;
  }

  insertPaths(subject: { marketAlertId: number } | { marketControlId: number }, symbol: string, t0Sec: number): Promise<void> {
    return this.generic.insertPaths(subject, symbol, t0Sec);
  }

  async recipients(): Promise<Array<{ chatId: number; lang: 'ru' | 'en' }>> {
    const rows = await this.db.query<{ chat_id: string; lang: 'ru' | 'en' }>(
      'select chat_id, lang from users where funding_alerts and not disabled and chat_id is not null order by id',
    );
    return rows.map((r) => ({ chatId: Number(r.chat_id), lang: r.lang }));
  }

  markFired(id: number, firedAtMs: number, recipients: number): Promise<void> {
    return this.generic.markFired(id, firedAtMs, recipients);
  }

  // ------------------------------------------------------------------ the admin page

  async journalPage(limit = 50): Promise<WebFundingAlertRow[]> {
    const rows = await this.db.query<{
      id: string; source: MarketAlertSource; event: FundingAlertEvent; symbol: string; at: Date; details: Record<string, unknown>;
      fired_at: Date | null; late: boolean; recipients: number; muted_by: MarketAlertMutedBy | null;
    }>(`select id, source, event, symbol, at, details, fired_at, late, recipients, muted_by from market_alerts where type = 'funding' order by at desc, id desc limit $1`, [limit]);
    return rows.map((r) => ({
      id: Number(r.id), source: r.source, event: r.event, symbol: r.symbol, side: r.details.side as FundingSide, at: Math.floor(ms(r.at) / 1000),
      rate: Number(r.details.rate), intervalH: r.details.intervalH === null ? null : Number(r.details.intervalH), ratePer8h: Number(r.details.ratePer8h),
      episodeHours: r.event === 'flip' ? Number(r.details.episodeHours) : null,
      firedAt: r.fired_at ? Math.floor(ms(r.fired_at) / 1000) : null, late: r.late, recipients: r.recipients, mutedBy: r.muted_by,
    }));
  }

  async allCoins(): Promise<Array<{ symbol: string; base: string; enabled: boolean }>> {
    return this.db.query<{ symbol: string; base: string; enabled: boolean }>('select symbol, base, enabled from alert_symbols order by symbol');
  }

  async updateSettings(patch: { enabled?: boolean; membersVisible?: boolean; params?: FundingParams }, by: number): Promise<void> {
    await this.db.query(
      `update alert_type_settings set enabled = coalesce($1, enabled), members_visible = coalesce($2, members_visible),
              params = coalesce($3::jsonb, params), updated_by = $4, updated_at = now() where type = 'funding'`,
      [patch.enabled ?? null, patch.membersVisible ?? null, patch.params === undefined ? null : JSON.stringify(patch.params), by],
    );
  }
}

async function insertAlert(tx: DbHandle, x: FundingCommit, a: NewFundingAlert): Promise<number | null> {
  const rows = await tx.query<{ id: string }>(
    `insert into market_alerts (type, event, symbol, direction, at, tf, details, params, source, build, confirmed_at, late, dedupe_key, muted_by)
     values ('funding', $1, $2, $3, $4, $11, $5, $6, $7, $8, $9, false, $10, $12)
     on conflict (source, type, dedupe_key) do nothing returning id`,
    [a.event, a.symbol, a.direction, new Date(a.atMs), JSON.stringify(a.details), JSON.stringify(x.params), x.source, x.build, new Date(x.confirmedAtMs), a.dedupeKey, FUNDING_ALERT_TF,
      a.mutedBy ?? null],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/** §1 Recipients: whether members see the funding-alerts toggle (`/me/settings`). */
export class PgFundingAlertsVisibility {
  constructor(private readonly db: DbHandle) {}

  async membersVisible(): Promise<boolean> {
    const rows = await this.db.query<{ members_visible: boolean }>(`select members_visible from alert_type_settings where type = 'funding'`);
    return rows[0]?.members_visible ?? false;
  }
}
