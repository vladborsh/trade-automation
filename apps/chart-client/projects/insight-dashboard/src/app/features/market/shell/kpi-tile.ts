import type { WebKpiHistory, WebKpiId, WebKpiTile } from '@trade-automation/contracts';
import type { StringKey } from '../../../i18n/keys';
import { formatUsd } from '../../liquidations/liquidations.format';
import { capUsd } from '../market.format';
import { kpiChartGeometry, type KpiChartGeometry } from './kpi-chart';
import { kpiView, type Tone } from './market-text';

/**
 * IB-106 (market-page design §7.5, D25) — one KPI tile as the mockup lays it out, pure:
 *   1. label (the source in its tooltip), 2. value with ONE inline word or delta beside it,
 *   3. a 6 px bar, 4. a muted note, 5. visible attribution only where the terms ask for it.
 * The numbers are formatted by `kpiView` (IB-088), unchanged; this file decides what goes where.
 *
 * IB-118 (market round 2 §2): on market cap, BTC OI and BTC funding the empty bar is replaced by a
 * 7-day chart (`chart`) with a row under it (`range`): «7д мин {min}» / «макс {max}» for a line,
 * «последние 21 выплата» / «L/S счета {r}» for the funding bars. The note row then says what the
 * chart is (`caption`: «CoinGecko · 7 дней», a shorter span named «за {d} д {h} ч»). With no
 * history the tile is as before; a cap table still filling says «копим историю: {h} ч».
 */
export interface KpiText {
  key: StringKey;
  params: Record<string, string | number>;
}
export interface KpiInline {
  /** Already formatted (a delta), or null when `key` words it (a band, a side). */
  text: string | null;
  key: StringKey | null;
  /** up / down colour a move; muted a word. */
  tone: Tone | 'muted';
  /** What the move is over («за 24ч»): the delta's tooltip and accessible name. */
  overKey: StringKey | null;
}

export interface KpiBarSegment {
  /** 0–100, the share of the track. */
  pct: number;
  colour: string;
}

export interface KpiTileView {
  id: WebKpiId;
  labelKey: StringKey;
  sourceName: string;
  value: string | null;
  inline: KpiInline | null;
  /** Empty = the track alone (the tile has no share to show). */
  bar: KpiBarSegment[];
  /** IB-118: the 7-day chart in the bar's place; null = none (the bar row shows the bar, if any). */
  chart: KpiChartGeometry | null;
  /** IB-118: the row under the chart, left and right. Null = no such row content. */
  range: { left: KpiText | null; right: KpiText | null } | null;
  /** IB-118: what the chart is, in the note row after its source («CoinGecko · 7 дней»); replaces the note. */
  caption: { source: { name: string; url: string | null; link: boolean }; text: KpiText } | null;
  note: { key: StringKey; params: Record<string, string | number> } | null;
  /** Visible, small: only CoinGecko (cap, dominance), §5. */
  attribution: { name: string; url: string | null } | null;
}

/** §5: the sources whose terms ask for a visible credit. Binance is tooltip-only. */
const VISIBLE_ATTRIBUTION: ReadonlySet<WebKpiId> = new Set(['market_cap', 'btc_dominance']);
const AMBER = 'var(--amber-500)';
const LONG = 'var(--color-down)';
const SHORT = 'var(--color-up)';

/** IB-118: the tiles whose bar was empty and now carry a 7-day chart. */
const CHARTED: ReadonlySet<WebKpiId> = new Set(['market_cap', 'btc_oi', 'btc_funding']);
/** A span this close to 7 days is «7 дней»: the first hourly point or 10-min row lands just inside the window. */
export const FULL_SPAN_SEC = 7 * 86_400 - 2 * 3_600;

export function kpiTileView(tile: WebKpiTile): KpiTileView {
  const base = kpiView(tile);
  const visible = VISIBLE_ATTRIBUTION.has(tile.id);
  const history = CHARTED.has(tile.id) ? tile.history : null;
  const chart = kpiChartGeometry(history);
  const caption = chart && history ? { source: { ...tile.source, link: visible }, text: captionText(history) } : null;
  return {
    id: tile.id,
    labelKey: base.labelKey,
    sourceName: tile.source.name,
    value: base.value,
    inline: tile.value === null ? null : inline(tile, base.delta),
    bar: tile.value === null ? [] : bar(tile),
    chart,
    range: range(tile, chart ? history : null),
    caption,
    // the caption carries the source (and CoinGecko's link) when there is a chart; the note's fact moves to the range row
    note: caption || isCollecting(tile) ? null : note(tile),
    attribution: visible && !caption ? { ...tile.source } : null,
  };
}

function range(tile: WebKpiTile, history: WebKpiHistory | null): KpiTileView['range'] {
  if (history === null) {
    const n = tile.note;
    return isCollecting(tile) && n ? { left: { key: 'kpi.note.collecting', params: { hours: Number(n.params['hours'] ?? 0) } }, right: null } : null;
  }
  if (history.kind === 'bars') {
    const ratio = tile.note?.key === 'kpi.note.ls_accounts' ? tile.note.params['ratio'] : null;
    const n = history.points.length;
    return {
      left: { key: `kpi.range.settlements.${ruPlural(n)}` as StringKey, params: { n } },
      right: ratio == null ? null : { key: 'kpi.range.ls_accounts', params: { ratio: ratio.toFixed(2) } },
    };
  }
  const fmt = tile.id === 'market_cap' ? (v: number) => capUsd(v) ?? '' : formatUsd;
  const full = history.to - history.from >= FULL_SPAN_SEC;
  return {
    left: { key: full ? 'kpi.range.min_7d' : 'kpi.range.min', params: { value: fmt(history.min) } },
    right: { key: 'kpi.range.max', params: { value: fmt(history.max) } },
  };
}

function captionText(history: WebKpiHistory): KpiText {
  if (history.kind === 'bars') return { key: 'kpi.caption.funding', params: {} };
  const span = history.to - history.from;
  if (span >= FULL_SPAN_SEC) return { key: 'kpi.caption.7d', params: {} };
  return { key: 'kpi.caption.span', params: { d: Math.floor(span / 86_400), h: Math.floor((span % 86_400) / 3_600) } };
}

const isCollecting = (tile: WebKpiTile) => tile.note?.key === 'kpi.note.collecting';

/** Russian plural category of `n`: 1, 21 → one; 2–4, 22–24 → few; 0, 5–20, 25 → many. */
export function ruPlural(n: number): 'one' | 'few' | 'many' {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'one';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'few';
  return 'many';
}

function inline(tile: WebKpiTile, delta: ReturnType<typeof kpiView>['delta']): KpiInline | null {
  switch (tile.id) {
    case 'btc_funding': {
      const side = tile.context?.key === 'kpi.ctx.funding_side' ? String(tile.context.params['side']) : null;
      return side === null ? null : { text: null, key: `kpi.ctx.funding.${side}` as StringKey, tone: 'muted', overKey: null };
    }
    case 'liquidations_24h':
      return null; // the split is the bar and the note
    default:
      return delta === null ? null : { text: delta.text, key: null, tone: delta.tone, overKey: delta.overKey };
  }
}

function bar(tile: WebKpiTile): KpiBarSegment[] {
  const v = tile.value as number;
  switch (tile.id) {
    case 'btc_dominance':
      return [{ pct: clampPct(v), colour: AMBER }];
    case 'liquidations_24h': {
      const s = tile.split;
      const total = s ? s.long + s.short : 0;
      if (!s || total <= 0) return [];
      const longPct = round1((s.long / total) * 100);
      return [{ pct: longPct, colour: LONG }, { pct: round1(100 - longPct), colour: SHORT }];
    }
    default:
      return [];
  }
}

function note(tile: WebKpiTile): KpiTileView['note'] {
  const n = tile.note;
  if (n) {
    const p = n.params;
    switch (n.key) {
      case 'kpi.note.eth_share':
        return p['ethPct'] == null ? null : { key: 'kpi.note.eth_share', params: { ethPct: (p['ethPct'] as number).toFixed(1) } };
      case 'kpi.note.ls_accounts':
        return p['ratio'] == null ? null : { key: 'kpi.note.ls_accounts', params: { ratio: (p['ratio'] as number).toFixed(2) } };
      case 'kpi.note.collecting':
        return null; // the range row says it (IB-118)
    }
  }
  // client-side notes, from fields the tile already carries (§7.5)
  if (tile.value === null) return null;
  if (tile.id === 'liquidations_24h') {
    const segs = bar(tile);
    return segs.length === 2 ? { key: 'kpi.note.liq_split', params: { long: Math.round(segs[0].pct), short: 100 - Math.round(segs[0].pct) } } : null;
  }
  if (tile.id === 'btc_oi') return { key: `kpi.note.venue_over.${tile.deltaBasis}` as StringKey, params: { venue: tile.source.name } };
  return null;
}

const clampPct = (v: number) => Math.max(0, Math.min(100, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
