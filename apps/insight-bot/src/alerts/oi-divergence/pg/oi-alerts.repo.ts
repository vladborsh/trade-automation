import {
  OiDivergenceJournalParamsSchema, OiDivergenceParamsSchema, type OiDivergenceDirection, type OiDivergenceParams, type OiDivergenceTf, type WebAlertSettings,
  type WebAlertSymbol, type WebOiDivergenceAlert, type WebOiDivergenceSkipRow,
  OI_RESEARCH_WINDOWS, OI_RESEARCH_WINDOW_SEC, type OiControlKind, type OiJournalSource, type OiNearMissRule, type OiNearMissUnit, type OiResearchWindow,
} from '@trade-automation/contracts';
import type { Db, DbHandle } from '../../../db/db.port';
import { PATH_SETTLE_SEC, type PathMeasurement } from '../research/path';
import type { Lang } from '../../../users/user.model';

/**
 * IB-112 — what the OI divergence alert loop and its admin page read and write (migration 025's
 * tables, IB-109). A port, so the loop is specced with an in-memory store; this is the Postgres side.
 * Times cross this boundary as unix SECONDS (the contracts' convention), as timestamptz inside.
 *
 * **IB-116 (design V30, V32): every journal, control and near-miss row says who wrote it, `live` or
 * `backfill`, and every write passes it explicitly (the column has no default since 028).**
 *
 * >>> READ THIS BEFORE ADDING A STATISTICS QUERY HERE (V32, guard at the point of temptation) <<<
 * Backfilled rows are IN-SAMPLE: round 2's params were tuned on exactly the month they cover (IB-111,
 * IB-114), so they fit by construction and would flatter any rate. A hit rate, a count of «worked», a
 * comparison with the controls — anything aggregated over these tables — groups by `source` and
 * reports `live` and `backfill` SEPARATELY. Never pool them; never filter only one silently either:
 * say which population a number is about (§6's open item decides "worked" and the baseline first).
 */
export interface OiAlertRecipient {
  userId: number;
  chatId: number;
  lang: Lang;
}

/** One journal row to write (V12). */
export interface NewOiAlert {
  /** V30: `live` (the loop) or `backfill` (IB-116's one-off run). No default in the database. */
  source: OiJournalSource;
  symbol: string;
  tf: OiDivergenceTf;
  direction: OiDivergenceDirection;
  a: { time: number; price: number; oiTime: number; oi: number };
  b: { time: number; price: number; oiTime: number; oi: number };
  runOf: number | null;
  runLength: number;
  params: OiDivergenceParams;
  confirmedAt: number;
  late: boolean;
  /** V27: the image's commit (12 hex) or 'dev'. NOT NULL with no default since 027: never omitted. */
  build: string;
}

/** IB-115 (V25): one control row. */
export interface NewOiControl {
  source: OiJournalSource;
  symbol: string;
  tf: OiDivergenceTf;
  kind: OiControlKind;
  direction: OiDivergenceDirection | null;
  barTime: number;
  stopPrice: number | null;
  params: OiDivergenceParams;
  build: string;
}

/** IB-115 (V26): one near-miss row. */
export interface NewOiNearMiss {
  source: OiJournalSource;
  symbol: string;
  tf: OiDivergenceTf;
  direction: OiDivergenceDirection;
  a: { time: number; price: number; oiTime: number; oi: number };
  b: { time: number; price: number; oiTime: number; oi: number };
  rule: OiNearMissRule;
  miss: number;
  unit: OiNearMissUnit;
  params: OiDivergenceParams;
  confirmedAt: number;
  build: string;
}

/** IB-115 (V24): what a subject's paths measure — written with the subject, measured once each window closes. */
export type PathSubjectRef = { alertId: number } | { controlId: number } | { nearMissId: number };
export interface NewPaths {
  symbol: string;
  direction: OiDivergenceDirection | null;
  t0: number;
  atr14: number;
  stopPrice: number | null;
}
/** IB-123: which subjects a `pathsDue` read takes (see the port). */
export type PathSubjects = 'all' | 'oi' | 'market';

export interface PathDue {
  id: number;
  symbol: string;
  win: OiResearchWindow;
  direction: OiDivergenceDirection | null;
  t0: number;
  atr14: number;
  stopPrice: number | null;
}

export interface NewOiSkip {
  symbol: string;
  tf: OiDivergenceTf;
  barTime: number;
  holeFrom: number;
  holeTo: number;
  at: number;
}

export interface OutcomeDue {
  id: number;
  symbol: string;
  firedAt: number;
  price4h: number | null;
  price24h: number | null;
}

export interface OiAlertStore {
  settings(): Promise<WebAlertSettings>;
  /** The coins the loop evaluates: enabled rows of `alert_symbols`, re-read every tick (no deploy to change). */
  enabledSymbols(): Promise<string[]>;
  /** Writes the row; null when (source, symbol, tf, direction, a_time, b_time) is already journalled (V8, V30). */
  insertAlert(row: NewOiAlert): Promise<number | null>;
  /** The journal row of a run's first line (V8: `run_of`), by its B time — among rows of the same source (V31). */
  runFirstId(source: OiJournalSource, symbol: string, tf: OiDivergenceTf, direction: OiDivergenceDirection, bTime: number): Promise<number | null>;
  markFired(id: number, firedAt: number, recipients: number, priceAtFire: number | null): Promise<void>;
  /** False when that (symbol, tf, bar) skip is already logged. */
  insertSkip(row: NewOiSkip): Promise<boolean>;
  /** V13: `oi_alerts`, not disabled, chat known. */
  recipients(): Promise<OiAlertRecipient[]>;
  /** Sent alerts whose +4 h or +24 h close is due and missing. */
  outcomesDue(nowSec: number): Promise<OutcomeDue[]>;
  setOutcome(id: number, field: 'price_4h' | 'price_24h', price: number, completeAt: number | null): Promise<void>;
  /** IB-115: whether the journal holds an alert with this B (any A) — «whose evaluation produced no alert»; per source (V31). */
  hasAlert(source: OiJournalSource, symbol: string, tf: OiDivergenceTf, direction: OiDivergenceDirection, bTime: number): Promise<boolean>;
  /** Null when that control is already recorded (a re-evaluation or a restart). */
  insertControl(row: NewOiControl): Promise<number | null>;
  /** Null when B already has its near-miss. */
  insertNearMiss(row: NewOiNearMiss): Promise<number | null>;
  /** One row per window (4h / 24h / 72h); an existing one is kept. */
  insertPaths(subject: PathSubjectRef, spec: NewPaths): Promise<void>;
  /**
   * Unmeasured paths whose window closed by `nowSec`; a failed one waits `retryAfterSec` before it is tried again.
   * Only paths of `source` subjects (V31): the live loop never measures the backfill's backlog, the backfill run
   * measures its own.
   */
  /**
   * `subjects` (IB-123): which subjects' windows — `all` (the live tick: one queue, one measurer), `oi` (the OI
   * divergence journal, controls and near-misses: IB-116's history run) or `market` (market_alerts and their
   * controls: IB-123's). Each history run measures only its own backlog, so its weight and its check's bands
   * are its own.
   */
  pathsDue(source: OiJournalSource, nowSec: number, limit: number, retryAfterSec: number, subjects?: PathSubjects): Promise<PathDue[]>;
  setPath(id: number, m: PathMeasurement, measuredAt: number): Promise<void>;
  pathFailed(id: number, at: number): Promise<void>;
}

const sec = (d: Date | string | null): number | null => (d === null ? null : Math.floor(new Date(d).getTime() / 1000));
const at = (s: number): Date => new Date(s * 1000);
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

interface AlertRow {
  id: string; source: OiJournalSource; symbol: string; tf: OiDivergenceTf; direction: OiDivergenceDirection;
  a_time: Date; a_price: string; a_oi_time: Date; a_oi: string; b_time: Date; b_price: string; b_oi_time: Date; b_oi: string;
  run_of: string | null; run_length: number; params: unknown; confirmed_at: Date; fired_at: Date | null; late: boolean; recipients: number;
  price_at_fire: string | null; price_4h: string | null; price_24h: string | null; outcome_at: Date | null;
}

export const toWebAlert = (r: AlertRow): WebOiDivergenceAlert => ({
  id: Number(r.id), source: r.source, symbol: r.symbol, tf: r.tf, direction: r.direction,
  a: { time: sec(r.a_time) as number, price: Number(r.a_price), oiTime: sec(r.a_oi_time) as number, oi: Number(r.a_oi) },
  b: { time: sec(r.b_time) as number, price: Number(r.b_price), oiTime: sec(r.b_oi_time) as number, oi: Number(r.b_oi) },
  runOf: r.run_of === null ? null : Number(r.run_of), runLength: r.run_length,
  params: OiDivergenceJournalParamsSchema.parse(r.params), // V20: a row from before 026 has tolerance 0
  confirmedAt: sec(r.confirmed_at) as number, firedAt: sec(r.fired_at), late: r.late, recipients: r.recipients,
  priceAtFire: num(r.price_at_fire), price4h: num(r.price_4h), price24h: num(r.price_24h), outcomeAt: sec(r.outcome_at),
});

export class PgOiAlertStore implements OiAlertStore {
  constructor(private readonly db: DbHandle) {}

  async settings(): Promise<WebAlertSettings> {
    const [r] = await this.db.query<{ enabled: boolean; members_visible: boolean; params: unknown; updated_by: number | null; updated_at: Date }>(
      'select enabled, members_visible, params, updated_by, updated_at from alert_settings where id = 1',
    );
    if (!r) throw new Error('alert_settings has no row (migration 025 seeds it)');
    return { enabled: r.enabled, membersVisible: r.members_visible, params: OiDivergenceParamsSchema.parse(r.params), updatedBy: r.updated_by, updatedAt: sec(r.updated_at) as number };
  }

  async enabledSymbols(): Promise<string[]> {
    const rows = await this.db.query<{ symbol: string }>('select symbol from alert_symbols where enabled order by symbol');
    return rows.map((r) => r.symbol);
  }

  async insertAlert(x: NewOiAlert): Promise<number | null> {
    const rows = await this.db.query<{ id: string }>(
      `insert into oi_divergence_alerts
         (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, run_of, run_length, params, confirmed_at, late, build, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       on conflict on constraint oi_divergence_alerts_once do nothing returning id`,
      [x.symbol, x.tf, x.direction, at(x.a.time), x.a.price, at(x.a.oiTime), x.a.oi, at(x.b.time), x.b.price, at(x.b.oiTime), x.b.oi,
        x.runOf, x.runLength, JSON.stringify(x.params), at(x.confirmedAt), x.late, x.build, x.source],
    );
    return rows.length > 0 ? Number(rows[0].id) : null;
  }

  async runFirstId(source: OiJournalSource, symbol: string, tf: OiDivergenceTf, direction: OiDivergenceDirection, bTime: number): Promise<number | null> {
    const rows = await this.db.query<{ id: string }>(
      `select id from oi_divergence_alerts where source = $5 and symbol = $1 and tf = $2 and direction = $3 and b_time = $4 order by id limit 1`,
      [symbol, tf, direction, at(bTime), source],
    );
    return rows.length > 0 ? Number(rows[0].id) : null;
  }

  async markFired(id: number, firedAt: number, recipients: number, priceAtFire: number | null): Promise<void> {
    await this.db.query('update oi_divergence_alerts set fired_at = $2, recipients = $3, price_at_fire = $4 where id = $1', [id, at(firedAt), recipients, priceAtFire]);
  }

  async insertSkip(x: NewOiSkip): Promise<boolean> {
    const rows = await this.db.query(
      `insert into oi_divergence_skips (symbol, tf, bar_time, reason, hole_from, hole_to, at)
       values ($1, $2, $3, 'no_oi_data', $4, $5, $6) on conflict on constraint oi_divergence_skips_once do nothing returning id`,
      [x.symbol, x.tf, at(x.barTime), at(x.holeFrom), at(x.holeTo), at(x.at)],
    );
    return rows.length > 0;
  }

  async recipients(): Promise<OiAlertRecipient[]> {
    const rows = await this.db.query<{ id: number; chat_id: string; lang: Lang }>(
      'select id, chat_id, lang from users where oi_alerts and not disabled and chat_id is not null order by id',
    );
    return rows.map((r) => ({ userId: r.id, chatId: Number(r.chat_id), lang: r.lang }));
  }

  async outcomesDue(nowSec: number): Promise<OutcomeDue[]> {
    const rows = await this.db.query<{ id: string; symbol: string; fired_at: Date; price_4h: string | null; price_24h: string | null }>(
      `select id, symbol, fired_at, price_4h, price_24h from oi_divergence_alerts
        where fired_at is not null and outcome_at is null
          and ((price_4h is null and fired_at + interval '4 hours' <= $1) or (price_24h is null and fired_at + interval '24 hours' <= $1))
        order by fired_at limit 100`,
      [at(nowSec)],
    );
    return rows.map((r) => ({ id: Number(r.id), symbol: r.symbol, firedAt: sec(r.fired_at) as number, price4h: num(r.price_4h), price24h: num(r.price_24h) }));
  }

  async setOutcome(id: number, field: 'price_4h' | 'price_24h', price: number, completeAt: number | null): Promise<void> {
    const column = field === 'price_4h' ? 'price_4h' : 'price_24h';
    await this.db.query(`update oi_divergence_alerts set ${column} = $2, outcome_at = coalesce($3, outcome_at) where id = $1`, [id, price, completeAt === null ? null : at(completeAt)]);
  }

  // ------------------------------------------------------------------ the research journal (IB-115, V23–V27)

  async hasAlert(source: OiJournalSource, symbol: string, tf: OiDivergenceTf, direction: OiDivergenceDirection, bTime: number): Promise<boolean> {
    const rows = await this.db.query(
      'select 1 from oi_divergence_alerts where source = $5 and symbol = $1 and tf = $2 and direction = $3 and b_time = $4 limit 1',
      [symbol, tf, direction, at(bTime), source]);
    return rows.length > 0;
  }

  async insertControl(x: NewOiControl): Promise<number | null> {
    const rows = await this.db.query<{ id: string }>(
      `insert into oi_divergence_controls (symbol, tf, kind, direction, bar_time, stop_price, params, build, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict on constraint oi_divergence_controls_once do nothing returning id`,
      [x.symbol, x.tf, x.kind, x.direction, at(x.barTime), x.stopPrice, JSON.stringify(x.params), x.build, x.source],
    );
    return rows.length > 0 ? Number(rows[0].id) : null;
  }

  async insertNearMiss(x: NewOiNearMiss): Promise<number | null> {
    const rows = await this.db.query<{ id: string }>(
      `insert into oi_divergence_near_misses
         (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, rule, miss, unit, params, confirmed_at, build, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       on conflict on constraint oi_divergence_near_misses_once do nothing returning id`,
      [x.symbol, x.tf, x.direction, at(x.a.time), x.a.price, at(x.a.oiTime), x.a.oi, at(x.b.time), x.b.price, at(x.b.oiTime), x.b.oi,
        x.rule, x.miss, x.unit, JSON.stringify(x.params), at(x.confirmedAt), x.build, x.source],
    );
    return rows.length > 0 ? Number(rows[0].id) : null;
  }

  async insertPaths(subject: PathSubjectRef, x: NewPaths): Promise<void> {
    const [column, id] = 'alertId' in subject ? ['alert_id', subject.alertId] : 'controlId' in subject ? ['control_id', subject.controlId] : ['near_miss_id', subject.nearMissId];
    await this.db.query(
      `insert into oi_divergence_paths (${column}, win, symbol, direction, t0, atr14, stop_price)
       select $1, w, $3, $4, $5, $6, $7 from unnest($2::text[]) as w
       on conflict do nothing`,
      [id, [...OI_RESEARCH_WINDOWS], x.symbol, x.direction, at(x.t0), x.atr14, x.stopPrice],
    );
  }

  async pathsDue(source: OiJournalSource, nowSec: number, limit: number, retryAfterSec: number, subjects: PathSubjects = 'all'): Promise<PathDue[]> {
    // the subject's source: exactly one of the five ids is set (027's check, widened by 031 for the IB-122
    // market alerts and controls), so the coalesce picks it. One queue, one measurer: liquidation paths are
    // measured by this loop's tick, inside its PATHS_PER_TICK budget.
    const rows = await this.db.query<{ id: string; symbol: string; win: OiResearchWindow; direction: OiDivergenceDirection | null; t0: Date; atr14: string; stop_price: string | null }>(
      `select p.id, p.symbol, p.win, p.direction, p.t0, p.atr14, p.stop_price from oi_divergence_paths p
          left join oi_divergence_alerts a on a.id = p.alert_id
          left join oi_divergence_controls c on c.id = p.control_id
          left join oi_divergence_near_misses n on n.id = p.near_miss_id
          left join market_alerts ma on ma.id = p.market_alert_id
          left join market_alert_controls mc on mc.id = p.market_control_id
        where p.measured_at is null
          and coalesce(a.source, c.source, n.source, ma.source, mc.source) = $8
          and p.t0 + (case p.win when '4h' then $4::int when '24h' then $5::int else $6::int end) * interval '1 second' + $7 * interval '1 second' <= $1
          and (p.tried_at is null or p.tried_at + $3 * interval '1 second' <= $1)
          and ($9 = 'all' or ($9 = 'market') = (p.market_alert_id is not null or p.market_control_id is not null))
        order by p.tried_at nulls first, p.t0, p.id limit $2`,
      [at(nowSec), limit, retryAfterSec, OI_RESEARCH_WINDOW_SEC['4h'], OI_RESEARCH_WINDOW_SEC['24h'], OI_RESEARCH_WINDOW_SEC['72h'], PATH_SETTLE_SEC, source, subjects],
    );
    return rows.map((r) => ({
      id: Number(r.id), symbol: r.symbol, win: r.win, direction: r.direction, t0: sec(r.t0) as number,
      atr14: Number(r.atr14), stopPrice: num(r.stop_price),
    }));
  }

  async setPath(id: number, m: PathMeasurement, measuredAt: number): Promise<void> {
    const t = (v: number | null) => (v === null ? null : at(v));
    await this.db.query(
      `update oi_divergence_paths set measured_at = $2, bars = $3, entry_at = $4, entry_price = $5, high = $6, high_at = $7, low = $8, low_at = $9,
              stop_at = $10, fav_05_at = $11, fav_1_at = $12, fav_2_at = $13, order_ambiguous = $14 where id = $1 and measured_at is null`,
      [id, at(measuredAt), m.bars, t(m.entryAt), m.entryPrice, m.high, t(m.highAt), m.low, t(m.lowAt),
        t(m.stopAt), t(m.fav05At), t(m.fav1At), t(m.fav2At), m.orderAmbiguous],
    );
  }

  async pathFailed(id: number, nowSec: number): Promise<void> {
    await this.db.query('update oi_divergence_paths set tried_at = $2 where id = $1', [id, at(nowSec)]);
  }

  // ------------------------------------------------------------------ the admin page (V17)

  async symbols(): Promise<WebAlertSymbol[]> {
    const rows = await this.db.query<{ symbol: string; base: string; enabled: boolean; added_at: Date; added_by: number | null }>(
      'select symbol, base, enabled, added_at, added_by from alert_symbols order by symbol',
    );
    return rows.map((r) => ({ symbol: r.symbol, base: r.base, enabled: r.enabled, addedAt: sec(r.added_at) as number, addedBy: r.added_by }));
  }

  async recentAlerts(limit = 50): Promise<WebOiDivergenceAlert[]> {
    const rows = await this.db.query<AlertRow>('select * from oi_divergence_alerts order by confirmed_at desc, id desc limit $1', [limit]);
    return rows.map(toWebAlert);
  }

  /**
   * IB-113 (V16): the newest ON-TIME alert confirmed in the 24 h before `nowSec`, on a coin that is on
   * the list and enabled — what the «Главное сейчас» card shows. Late rows (never sent) are not news.
   * IB-116 (V33): LIVE rows only — a backfilled row is history, never a fresh signal, however recent.
   */
  async latestOnTime(nowSec: number): Promise<WebOiDivergenceAlert | null> {
    const rows = await this.db.query<AlertRow>(
      `select a.* from oi_divergence_alerts a join alert_symbols s on s.symbol = a.symbol and s.enabled
        where a.source = 'live' and not a.late and a.confirmed_at > $1::timestamptz - interval '24 hours' and a.confirmed_at <= $1::timestamptz
        order by a.confirmed_at desc, a.id desc limit 1`,
      [at(nowSec)],
    );
    return rows.length > 0 ? toWebAlert(rows[0] as AlertRow) : null;
  }

  async recentSkips(limit = 50): Promise<WebOiDivergenceSkipRow[]> {
    const rows = await this.db.query<{ symbol: string; tf: OiDivergenceTf; bar_time: Date; reason: 'no_oi_data'; hole_from: Date; hole_to: Date; at: Date }>(
      'select symbol, tf, bar_time, reason, hole_from, hole_to, at from oi_divergence_skips order by at desc, id desc limit $1', [limit],
    );
    return rows.map((r) => ({ symbol: r.symbol, tf: r.tf, barTime: sec(r.bar_time) as number, reason: r.reason, holeFrom: sec(r.hole_from) as number, holeTo: sec(r.hole_to) as number, at: sec(r.at) as number }));
  }

  /** False when the symbol is already on the list. */
  async addSymbol(symbol: string, base: string, addedBy: number): Promise<boolean> {
    const rows = await this.db.query('insert into alert_symbols (symbol, base, added_by) values ($1, $2, $3) on conflict (symbol) do nothing returning symbol', [symbol, base, addedBy]);
    return rows.length > 0;
  }

  /** False when there is no such symbol. */
  async setSymbolEnabled(symbol: string, enabled: boolean): Promise<boolean> {
    const rows = await this.db.query('update alert_symbols set enabled = $2 where symbol = $1 returning symbol', [symbol, enabled]);
    return rows.length > 0;
  }

  async removeSymbol(symbol: string): Promise<boolean> {
    const rows = await this.db.query('delete from alert_symbols where symbol = $1 returning symbol', [symbol]);
    return rows.length > 0;
  }

  async updateSettings(patch: { enabled?: boolean; membersVisible?: boolean; params?: OiDivergenceParams }, by: number): Promise<void> {
    await this.db.query(
      `update alert_settings set enabled = coalesce($1, enabled), members_visible = coalesce($2, members_visible),
              params = coalesce($3::jsonb, params), updated_by = $4, updated_at = now() where id = 1`,
      [patch.enabled ?? null, patch.membersVisible ?? null, patch.params === undefined ? null : JSON.stringify(patch.params), by],
    );
  }
}

/** IB-112 (V13): the one fact `/me/settings` and the bot need — whether members see the OI alerts toggle. */
export class PgOiAlertsVisibility {
  constructor(private readonly db: Db) {}

  async membersVisible(): Promise<boolean> {
    const rows = await this.db.query<{ members_visible: boolean }>('select members_visible from alert_settings where id = 1');
    return rows[0]?.members_visible ?? false;
  }
}
