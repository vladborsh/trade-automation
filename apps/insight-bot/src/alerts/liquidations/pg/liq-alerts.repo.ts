import {
  LiqParamsSchema, OI_RESEARCH_WINDOWS, type LiqAlertEvent, type LiqParams, type LiqSide, type LiqVenue, type MarketAlertControlKind,
  type MarketAlertSource, type WebLiqAlertRow,
} from '@trade-automation/contracts';
import type { DbHandle } from '../../../db/db.port';
import { BINANCE_LIQUIDATION_STREAM } from '../../../collectors/uptime/liquidation-streams';
import { STREAM_LIQUIDATION as BYBIT_STREAM } from '../../../collectors/bybit/bybit-collector';
import { STREAM_LIQUIDATION as OKX_STREAM } from '../../../collectors/okx/okx-collector';
import { COIN_M_PATTERNS } from '../../../web/liquidations/pg/episodes.repo';
import type { VenueStatus } from '../coverage';

/**
 * IB-122 (design C1, L1–L8) — the large-liquidation loop's reads and writes (SQL under `pg/`, IB-004).
 *
 * The tape reads canonicalise nothing: the loop passes the exact (venue, venue symbol) pairs its mapper
 * produced, which is an equi-join on `liquidations`' (venue, symbol, ts, …) unique index. **COIN-M is
 * excluded in the query itself** anyway (IB-BUG-039, migration 022's two patterns, as IB-133 does): a
 * database that never ran 022 still holds `BTCUSD_PERP` prints priced ~758× too high.
 */
const NOT_COIN_M = `not (l.venue = 'binance' and (l.symbol ~ '${COIN_M_PATTERNS[0]}' or l.symbol ~ '${COIN_M_PATTERNS[1]}'))`;

const STREAM_VENUE: Record<string, LiqVenue> = { [BINANCE_LIQUIDATION_STREAM]: 'binance', [BYBIT_STREAM]: 'bybit', [OKX_STREAM]: 'okx' };

export interface VenuePair { venue: LiqVenue; symbol: string }

export interface TapePrint { venue: LiqVenue; symbol: string; side: LiqSide; ts: number; usd: number }

export interface LiqSettings { enabled: boolean; membersVisible: boolean; params: LiqParams; updatedAt: number }

/** A journal row as the loop needs it: quiet periods (L2) and market events (L11–L14). Times epoch ms. */
export interface JournalLiqRow {
  id: number;
  event: LiqAlertEvent;
  symbol: string;
  side: LiqSide;
  at: number;
  late: boolean;
  /** `alert` rows; for an event row its link coin's window. */
  windowStartMs: number;
  thresholdUsd: number;
  /** For an old `continuing` row: the alert it continues. */
  alertId: number | null;
  /** IB-143: the event's T0 (`alert` rows from IB-143 on, and every event row); null on older `alert` rows. */
  eventAt: number | null;
  /** `event` rows: S and how it came, and the coins of the first message. */
  sentAt: number | null;
  settled: 'quiet' | 'cap' | null;
  coins: string[];
  /** Event rows: the total at S (`event`) or at the close (`event_continuing`); null elsewhere. */
  totalUsd: number | null;
  /** IB-148, `event` rows: taken in by the same-side event with this T0, and how (L17 / L18); null = not. */
  mergedInto: { eventAt: number; how: 'after' | 'before' } | null;
}

/** One journal row from its stored columns; shared by the Pg store and the in-memory ones. */
export function journalRow(r: { id: number; event: LiqAlertEvent; symbol: string; atMs: number; late: boolean; details: Record<string, unknown> }): JournalLiqRow {
  const d = r.details;
  const num = (v: unknown): number | null => (v === undefined || v === null ? null : Number(v));
  const coins = Array.isArray(d.coins) ? (d.coins as Array<{ symbol: string }>).map((c) => c.symbol) : [];
  return {
    id: r.id, event: r.event, symbol: r.symbol, side: d.side as LiqSide, at: r.atMs, late: r.late,
    windowStartMs: Number(d.windowStartMs ?? NaN), thresholdUsd: Number(d.thresholdUsd ?? NaN),
    alertId: num(d.alertId), eventAt: num(d.eventAt), sentAt: num(d.sentAt),
    settled: d.settled === 'quiet' || d.settled === 'cap' ? d.settled : null, coins,
    totalUsd: num(d.totalUsd), mergedInto: mergedOf(d.mergedInto),
  };
}

function mergedOf(v: unknown): JournalLiqRow['mergedInto'] {
  if (v === null || typeof v !== 'object') return null;
  const m = v as { eventAt?: unknown; how?: unknown };
  return (m.how === 'after' || m.how === 'before') && m.eventAt !== undefined ? { eventAt: Number(m.eventAt), how: m.how } : null;
}

export interface NewMarketAlert {
  source: MarketAlertSource;
  event: LiqAlertEvent;
  symbol: string;
  atMs: number;
  details: Record<string, unknown>;
  params: LiqParams;
  build: string;
  confirmedAtMs: number;
  late: boolean;
  dedupeKey: string;
}

export interface NewMarketControl {
  source: MarketAlertSource;
  kind: MarketAlertControlKind;
  symbol: string;
  atMs: number;
  details: Record<string, unknown>;
  params: LiqParams;
  build: string;
  dedupeKey: string;
}

/** The port the loop is written against; `PgLiqAlertStore` below, an in-memory one in the specs. */
export interface LiqAlertStore {
  settings(): Promise<LiqSettings>;
  /** Enabled rows of `alert_symbols`. */
  listedCoins(): Promise<Array<{ symbol: string; base: string }>>;
  /** All prints of these pairs with ts in (fromMs, toMs], oldest first — the loop's one tape read per tick. */
  prints(pairs: readonly VenuePair[], fromMs: number, toMs: number): Promise<TapePrint[]>;
  /** Journal rows of `source` with `at` after `sinceMs`. */
  journal(source: MarketAlertSource, sinceMs: number): Promise<JournalLiqRow[]>;
  /**
   * Heartbeats, gaps and `liquidation_tracked`. Gaps ending after `gapsSinceMs` (default: the last day, all a live
   * window ≤ 35 min back can overlap); the history run (IB-123) passes its own start.
   */
  venueStatus(gapsSinceMs?: number): Promise<VenueStatus>;
  /** Null: the dedupe key exists already (a restart, an overlapping tick). */
  insertAlert(x: NewMarketAlert): Promise<number | null>;
  insertControl(x: NewMarketControl): Promise<number | null>;
  /** Direction-free price paths (L8; 4h / 24h / 72h from t0). */
  insertPaths(subject: { marketAlertId: number } | { marketControlId: number }, symbol: string, t0Sec: number): Promise<void>;
  recipients(): Promise<Array<{ chatId: number; lang: 'ru' | 'en' }>>;
  markFired(id: number, firedAtMs: number, recipients: number): Promise<void>;
  /** L3: a sent liquidation message of this UTC day already carried the Binance footnote. */
  footnoteSent(dayStartMs: number): Promise<boolean>;
}

const ms = (d: Date | string): number => new Date(d).getTime();

export class PgLiqAlertStore implements LiqAlertStore {
  constructor(private readonly db: DbHandle) {}

  async settings(): Promise<LiqSettings> {
    const [r] = await this.db.query<{ enabled: boolean; members_visible: boolean; params: unknown; updated_at: Date }>(
      `select enabled, members_visible, params, updated_at from alert_type_settings where type = 'liq'`,
    );
    if (!r) throw new Error(`alert_type_settings has no 'liq' row (migration 031 seeds it)`);
    return { enabled: r.enabled, membersVisible: r.members_visible, params: LiqParamsSchema.parse(r.params), updatedAt: Math.floor(ms(r.updated_at) / 1000) };
  }

  async listedCoins(): Promise<Array<{ symbol: string; base: string }>> {
    return this.db.query<{ symbol: string; base: string }>('select symbol, base from alert_symbols where enabled order by symbol');
  }

  async prints(pairs: readonly VenuePair[], fromMs: number, toMs: number): Promise<TapePrint[]> {
    if (pairs.length === 0) return [];
    const rows = await this.db.query<{ venue: LiqVenue; symbol: string; side: LiqSide; ts: Date; notional: string }>(
      `select l.venue, l.symbol, l.side, l.ts, l.notional
         from liquidations l
         join unnest($1::text[], $2::text[]) as p(venue, symbol) on l.venue = p.venue and l.symbol = p.symbol
        where l.ts > $3 and l.ts <= $4 and ${NOT_COIN_M}
        order by l.ts, l.id`,
      [pairs.map((p) => p.venue), pairs.map((p) => p.symbol), new Date(fromMs), new Date(toMs)],
    );
    return rows.map((r) => ({ venue: r.venue, symbol: r.symbol, side: r.side, ts: ms(r.ts), usd: Number(r.notional) }));
  }

  async journal(source: MarketAlertSource, sinceMs: number): Promise<JournalLiqRow[]> {
    const rows = await this.db.query<{ id: string; event: LiqAlertEvent; symbol: string; at: Date; late: boolean; details: Record<string, unknown> }>(
      `select id, event, symbol, at, late, details from market_alerts where type = 'liq' and source = $1 and at > $2 order by at, id`,
      [source, new Date(sinceMs)],
    );
    return rows.map((r) => journalRow({ id: Number(r.id), event: r.event, symbol: r.symbol, atMs: ms(r.at), late: r.late, details: r.details }));
  }

  async venueStatus(gapsSinceMs?: number): Promise<VenueStatus> {
    const streams = Object.keys(STREAM_VENUE);
    // one after another, not Promise.all: on a transaction (IB-123's dry run) the handle is ONE client, and pg
    // refuses concurrent queries on a client from v9 (a deprecation warning today)
    const beats = await this.db.query<{ stream: string; first_seen_at: Date; last_seen_at: Date }>(
      'select stream, first_seen_at, last_seen_at from collector_heartbeats where stream = any($1::text[])', [streams]);
    // the last day of gaps is all a live window (≤ 35 min back) can overlap; a history run asks from its start
    const gaps = await this.db.query<{ stream: string; gap_from: Date; gap_to: Date }>(
      `select stream, gap_from, gap_to from collector_gaps
        where stream = any($1::text[]) and gap_to > coalesce($2::timestamptz, now() - interval '1 day')`,
      [streams, gapsSinceMs === undefined ? null : new Date(gapsSinceMs)]);
    const tracked = await this.db.query<{ venue: 'bybit' | 'okx'; symbol: string; since: Date }>('select venue, symbol, since from liquidation_tracked');
    const heartbeats = new Map(beats.map((b) => [STREAM_VENUE[b.stream] as LiqVenue, { firstSeen: ms(b.first_seen_at), lastSeen: ms(b.last_seen_at) }]));
    const byVenue = new Map<'bybit' | 'okx', Map<string, number>>([['bybit', new Map()], ['okx', new Map()]]);
    for (const t of tracked) byVenue.get(t.venue)?.set(t.symbol, ms(t.since));
    return {
      heartbeats,
      gaps: gaps.map((g) => ({ venue: STREAM_VENUE[g.stream] as LiqVenue, from: ms(g.gap_from), to: ms(g.gap_to) })),
      tracked: byVenue,
    };
  }

  async insertAlert(x: NewMarketAlert): Promise<number | null> {
    const rows = await this.db.query<{ id: string }>(
      `insert into market_alerts (type, event, symbol, direction, at, tf, details, params, source, build, confirmed_at, late, dedupe_key)
       values ('liq', $1, $2, null, $3, '5m', $4, $5, $6, $7, $8, $9, $10)
       on conflict (source, type, dedupe_key) do nothing returning id`,
      [x.event, x.symbol, new Date(x.atMs), JSON.stringify(x.details), JSON.stringify(x.params), x.source, x.build, new Date(x.confirmedAtMs), x.late, x.dedupeKey],
    );
    return rows[0] ? Number(rows[0].id) : null;
  }

  async insertControl(x: NewMarketControl): Promise<number | null> {
    const rows = await this.db.query<{ id: string }>(
      `insert into market_alert_controls (type, kind, symbol, at, direction, details, params, source, build, dedupe_key)
       values ('liq', $1, $2, $3, null, $4, $5, $6, $7, $8)
       on conflict (source, type, dedupe_key) do nothing returning id`,
      [x.kind, x.symbol, new Date(x.atMs), JSON.stringify(x.details), JSON.stringify(x.params), x.source, x.build, x.dedupeKey],
    );
    return rows[0] ? Number(rows[0].id) : null;
  }

  async insertPaths(subject: { marketAlertId: number } | { marketControlId: number }, symbol: string, t0Sec: number): Promise<void> {
    const [column, id] = 'marketAlertId' in subject ? ['market_alert_id', subject.marketAlertId] : ['market_control_id', subject.marketControlId];
    // direction-free (L8): no direction, no stop; atr14 is required by 027 and unused without a direction
    await this.db.query(
      `insert into oi_divergence_paths (${column}, win, symbol, direction, t0, atr14, stop_price)
       select $1, w, $3, null, $4, 0, null from unnest($2::text[]) as w
       on conflict do nothing`,
      [id, [...OI_RESEARCH_WINDOWS], symbol, new Date(t0Sec * 1000)],
    );
  }

  async recipients(): Promise<Array<{ chatId: number; lang: 'ru' | 'en' }>> {
    const rows = await this.db.query<{ chat_id: string; lang: 'ru' | 'en' }>(
      'select chat_id, lang from users where liq_alerts and not disabled and chat_id is not null order by id',
    );
    return rows.map((r) => ({ chatId: Number(r.chat_id), lang: r.lang }));
  }

  async markFired(id: number, firedAtMs: number, recipients: number): Promise<void> {
    await this.db.query('update market_alerts set fired_at = $2, recipients = $3 where id = $1', [id, new Date(firedAtMs), recipients]);
  }

  async footnoteSent(dayStartMs: number): Promise<boolean> {
    const rows = await this.db.query<{ one: number }>(
      `select 1 as one from market_alerts
        where type = 'liq' and fired_at >= $1 and fired_at < $1::timestamptz + interval '1 day' and (details ->> 'binanceFootnote')::boolean
        limit 1`,
      [new Date(dayStartMs)],
    );
    return rows.length > 0;
  }

  // ------------------------------------------------------------------ the admin page (§1 Settings)

  async journalPage(limit = 50): Promise<WebLiqAlertRow[]> {
    const rows = await this.db.query<{
      id: string; source: MarketAlertSource; event: LiqAlertEvent; symbol: string; at: Date; details: Record<string, unknown>;
      fired_at: Date | null; late: boolean; recipients: number;
    }>(`select id, source, event, symbol, at, details, fired_at, late, recipients from market_alerts where type = 'liq' order by at desc, id desc limit $1`, [limit]);
    return rows.map((r) => ({
      id: Number(r.id), source: r.source, event: r.event, symbol: r.symbol, side: r.details.side as LiqSide, at: Math.floor(ms(r.at) / 1000),
      firedAt: r.fired_at ? Math.floor(ms(r.fired_at) / 1000) : null, late: r.late, recipients: r.recipients,
      ...adminFigures(r.event, r.symbol, r.details),
    }));
  }

  async allCoins(): Promise<Array<{ symbol: string; base: string; enabled: boolean }>> {
    return this.db.query<{ symbol: string; base: string; enabled: boolean }>('select symbol, base, enabled from alert_symbols order by symbol');
  }

  async updateSettings(patch: { enabled?: boolean; membersVisible?: boolean; params?: LiqParams }, by: number): Promise<void> {
    await this.db.query(
      `update alert_type_settings set enabled = coalesce($1, enabled), members_visible = coalesce($2, members_visible),
              params = coalesce($3::jsonb, params), updated_by = $4, updated_at = now() where type = 'liq'`,
      [patch.enabled ?? null, patch.membersVisible ?? null, patch.params === undefined ? null : JSON.stringify(patch.params), by],
    );
  }
}

/**
 * The admin row's figures (IB-143): a crossing or an old continuation shows its own sum and threshold; an event row
 * its total and its coins, largest first, a coin that joined after the first message marked «+».
 */
export function adminFigures(event: LiqAlertEvent, symbol: string, d: Record<string, unknown>): Pick<WebLiqAlertRow, 'sumUsd' | 'thresholdUsd' | 'coins' | 'news'> {
  if (event !== 'event' && event !== 'event_continuing') return { sumUsd: Number(d.sumUsd), thresholdUsd: Number(d.thresholdUsd), coins: [symbol], news: true };
  const fresh = new Set(Array.isArray(d.newCoins) ? (d.newCoins as string[]) : []);
  const coins = (Array.isArray(d.coins) ? (d.coins as Array<{ symbol: string }>) : []).map((c) => (fresh.has(c.symbol) ? `+${c.symbol}` : c.symbol));
  // an `event` taken in by a larger one (IB-148) is journalled only, like a continuation that was not news
  return { sumUsd: Number(d.totalUsd), thresholdUsd: null, coins, news: event === 'event' ? d.mergedInto === undefined : d.news === true };
}

/** §1 Recipients: whether members see the liquidation-alerts toggle (`/me/settings`). */
export class PgLiqAlertsVisibility {
  constructor(private readonly db: DbHandle) {}

  async membersVisible(): Promise<boolean> {
    const rows = await this.db.query<{ members_visible: boolean }>(`select members_visible from alert_type_settings where type = 'liq'`);
    return rows[0]?.members_visible ?? false;
  }
}
