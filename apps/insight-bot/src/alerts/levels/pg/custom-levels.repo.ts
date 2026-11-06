import { CUSTOM_LEVELS_PER_COIN_MAX, CustomLevelEventSwitchesSchema, type CustomLevelEventSwitches } from '@trade-automation/contracts';
import type { DbHandle } from '../../../db/db.port';

/**
 * IB-128 (design §4 P9) — `alert_custom_levels` (migration 036): the owner's levels, soft-deleted. SQL under `pg/`
 * (IB-004). The loop reads the active ones once per evaluating tick; admin and the bot add, switch and delete.
 */
export interface CustomLevel {
  id: number;
  symbol: string;
  price: number;
  note: string | null;
  events: CustomLevelEventSwitches;
  createdBy: number | null;
  /** Epoch ms. */
  createdAtMs: number;
}

export type CustomLevelAddResult = { ok: true; level: CustomLevel } | { ok: false; reason: 'not_listed' | 'too_many' };

interface Row {
  id: string; symbol: string; price: number; note: string | null; events: unknown; created_by: number | null; created_at: Date;
}

const COLUMNS = 'id, symbol, price, note, events, created_by, created_at';

const toLevel = (r: Row): CustomLevel => ({
  id: Number(r.id), symbol: r.symbol, price: Number(r.price), note: r.note,
  // a hand-edited row that breaks the contract keeps its level, with every event on
  events: CustomLevelEventSwitchesSchema.safeParse(r.events).data ?? {},
  createdBy: r.created_by, createdAtMs: new Date(r.created_at).getTime(),
});

export class PgCustomLevelStore {
  constructor(private readonly db: DbHandle) {}

  /** Every active level, by symbol then price. */
  async active(): Promise<CustomLevel[]> {
    const rows = await this.db.query<Row>(`select ${COLUMNS} from alert_custom_levels where deleted_at is null order by symbol, price, id`);
    return rows.map(toLevel);
  }

  /** One coin's active levels, by price. */
  async activeFor(symbol: string): Promise<CustomLevel[]> {
    const rows = await this.db.query<Row>(
      `select ${COLUMNS} from alert_custom_levels where deleted_at is null and symbol = $1 order by price, id`, [symbol],
    );
    return rows.map(toLevel);
  }

  /** `BTC` or `BTCUSDT` → the listed symbol (any case); null when not on `alert_symbols`. */
  async resolveSymbol(ticker: string): Promise<{ symbol: string; base: string } | null> {
    const t = ticker.toUpperCase();
    const rows = await this.db.query<{ symbol: string; base: string }>(
      'select symbol, base from alert_symbols where symbol = $1 or base = $1 order by (symbol = $1) desc, symbol limit 1', [t],
    );
    return rows[0] ?? null;
  }

  async bases(): Promise<Map<string, string>> {
    const rows = await this.db.query<{ symbol: string; base: string }>('select symbol, base from alert_symbols');
    return new Map(rows.map((r) => [r.symbol, r.base]));
  }

  /**
   * One statement: the coin must be on `alert_symbols`, and have fewer than CUSTOM_LEVELS_PER_COIN_MAX active levels.
   * The cap is checked inside the insert, so two adds at once cannot both slip past it unseen for long (READ COMMITTED
   * can still let both through: a typo guard, not an invariant).
   */
  async add(x: { symbol: string; price: number; note: string | null; events: CustomLevelEventSwitches; by: number }): Promise<CustomLevelAddResult> {
    const listed = await this.db.query<{ symbol: string }>('select symbol from alert_symbols where symbol = $1', [x.symbol]);
    if (listed.length === 0) return { ok: false, reason: 'not_listed' };
    const rows = await this.db.query<Row>(
      `insert into alert_custom_levels (symbol, price, note, events, created_by)
       select $1, $2, $3, $4, $5
       where (select count(*) from alert_custom_levels where symbol = $1 and deleted_at is null) < $6
       returning ${COLUMNS}`,
      [x.symbol, x.price, x.note, JSON.stringify(x.events), x.by, CUSTOM_LEVELS_PER_COIN_MAX],
    );
    return rows[0] ? { ok: true, level: toLevel(rows[0]) } : { ok: false, reason: 'too_many' };
  }

  /** Soft delete. The level as it was, or null when there is no such ACTIVE level. */
  async remove(id: number, by: number): Promise<CustomLevel | null> {
    const rows = await this.db.query<Row>(
      `update alert_custom_levels set deleted_at = now(), deleted_by = $2 where id = $1 and deleted_at is null returning ${COLUMNS}`,
      [id, by],
    );
    return rows[0] ? toLevel(rows[0]) : null;
  }

  /** Replaces an active level's switches; null when there is no such active level. */
  async setEvents(id: number, events: CustomLevelEventSwitches): Promise<CustomLevel | null> {
    const rows = await this.db.query<Row>(
      `update alert_custom_levels set events = $2 where id = $1 and deleted_at is null returning ${COLUMNS}`,
      [id, JSON.stringify(events)],
    );
    return rows[0] ? toLevel(rows[0]) : null;
  }

  async get(id: number): Promise<CustomLevel | null> {
    const rows = await this.db.query<Row>(`select ${COLUMNS} from alert_custom_levels where id = $1 and deleted_at is null`, [id]);
    return rows[0] ? toLevel(rows[0]) : null;
  }

  /**
   * Who gets a custom level's message: ADMINS with `level_alerts` (the owner's own levels are not a member feature,
   * even once the level type is visible to members).
   */
  async recipients(): Promise<Array<{ chatId: number; lang: 'ru' | 'en' }>> {
    const rows = await this.db.query<{ chat_id: string; lang: 'ru' | 'en' }>(
      `select chat_id, lang from users where level_alerts and role = 'admin' and not disabled and chat_id is not null order by id`,
    );
    return rows.map((r) => ({ chatId: Number(r.chat_id), lang: r.lang }));
  }
}
