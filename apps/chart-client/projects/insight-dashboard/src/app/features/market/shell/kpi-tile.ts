import type { WebKpiId, WebKpiTile } from '@trade-automation/contracts';
import type { StringKey } from '../../../i18n/keys';
import { kpiView, type Tone } from './market-text';

/**
 * IB-106 (market-page design §7.5, D25) — one KPI tile as the mockup lays it out, pure:
 *   1. label (the source in its tooltip), 2. value with ONE inline word or delta beside it,
 *   3. a 6 px bar, 4. a muted note, 5. visible attribution only where the terms ask for it.
 * The numbers are formatted by `kpiView` (IB-088), unchanged; this file decides what goes where.
 */
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
  note: { key: StringKey; params: Record<string, string | number> } | null;
  /** Visible, small: only CoinGecko (cap, dominance), §5. */
  attribution: { name: string; url: string | null } | null;
}

/** §5: the sources whose terms ask for a visible credit. Binance is tooltip-only. */
const VISIBLE_ATTRIBUTION: ReadonlySet<WebKpiId> = new Set(['market_cap', 'btc_dominance']);
const AMBER = 'var(--amber-500)';
const LONG = 'var(--color-down)';
const SHORT = 'var(--color-up)';

export function kpiTileView(tile: WebKpiTile): KpiTileView {
  const base = kpiView(tile);
  return {
    id: tile.id,
    labelKey: base.labelKey,
    sourceName: tile.source.name,
    value: base.value,
    inline: tile.value === null ? null : inline(tile, base.delta),
    bar: tile.value === null ? [] : bar(tile),
    note: note(tile),
    attribution: VISIBLE_ATTRIBUTION.has(tile.id) ? { ...tile.source } : null,
  };
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
