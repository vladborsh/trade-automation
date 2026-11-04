import {
  WEB_MARKET_PERIODS, type WebInsightBasis, type WebInsightBlockLine, type WebInsightStatement, type WebKpiTile, type WebMarketPeriod,
} from '@trade-automation/contracts';
import type { StringKey } from '../../../i18n/keys';
import { formatUsd } from '../../liquidations/liquidations.format';
import { capUsd } from '../market.format';

/**
 * IB-088 (market-page design D4, D10, D14) — everything the shell computes, pure and spec'd: the
 * period from the URL, a period's availability, a KPI tile's text, an insight card's wording and
 * link. The server sends keys and typed numbers; the CLIENT words them (D4) — so the formatting of
 * every number lives here, not in a template.
 */

/** `?p=` → a period; anything else (or nothing) is the page default, 24h. */
export function parsePeriod(raw: string | null | undefined): WebMarketPeriod {
  return (WEB_MARKET_PERIODS as readonly string[]).includes(raw ?? '') ? (raw as WebMarketPeriod) : '24h';
}

/** D14: a period is offered only once its block has a full window of tape. */
export function periodAvailability(
  availableFrom: Partial<Record<WebMarketPeriod, number | null>> | null | undefined,
  period: WebMarketPeriod,
  nowSec: number,
): { available: boolean; fromDay: string | null } {
  const from = availableFrom?.[period] ?? null;
  if (from === null || from <= nowSec) return { available: true, fromDay: null };
  return { available: false, fromDay: new Date(from * 1000).toISOString().slice(0, 10) };
}

const MINUS = '−';
/** `+2.10 %`, `−0.30 %`; null stays null (the template says "no data" in words). */
export function signedPct(value: number | null | undefined, digits = 2): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const s = value > 0 ? '+' : value < 0 ? MINUS : '';
  return `${s}${Math.abs(value).toFixed(digits)} %`;
}

/** A funding fraction as percent per settlement: 0.0001 → `0.0100 %`. */
export function fundingPct(rate: number | null | undefined): string | null {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return null;
  const s = rate < 0 ? MINUS : '';
  return `${s}${Math.abs(rate * 100).toFixed(4)} %`;
}

export type Tone = 'up' | 'down' | 'flat';
export const toneOf = (v: number | null): Tone | null => (v === null ? null : v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

export interface KpiView {
  labelKey: StringKey;
  value: string | null;
  /** The move, with the period it is over (`kpi.over.24h`): said once, here (IB-089 follow-up). */
  delta: { text: string; tone: Tone; overKey: StringKey } | null;
  context: { key: StringKey; params: Record<string, string | number> } | null;
  source: { name: string; url: string | null };
}

/** D10: one tile's text. The unit of `value` and of `delta` differs per tile and is decided here. */
export function kpiView(tile: WebKpiTile): KpiView {
  const v = tile.value;
  const d = tile.delta;
  const value = v === null ? null
    : tile.id === 'market_cap' ? capUsd(v)
    : tile.id === 'btc_dominance' ? `${v.toFixed(1)} %`
    : tile.id === 'fear_greed' ? String(Math.round(v))
    : tile.id === 'btc_funding' ? fundingPct(v)
    : formatUsd(v);
  const deltaText = d === null ? null
    : tile.id === 'btc_dominance' ? `${d > 0 ? '+' : d < 0 ? MINUS : ''}${Math.abs(d).toFixed(2)} pp`
    : tile.id === 'fear_greed' ? `${d > 0 ? '+' : d < 0 ? MINUS : ''}${Math.abs(Math.round(d))}`
    : signedPct(d);
  return {
    labelKey: `kpi.${tile.id}` as StringKey,
    value,
    delta: deltaText === null ? null : { text: deltaText, tone: toneOf(d) as Tone, overKey: `kpi.over.${tile.deltaBasis}` as StringKey },
    context: restatesDelta(tile) ? null : kpiContext(tile),
    source: tile.source,
  };
}

/**
 * TL 2026-11-03: «−2.58 %» then «за 24ч −2.58 %» says one thing twice. A `kpi.ctx.change` line is
 * dropped only when it is the delta again (same 24h basis, same number at the shown precision); a
 * context that adds something — a band, a side, a share — stays.
 */
export function restatesDelta(tile: WebKpiTile): boolean {
  const c = tile.context;
  if (c?.key !== 'kpi.ctx.change' || tile.delta === null || tile.deltaBasis !== '24h') return false;
  return Math.abs(Number(c.params['deltaPct']) - tile.delta) < 0.005;
}

function kpiContext(tile: WebKpiTile): KpiView['context'] {
  const c = tile.context;
  if (!c) return null;
  const p = c.params;
  switch (c.key) {
    case 'kpi.ctx.change': return { key: 'kpi.ctx.change', params: { change: signedPct(Number(p['deltaPct'])) ?? '' } };
    case 'kpi.ctx.fng_band': return { key: `kpi.ctx.fng.${String(p['band'])}` as StringKey, params: {} };
    case 'kpi.ctx.liq_side': return { key: p['side'] === 'long' ? 'kpi.ctx.liq.long' : 'kpi.ctx.liq.short', params: { share: Number(p['sharePct']) } };
    case 'kpi.ctx.funding_side': return { key: `kpi.ctx.funding.${String(p['side'])}` as StringKey, params: {} };
  }
}

export interface InsightView {
  key: StringKey;
  params: Record<string, string | number>;
  /** Keys whose translation goes INTO a param (a side, a quadrant, a band) — resolved by the caller. */
  nested: Record<string, StringKey>;
  basis: { key: StringKey; params: Record<string, string | number> };
  link: { commands: string[]; queryParams: Record<string, number | string> | null } | { anchor: string };
}

/**
 * IB-BUG-023: the statements whose link is the START of the period they measure, not a moment of
 * their own (R4 — OI against price over the period). Their link adds `span=<period>`, so the
 * instrument page shows the whole period and marks its start as such.
 */
const PERIOD_START_RULES: ReadonlySet<string> = new Set(['R4']);

function linkQuery(s: WebInsightStatement, timeSec: number | null): Record<string, number | string> | null {
  if (timeSec === null) return null;
  return PERIOD_START_RULES.has(s.ruleId) ? { at: timeSec, span: s.basis.window } : { at: timeSec };
}

/** D4: a statement → the key, its params formatted, its basis line and its link. */
export function insightView(s: WebInsightStatement, nowSec: number): InsightView {
  const p = s.params;
  const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : null);
  const params: Record<string, string | number> = {};
  const nested: Record<string, StringKey> = {};
  if (typeof p['symbol'] === 'string') params['symbol'] = p['symbol'];
  if (num('usd') !== null) params['usd'] = formatUsd(num('usd') as number);
  if ('ratio' in p) params['ratio'] = num('ratio') === null ? '—' : `×${(num('ratio') as number).toFixed(1)}`;
  for (const k of ['oiPct', 'pricePct', 'altGapPct']) if (num(k) !== null) params[k] = signedPct(num(k)) as string;
  if (num('rate') !== null) params['rate'] = fundingPct(num('rate')) as string;
  for (const k of ['count', 'total', 'minutes', 'upPct']) if (num(k) !== null) params[k] = num(k) as number;
  for (const k of ['global', 'top']) if (num(k) !== null) params[k] = (num(k) as number).toFixed(2);
  if (typeof p['side'] === 'string') nested['side'] = `insight.side.${p['side']}` as StringKey;
  if (typeof p['quadrant'] === 'string') nested['quadrant'] = `insight.quadrant.${p['quadrant']}` as StringKey;
  nested['fng'] = typeof p['fngBand'] === 'string' ? (`kpi.ctx.fng.${p['fngBand']}` as StringKey) : 'insight.fng.none';
  return {
    key: s.key as StringKey,
    params,
    nested,
    basis: basisView(s.basis, nowSec),
    link: 'anchor' in s.link
      ? { anchor: s.link.anchor }
      : { commands: ['/instrument', s.link.symbol], queryParams: linkQuery(s, s.link.timeSec) },
  };
}

/** D3's basis line: «за 24ч · binance+bybit+okx · выборка 30 (22 с данными) · с 2026-10-04». */
export function basisView(b: WebInsightBasis | null, _nowSec: number): { key: StringKey; params: Record<string, string | number> } {
  if (!b) return { key: 'insight.basis.none', params: {} };
  return {
    key: 'insight.basis',
    params: {
      window: b.window,
      venues: b.venues.join('+'),
      sample: b.sampleWindows,
      observed: b.observedWindows,
      from: b.from === null ? '—' : new Date(b.from * 1000).toISOString().slice(0, 10),
    },
  };
}

/** The words of an insight: its nested keys translated INTO its params first (a side, a quadrant). */
export function wordInsight(v: Pick<InsightView, 'key' | 'params' | 'nested'>, t: (key: StringKey, params?: Record<string, string | number>) => string): string {
  const params: Record<string, string | number> = { ...v.params };
  for (const [name, key] of Object.entries(v.nested)) params[name] = t(key);
  return t(v.key, params);
}

export type ConclusionView =
  | { kind: 'statement'; view: InsightView }
  | { kind: 'neutral'; key: StringKey; basis: { key: StringKey; params: Record<string, string | number> } | null };

/**
 * D15 — a block's one conclusion line: its best statement, or the neutral line with the REASON
 * (nothing unusual over the period / not enough history / no rules for this block yet) and the
 * basis it stood on. Null before insights have loaded: the line is absent, not «nothing unusual».
 */
export function conclusionView(line: WebInsightBlockLine | null | undefined, nowSec: number): ConclusionView | null {
  if (!line) return null;
  if (line.statement) return { kind: 'statement', view: insightView(line.statement, nowSec) };
  if (!line.neutral) return null;
  // a reason with no basis (no rules for this block) says only the reason: «основа не указана» says nothing
  const basis = line.neutral.basis ? basisView(line.neutral.basis, nowSec) : null;
  return { kind: 'neutral', key: `insight.neutral.${line.neutral.reason}` as StringKey, basis };
}

/**
 * IB-BUG-022 — which neutral line «Главное сейчас» shows when nothing is sent. An unavailable
 * period (D14: not a full window of tape yet) is said as that, with its date, and never as
 * «ничего необычного», which would be a claim about a market nobody looked at. Then thin
 * history, then «nothing unusual». `basis` is false for the unavailability: there was none.
 */
export function neutralLine(
  unavailableFromDay: string | null, history: boolean,
): { key: 'insight.neutral.unavailable' | 'insight.neutral.insufficient_history' | 'insight.neutral.nothing_unusual'; date: string | null; basis: boolean } {
  if (unavailableFromDay !== null) return { key: 'insight.neutral.unavailable', date: unavailableFromDay, basis: false };
  if (history) return { key: 'insight.neutral.insufficient_history', date: null, basis: true };
  return { key: 'insight.neutral.nothing_unusual', date: null, basis: true };
}
