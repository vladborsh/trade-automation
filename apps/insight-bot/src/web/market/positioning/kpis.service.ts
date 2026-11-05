import { Logger } from '@nestjs/common';
import { WEB_KPI_IDS, WEB_VENUE_NAMES, type WebKpiId, type WebKpiTile, type WebKpisResponse } from '@trade-automation/contracts';
import { KPI_CACHE_MS } from '../../../insights/thresholds';
import type { TtlCache } from '../../../venues/ttl-cache';
import type { LiquidationsOverviewService } from '../../liquidations/overview.service';
import type { MarketCardsService } from '../market-cards.service';
import type { OiLsService } from '../oi-ls.service';
import type { UniverseSummaryService } from '../universe-summary.service';
import { fundingSide, liqSide } from './kpis.rules';

/**
 * IB-085 (market-page design D10) — `GET /api/web/market/kpis`: the five tiles, from reads the page
 * already makes (market cards, the liquidation block, the OI path, the universe summary). No new
 * venue call: the cards ask only F&G and CoinGecko `/global` (no coin list, so no `/coins/markets`),
 * the OI read shares OiLsService's cache, the summary its own 60 s. Cached 60 s.
 *
 * A source that fails gives its tile `unavailable: 'venue_unavailable'` — the five tiles are always
 * there (the contract refuses four).
 *
 * IB-117 (market round 2 §1) — no Fear & Greed tile: it repeated the gauge panel (owner, 2026-11-05).
 * The cards fetch still carries F&G for the gauge; this service no longer reads it.
 *
 * IB-106 (design §7.5, D25) — each tile may carry a `note`. One comes from the cards fetch above (ETH's
 * share). The other, BTC's global-account long/short ratio, is **the one
 * new read**: `oiLs.longShort(btc, 'global_account', now − 2 h, now)`, a `/futures/data` page at
 * **weight 0**, at most one request per compute (this cache, 60 s) and in practice one per 5 minutes
 * (OiLsService caches the 5-minute-snapped window 300 s): ≤ 5 of the endpoint's 1 000 per 5 min.
 * It is soft: a failure leaves the note null and never touches a tile's value.
 */
export interface KpisOptions {
  cache: TtlCache;
  cards: MarketCardsService;
  liquidations: LiquidationsOverviewService | null;
  oiLs: OiLsService;
  summary: UniverseSummaryService;
  /** The universe's BTC perp symbol (canonical id). */
  btcSymbol: string;
  now?: () => number;
}

const SOURCES = {
  coingecko: { name: 'CoinGecko', url: 'https://www.coingecko.com' },
  liquidations: { name: [WEB_VENUE_NAMES.binance, WEB_VENUE_NAMES.bybit, WEB_VENUE_NAMES.okx].join(', '), url: null },
  binance: { name: WEB_VENUE_NAMES.binance, url: null },
} as const;

export class KpisService {
  private readonly logger = new Logger(KpisService.name);
  private readonly now: () => number;

  constructor(private readonly options: KpisOptions) {
    this.now = options.now ?? Date.now;
  }

  async kpis(): Promise<WebKpisResponse> {
    return this.options.cache.getOrLoad('kpis', KPI_CACHE_MS, () => this.compute());
  }

  private async compute(): Promise<WebKpisResponse> {
    const now = this.now();
    const soft = <T>(label: string, p: Promise<T>): Promise<T | null> =>
      p.catch((error: unknown) => { this.logger.warn(`kpis ${label}: ${(error as Error).message}`); return null; });
    const btc = this.options.btcSymbol;
    const [cards, overview, oi, summary, ls] = await Promise.all([
      soft('cards', this.options.cards.cards([])),
      this.options.liquidations ? soft('liquidations', this.options.liquidations.overview({ topN: 20, feedMinUsd: 100_000, feedLimit: 1, period: '24h' })) : Promise.resolve(null),
      soft('oi', this.options.oiLs.openInterest(btc, now - 24 * 3_600_000 - 15 * 60_000, now)),
      soft('summary', this.options.summary.summary([{ id: btc, base: 'BTC', volumeRank: 1 }])),
      soft('ls_accounts', this.options.oiLs.longShort(btc, 'global_account', now - LS_NOTE_WINDOW_MS, now)),
    ]);

    const tiles: Record<WebKpiId, WebKpiTile> = {
      market_cap: tile('market_cap', SOURCES.coingecko),
      btc_dominance: tile('btc_dominance', SOURCES.coingecko),
      liquidations_24h: tile('liquidations_24h', SOURCES.liquidations),
      btc_oi: tile('btc_oi', SOURCES.binance),
      btc_funding: tile('btc_funding', SOURCES.binance),
    };

    const dom = cards?.dominance ?? null;
    if (dom?.totalUsd != null) {
      Object.assign(tiles.market_cap, available(dom.totalUsd, dom.totalChangePct24h, Math.floor(dom.atMs / 1000)),
        dom.totalChangePct24h == null ? {} : { context: { key: 'kpi.ctx.change', params: { deltaPct: round(dom.totalChangePct24h, 2) } } });
    }
    if (dom) Object.assign(tiles.btc_dominance, available(dom.btcPct, dom.changePct24h, Math.floor(dom.atMs / 1000)));
    if (dom?.ethPct != null) tiles.btc_dominance.note = { key: 'kpi.note.eth_share', params: { ethPct: round(dom.ethPct, 1) } };

    if (overview) {
      const t = overview.block.totals;
      Object.assign(tiles.liquidations_24h, available(t.usd, null, overview.asOf), {
        split: { long: t.long, short: t.short },
        context: t.usd > 0 ? { key: 'kpi.ctx.liq_side', params: liqSide(t.long, t.short) } : null,
      });
    }

    const pts = oi?.points ?? [];
    const lastOi = pts.at(-1);
    if (lastOi && lastOi.notional !== null) {
      const start = pts.find((p) => p.time * 1000 >= now - 24 * 3_600_000);
      const change = start && start.notional && start.time < lastOi.time ? (lastOi.notional / start.notional - 1) * 100 : null;
      Object.assign(tiles.btc_oi, available(lastOi.notional, change === null ? null : round(change, 2), lastOi.time),
        change === null ? {} : { context: { key: 'kpi.ctx.change', params: { deltaPct: round(change, 2) } } });
    }

    const f = summary?.rows.find((r) => r.id === btc)?.fundingRate ?? null;
    if (f !== null) {
      Object.assign(tiles.btc_funding, available(f, null, Math.floor((summary?.asOfMs ?? now) / 1000)), {
        context: { key: 'kpi.ctx.funding_side', params: { side: fundingSide(f) } },
      });
    }

    // the note is its own fact: it stands even when the funding read failed, and its failure empties nothing
    const lastLs = ls?.points.at(-1);
    if (lastLs && Number.isFinite(lastLs.ratio)) tiles.btc_funding.note = { key: 'kpi.note.ls_accounts', params: { ratio: round(lastLs.ratio, 2) } };

    return { asOf: Math.floor(now / 1000), tiles: WEB_KPI_IDS.map((id) => tiles[id]) };
  }
}

function tile(id: WebKpiId, source: { name: string; url: string | null }): WebKpiTile {
  return { id, value: null, delta: null, deltaBasis: '24h', split: null, context: null, note: null, source: { ...source }, unavailable: 'venue_unavailable', asOf: null };
}

function available(value: number, delta: number | null | undefined, asOf: number): Partial<WebKpiTile> {
  return { value, delta: delta ?? null, unavailable: null, asOf };
}

/** IB-106: the window the L/S note reads — the last 5-minute point is all it needs; 2 h covers a late venue. */
const LS_NOTE_WINDOW_MS = 2 * 3_600_000;
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
