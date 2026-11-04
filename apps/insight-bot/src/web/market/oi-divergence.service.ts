import {
  OI_DIVERGENCE_DEFAULT_PARAMS, OI_DIVERGENCE_TF_SEC, OiDivergenceParamsSchema,
  type OiDivergenceParams, type OiDivergenceTf, type WebOiDivergenceLine, type WebOiDivergenceSeriesResponse,
} from '@trade-automation/contracts';
import type { Db } from '../../db/db.port';
import { detectDivergences, type Bar, type Divergence } from '../../insights/divergence/detector';
import type { OiPoint } from '../../insights/divergence/oi-per-bar';
import { OiWindowReader } from '../../insights/divergence/oi-window.reader';
import { detectorParams } from '../../insights/divergence/params';
import { RETENTION_MS, type FuturesDataClient } from '../../venues/binance/futures-data.client';
import type { TtlCache } from '../../venues/ttl-cache';
import type { CandlesService } from './candles.service';

/**
 * IB-110 (OI divergence design V11) — `GET /api/web/series/oi-divergences?symbol&tf`: the divergence
 * lines of ANY coin with OI, computed on open (not stored), so the chart always draws what the
 * detector says with the CURRENT params, and an alert and a line cannot disagree.
 *
 * - **Span:** the coin's stored OI from its first row to now; **15m is capped at the last 90 days**.
 *   A coin we do not store (no row) gets Binance's own 30 days of 5 m OI instead: 18 `openInterestHist`
 *   pages, weight 0, cached 15 minutes.
 * - **Bars:** `CandlesService` (its page cache and its `WEIGHT_CEILING_1M` refusal); closed bars only.
 * - **OI and the venue's silences:** `OiWindowReader`, the read the alert loop uses too.
 * - **Fired:** a line whose (symbol, tf, direction, A, B) is in the journal carries its `fired_at`.
 * - **Cache:** per (symbol, tf) for one bar — a new bar is the only thing that can change the answer.
 *
 * Holds nothing beyond that cache (no boot warm-up, IB-096).
 */
export const OI_DIVERGENCE_15M_SPAN_MS = 90 * 86_400_000;
export const VENUE_OI_TTL_MS = 15 * 60_000;

export interface OiDivergenceServiceOptions {
  db: Db | null;
  candles: CandlesService;
  client: FuturesDataClient;
  cache: TtlCache;
  now?: () => number;
}

export class OiDivergenceService {
  private readonly now: () => number;
  private readonly reader: OiWindowReader | null;

  constructor(private readonly options: OiDivergenceServiceOptions) {
    this.now = options.now ?? Date.now;
    this.reader = options.db ? new OiWindowReader(options.db) : null;
  }

  async series(symbol: string, tf: OiDivergenceTf): Promise<WebOiDivergenceSeriesResponse> {
    const tfMs = OI_DIVERGENCE_TF_SEC[tf] * 1000;
    const now = this.now();
    const bar = Math.floor(now / tfMs);
    return this.options.cache.getOrLoad(`oi-div:${symbol}:${tf}:${bar}`, tfMs, () => this.compute(symbol, tf, now));
  }

  private async compute(symbol: string, tf: OiDivergenceTf, now: number): Promise<WebOiDivergenceSeriesResponse> {
    const tfSec = OI_DIVERGENCE_TF_SEC[tf];
    const params = await this.params();
    const stored = await this.storedFrom(symbol);
    const floor = tf === '15m' ? now - OI_DIVERGENCE_15M_SPAN_MS : 0;
    const fromMs = Math.max(stored ?? now - RETENTION_MS, floor);
    const candles = await this.options.candles.candles('perp', symbol, tf, fromMs, now);
    // closed bars only: the forming bar's wick can still move, and a pivot needs it final
    const bars: Bar[] = candles.filter((c) => (c.time + tfSec) * 1000 <= now)
      .map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
    const first = bars[0]?.time ?? Math.floor(fromMs / 1000);
    const lastClose = bars.length > 0 ? bars[bars.length - 1].time + tfSec : Math.floor(now / 1000);

    const { oi5m, venueSilent } = stored !== null && this.reader
      ? await this.reader.read(symbol, first, lastClose)
      : { oi5m: await this.venueOi(symbol, now), venueSilent: [] };

    const r = detectDivergences({
      tfSec, bars, oi5m, venueSilent,
      params: detectorParams(params, tf),
      oiDueUntil: Math.floor(now / 1000) - 6 * 60, // V9: the venue's publish lag is not a hole
    });
    const fired = await this.fired(symbol, tf);
    return {
      symbol, tf, from: first, to: lastClose, params,
      lines: r.divergences.map((d) => line(d, fired)),
      skips: r.skips,
    };
  }

  /** V17: the admin's params (one row), or the V5–V7 defaults without a database or a valid row. */
  private async params(): Promise<OiDivergenceParams> {
    if (!this.options.db) return OI_DIVERGENCE_DEFAULT_PARAMS;
    const [row] = await this.options.db.query<{ params: unknown }>('select params from alert_settings where id = 1', []);
    const parsed = OiDivergenceParamsSchema.safeParse(row?.params);
    return parsed.success ? parsed.data : OI_DIVERGENCE_DEFAULT_PARAMS;
  }

  /** The first stored OI row's time (ms), or null when we do not store this coin. */
  private async storedFrom(symbol: string): Promise<number | null> {
    if (!this.options.db) return null;
    const [row] = await this.options.db.query<{ first: Date | null }>(
      `select min(ts) as first from open_interest_5m where venue = 'binance' and symbol = $1`, [symbol]);
    return row?.first ? new Date(row.first).getTime() : null;
  }

  /** A coin we do not store: the venue's 30 days of 5 m OI (18 pages, weight 0), cached 15 minutes. */
  private async venueOi(symbol: string, now: number): Promise<OiPoint[]> {
    return this.options.cache.getOrLoad(`oi-div-venue:${symbol}`, VENUE_OI_TTL_MS, async () => {
      const rows = await this.options.client.fetchBackward<{ timestamp: number; sumOpenInterest: string }>(
        { endpoint: 'openInterestHist', symbol, period: '5m' }, now - RETENTION_MS, now);
      return rows.map((r) => ({ time: Math.floor(r.timestamp / 1000), oi: Number(r.sumOpenInterest) }))
        .filter((p) => Number.isFinite(p.oi));
    });
  }

  /** V11: lines the alert loop sent, keyed as the journal's once-key. */
  private async fired(symbol: string, tf: OiDivergenceTf): Promise<Map<string, number>> {
    if (!this.options.db) return new Map();
    const rows = await this.options.db.query<{ direction: string; a_time: Date; b_time: Date; fired_at: Date }>(
      `select direction, a_time, b_time, fired_at from oi_divergence_alerts
        where symbol = $1 and tf = $2 and fired_at is not null`, [symbol, tf]);
    return new Map(rows.map((r) => [
      firedKey(r.direction, sec(r.a_time), sec(r.b_time)), sec(r.fired_at),
    ]));
  }
}

const sec = (d: Date) => Math.floor(new Date(d).getTime() / 1000);
const firedKey = (direction: string, a: number, b: number) => `${direction}:${a}:${b}`;

function line(d: Divergence, fired: Map<string, number>): WebOiDivergenceLine {
  return {
    direction: d.direction,
    a: d.a,
    b: d.b,
    confirmedAt: d.confirmedAt,
    pricePct: d.pricePct,
    oiPct: d.oiPct,
    repeat: d.runLength > 2 && d.runFirstBTime !== null ? { runLength: d.runLength, firstBTime: d.runFirstBTime } : null,
    firedAt: fired.get(firedKey(d.direction, d.a.time, d.b.time)) ?? null,
  };
}
