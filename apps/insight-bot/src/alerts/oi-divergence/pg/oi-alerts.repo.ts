import {
  OiDivergenceParamsSchema, type OiDivergenceDirection, type OiDivergenceParams, type OiDivergenceTf, type WebAlertSettings,
  type WebAlertSymbol, type WebOiDivergenceAlert, type WebOiDivergenceSkipRow,
} from '@trade-automation/contracts';
import type { Db } from '../../../db/db.port';
import type { Lang } from '../../../users/user.model';

/**
 * IB-112 — what the OI divergence alert loop and its admin page read and write (migration 025's
 * tables, IB-109). A port, so the loop is specced with an in-memory store; this is the Postgres side.
 * Times cross this boundary as unix SECONDS (the contracts' convention), as timestamptz inside.
 */
export interface OiAlertRecipient {
  userId: number;
  chatId: number;
  lang: Lang;
}

/** One journal row to write (V12). */
export interface NewOiAlert {
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
  /** Writes the row; null when (symbol, tf, direction, a_time, b_time) is already journalled (V8). */
  insertAlert(row: NewOiAlert): Promise<number | null>;
  /** The journal row of a run's first line (V8: `run_of`), by its B time. */
  runFirstId(symbol: string, tf: OiDivergenceTf, direction: OiDivergenceDirection, bTime: number): Promise<number | null>;
  markFired(id: number, firedAt: number, recipients: number, priceAtFire: number | null): Promise<void>;
  /** False when that (symbol, tf, bar) skip is already logged. */
  insertSkip(row: NewOiSkip): Promise<boolean>;
  /** V13: `oi_alerts`, not disabled, chat known. */
  recipients(): Promise<OiAlertRecipient[]>;
  /** Sent alerts whose +4 h or +24 h close is due and missing. */
  outcomesDue(nowSec: number): Promise<OutcomeDue[]>;
  setOutcome(id: number, field: 'price_4h' | 'price_24h', price: number, completeAt: number | null): Promise<void>;
}

const sec = (d: Date | string | null): number | null => (d === null ? null : Math.floor(new Date(d).getTime() / 1000));
const at = (s: number): Date => new Date(s * 1000);
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

interface AlertRow {
  id: string; symbol: string; tf: OiDivergenceTf; direction: OiDivergenceDirection;
  a_time: Date; a_price: string; a_oi_time: Date; a_oi: string; b_time: Date; b_price: string; b_oi_time: Date; b_oi: string;
  run_of: string | null; run_length: number; params: unknown; confirmed_at: Date; fired_at: Date | null; late: boolean; recipients: number;
  price_at_fire: string | null; price_4h: string | null; price_24h: string | null; outcome_at: Date | null;
}

export const toWebAlert = (r: AlertRow): WebOiDivergenceAlert => ({
  id: Number(r.id), symbol: r.symbol, tf: r.tf, direction: r.direction,
  a: { time: sec(r.a_time) as number, price: Number(r.a_price), oiTime: sec(r.a_oi_time) as number, oi: Number(r.a_oi) },
  b: { time: sec(r.b_time) as number, price: Number(r.b_price), oiTime: sec(r.b_oi_time) as number, oi: Number(r.b_oi) },
  runOf: r.run_of === null ? null : Number(r.run_of), runLength: r.run_length,
  params: OiDivergenceParamsSchema.parse(r.params),
  confirmedAt: sec(r.confirmed_at) as number, firedAt: sec(r.fired_at), late: r.late, recipients: r.recipients,
  priceAtFire: num(r.price_at_fire), price4h: num(r.price_4h), price24h: num(r.price_24h), outcomeAt: sec(r.outcome_at),
});

export class PgOiAlertStore implements OiAlertStore {
  constructor(private readonly db: Db) {}

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
         (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, run_of, run_length, params, confirmed_at, late)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       on conflict on constraint oi_divergence_alerts_once do nothing returning id`,
      [x.symbol, x.tf, x.direction, at(x.a.time), x.a.price, at(x.a.oiTime), x.a.oi, at(x.b.time), x.b.price, at(x.b.oiTime), x.b.oi,
        x.runOf, x.runLength, JSON.stringify(x.params), at(x.confirmedAt), x.late],
    );
    return rows.length > 0 ? Number(rows[0].id) : null;
  }

  async runFirstId(symbol: string, tf: OiDivergenceTf, direction: OiDivergenceDirection, bTime: number): Promise<number | null> {
    const rows = await this.db.query<{ id: string }>(
      `select id from oi_divergence_alerts where symbol = $1 and tf = $2 and direction = $3 and b_time = $4 order by id limit 1`,
      [symbol, tf, direction, at(bTime)],
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
   */
  async latestOnTime(nowSec: number): Promise<WebOiDivergenceAlert | null> {
    const rows = await this.db.query<AlertRow>(
      `select a.* from oi_divergence_alerts a join alert_symbols s on s.symbol = a.symbol and s.enabled
        where not a.late and a.confirmed_at > $1::timestamptz - interval '24 hours' and a.confirmed_at <= $1::timestamptz
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
