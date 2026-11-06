import {
  LEVEL_ALERT_TF, LevelParamsSchema, type LevelEvent, type LevelKind, type LevelParams, type MarketAlertControlKind, type MarketAlertMutedBy, type MarketAlertSource,
  type WebLevelAlertRow,
} from '@trade-automation/contracts';
import type { Db, DbHandle } from '../../../db/db.port';
import { PgLiqAlertStore } from '../../liquidations/pg/liq-alerts.repo';
import type { LevelState } from '../level-step';

/**
 * IB-126 (design §4, P3–P7, P10) — the level loop's reads and writes (SQL under `pg/`, IB-004), on IB-122's generic
 * tables plus `alert_level_state` (migration 035). A bar's state rows and the alerts they produced are written in ONE
 * transaction (`commit`): a crash cannot leave a breakout journalled without the state that saw it, which would let the
 * next bar step from the old side, nor a state without its alert, which would lose the alert. Writing a period's row
 * deletes the same level's rows of earlier periods (P10 «old periods are deleted on rollover»).
 */
export interface LevelSettings { enabled: boolean; membersVisible: boolean; params: LevelParams; updatedAt: number }

export interface NewLevelAlert {
  event: LevelEvent;
  symbol: string;
  direction: 'bullish' | 'bearish';
  /** The bar's open (the link's `at`). */
  atMs: number;
  late: boolean;
  details: Record<string, unknown>;
  dedupeKey: string;
  /** IB-151: the switch that keeps it from being sent; absent = none (the journal gets it either way). */
  mutedBy?: MarketAlertMutedBy;
}

export interface NewLevelControl {
  kind: Extract<MarketAlertControlKind, 'touch' | 'random'>;
  symbol: string;
  atMs: number;
  details: Record<string, unknown>;
  dedupeKey: string;
}

/** One P10 row as the loop holds it. */
export interface LevelStateRow { kind: LevelKind; periodStartMs: number; price: number; state: LevelState }

export interface LevelCommit {
  source: MarketAlertSource;
  build: string;
  params: LevelParams;
  confirmedAtMs: number;
  symbol: string;
  states: readonly LevelStateRow[];
  alerts: readonly NewLevelAlert[];
}

/** The port the loop is written against; `PgLevelAlertStore` below, an in-memory one in the specs. */
export interface LevelAlertStore {
  settings(): Promise<LevelSettings>;
  listedCoins(): Promise<Array<{ symbol: string; base: string }>>;
  /** Every state row of `source`, keyed by `stateKey`. */
  states(source: MarketAlertSource): Promise<Map<string, LevelStateRow & { symbol: string }>>;
  /** The alerts' ids in order; null where the once-key already existed. */
  commit(x: LevelCommit): Promise<Array<number | null>>;
  insertControl(source: MarketAlertSource, build: string, params: LevelParams, x: NewLevelControl): Promise<number | null>;
  insertPaths(subject: { marketAlertId: number } | { marketControlId: number }, symbol: string, t0Sec: number): Promise<void>;
  recipients(): Promise<Array<{ chatId: number; lang: 'ru' | 'en' }>>;
  markFired(id: number, firedAtMs: number, recipients: number): Promise<void>;
}

export const stateKey = (symbol: string, kind: LevelKind, periodStartMs: number): string => `${symbol}|${kind}|${periodStartMs}`;

const ms = (d: Date | string): number => new Date(d).getTime();
const dateOrNull = (v: number | null): Date | null => (v === null ? null : new Date(v));

interface StateRowDb {
  symbol: string; kind: LevelKind; period_start: Date; price: number; last_side: 'above' | 'below' | null; first_beyond_at: Date | null; last_bar_at: Date;
}

export class PgLevelAlertStore implements LevelAlertStore {
  /** The type-agnostic writes (paths by subject id, the fired stamp) are IB-122's, reused as they are. */
  private readonly generic: PgLiqAlertStore;

  constructor(private readonly db: Db) {
    this.generic = new PgLiqAlertStore(db);
  }

  async settings(): Promise<LevelSettings> {
    const [r] = await this.db.query<{ enabled: boolean; members_visible: boolean; params: unknown; updated_at: Date }>(
      `select enabled, members_visible, params, updated_at from alert_type_settings where type = 'level'`,
    );
    if (!r) throw new Error(`alert_type_settings has no 'level' row (migration 035 seeds it)`);
    return { enabled: r.enabled, membersVisible: r.members_visible, params: LevelParamsSchema.parse(r.params), updatedAt: Math.floor(ms(r.updated_at) / 1000) };
  }

  async listedCoins(): Promise<Array<{ symbol: string; base: string }>> {
    return this.db.query<{ symbol: string; base: string }>('select symbol, base from alert_symbols where enabled order by symbol');
  }

  async states(source: MarketAlertSource): Promise<Map<string, LevelStateRow & { symbol: string }>> {
    const rows = await this.db.query<StateRowDb>(
      'select symbol, kind, period_start, price, last_side, first_beyond_at, last_bar_at from alert_level_state where source = $1',
      [source],
    );
    return new Map(rows.map((r) => {
      const periodStartMs = ms(r.period_start);
      return [stateKey(r.symbol, r.kind, periodStartMs), {
        symbol: r.symbol, kind: r.kind, periodStartMs, price: Number(r.price),
        state: { lastSide: r.last_side, firstBeyondAtMs: r.first_beyond_at ? ms(r.first_beyond_at) : null, lastBarMs: ms(r.last_bar_at) },
      }];
    }));
  }

  async commit(x: LevelCommit): Promise<Array<number | null>> {
    return this.db.transaction(async (tx) => {
      const ids: Array<number | null> = [];
      for (const a of x.alerts) ids.push(await insertAlert(tx, x, a));
      for (const r of x.states) {
        await tx.query(
          `insert into alert_level_state (source, symbol, kind, period_start, price, last_side, first_beyond_at, last_bar_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (source, symbol, kind, period_start) do update set
             price = excluded.price, last_side = excluded.last_side, first_beyond_at = excluded.first_beyond_at,
             last_bar_at = excluded.last_bar_at, updated_at = now()`,
          [x.source, x.symbol, r.kind, new Date(r.periodStartMs), r.price, r.state.lastSide, dateOrNull(r.state.firstBeyondAtMs), new Date(r.state.lastBarMs)],
        );
        await tx.query(
          'delete from alert_level_state where source = $1 and symbol = $2 and kind = $3 and period_start < $4',
          [x.source, x.symbol, r.kind, new Date(r.periodStartMs)],
        );
      }
      return ids;
    });
  }

  async insertControl(source: MarketAlertSource, build: string, params: LevelParams, x: NewLevelControl): Promise<number | null> {
    const rows = await this.db.query<{ id: string }>(
      `insert into market_alert_controls (type, kind, symbol, at, direction, details, params, source, build, dedupe_key)
       values ('level', $1, $2, $3, null, $4, $5, $6, $7, $8)
       on conflict (source, type, dedupe_key) do nothing returning id`,
      [x.kind, x.symbol, new Date(x.atMs), JSON.stringify(x.details), JSON.stringify(params), source, build, x.dedupeKey],
    );
    return rows[0] ? Number(rows[0].id) : null;
  }

  insertPaths(subject: { marketAlertId: number } | { marketControlId: number }, symbol: string, t0Sec: number): Promise<void> {
    return this.generic.insertPaths(subject, symbol, t0Sec);
  }

  async recipients(): Promise<Array<{ chatId: number; lang: 'ru' | 'en' }>> {
    const rows = await this.db.query<{ chat_id: string; lang: 'ru' | 'en' }>(
      'select chat_id, lang from users where level_alerts and not disabled and chat_id is not null order by id',
    );
    return rows.map((r) => ({ chatId: Number(r.chat_id), lang: r.lang }));
  }

  markFired(id: number, firedAtMs: number, recipients: number): Promise<void> {
    return this.generic.markFired(id, firedAtMs, recipients);
  }

  // ------------------------------------------------------------------ the admin page

  async journalPage(limit = 50): Promise<WebLevelAlertRow[]> {
    const rows = await this.db.query<{
      id: string; source: MarketAlertSource; event: LevelEvent; symbol: string; at: Date; details: Record<string, unknown>;
      fired_at: Date | null; late: boolean; recipients: number; muted_by: MarketAlertMutedBy | null;
    }>(`select id, source, event, symbol, at, details, fired_at, late, recipients, muted_by from market_alerts where type = 'level' order by at desc, id desc limit $1`, [limit]);
    return rows.map((r) => ({
      id: Number(r.id), source: r.source, event: r.event, symbol: r.symbol, price: Number(r.details.price),
      // IB-128: a custom level's row names its level
      kind: r.details.kind as LevelKind | 'custom', customLevelId: r.details.kind === 'custom' ? Number(r.details.levelId) : null,
      at: Math.floor(ms(r.at) / 1000), close: Number((r.details.bar as { close: number }).close),
      firedAt: r.fired_at ? Math.floor(ms(r.fired_at) / 1000) : null, late: r.late, recipients: r.recipients, mutedBy: r.muted_by,
    }));
  }

  async allCoins(): Promise<Array<{ symbol: string; base: string; enabled: boolean }>> {
    return this.db.query<{ symbol: string; base: string; enabled: boolean }>('select symbol, base, enabled from alert_symbols order by symbol');
  }

  /** P10 rows per coin (live), for the admin page's «waiting for its seed». */
  async stateCounts(): Promise<Map<string, number>> {
    const rows = await this.db.query<{ symbol: string; n: string }>(`select symbol, count(*) as n from alert_level_state where source = 'live' group by symbol`);
    return new Map(rows.map((r) => [r.symbol, Number(r.n)]));
  }

  async updateSettings(patch: { enabled?: boolean; membersVisible?: boolean; params?: LevelParams }, by: number): Promise<void> {
    await this.db.query(
      `update alert_type_settings set enabled = coalesce($1, enabled), members_visible = coalesce($2, members_visible),
              params = coalesce($3::jsonb, params), updated_by = $4, updated_at = now() where type = 'level'`,
      [patch.enabled ?? null, patch.membersVisible ?? null, patch.params === undefined ? null : JSON.stringify(patch.params), by],
    );
  }
}

async function insertAlert(tx: DbHandle, x: LevelCommit, a: NewLevelAlert): Promise<number | null> {
  const rows = await tx.query<{ id: string }>(
    `insert into market_alerts (type, event, symbol, direction, at, tf, details, params, source, build, confirmed_at, late, dedupe_key, muted_by)
     values ('level', $1, $2, $3, $4, $12, $5, $6, $7, $8, $9, $10, $11, $13)
     on conflict (source, type, dedupe_key) do nothing returning id`,
    [a.event, a.symbol, a.direction, new Date(a.atMs), JSON.stringify(a.details), JSON.stringify(x.params), x.source, x.build,
      new Date(x.confirmedAtMs), a.late && x.source === 'live', a.dedupeKey, LEVEL_ALERT_TF, a.mutedBy ?? null],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/** §1 Recipients: whether members see the level-alerts toggle (`/me/settings`). */
export class PgLevelAlertsVisibility {
  constructor(private readonly db: DbHandle) {}

  async membersVisible(): Promise<boolean> {
    const rows = await this.db.query<{ members_visible: boolean }>(`select members_visible from alert_type_settings where type = 'level'`);
    return rows[0]?.members_visible ?? false;
  }
}
