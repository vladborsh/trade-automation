import type { WebFlowsChange, WebFlowsPoint, WebFlowsResponse, WebFlowsUnavailable, WebMarketPeriod } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';
import { formatUsd } from '../liquidations/liquidations.format';
import { signedPct } from '../market/shell/market-text';

/**
 * IB-091 — «Деривативы и потоки»: the four tiles as views, pure. The template only places them;
 * every number shown on a tile is decided here, with its spec.
 */
export type TileId = 'dvol' | 'putCall' | 'stablecoins' | 'coinbasePremium';
export type Tone = 'up' | 'down' | 'flat';

export interface Words {
  key: StringKey;
  params: Record<string, string | number>;
}

export interface TileView {
  id: TileId;
  title: StringKey;
  /** The big figure, already formatted; null when the tile has none (then `reason` says why). */
  value: string | null;
  /** The change or the ratio's companion line, worded; null when there is none. */
  detail: Words | null;
  tone: Tone;
  /** D2 rarity ≥ 0.90 on the tile's change. */
  unusual: boolean;
  /** What the number means (the premium's says "against the dollar, USDT corrected", D18). */
  note: Words;
  reason: Words | null;
  series: WebFlowsPoint[];
  /** The mini-chart's colour follows the tile's direction where it has one. */
  lineColour: string;
}

/** D2's show threshold, the same number the insight engine gates on. */
export const UNUSUAL = 0.9;
const UP = '#26a69a';
const DOWN = '#ef5350';
const NEUTRAL = '#8b949e';

const toneOf = (v: number | null | undefined): Tone => (v === null || v === undefined || v === 0 ? 'flat' : v > 0 ? 'up' : 'down');
const colourOf = (t: Tone) => (t === 'up' ? UP : t === 'down' ? DOWN : NEUTRAL);
const unusual = (c: WebFlowsChange | null) => c !== null && c.rarity !== null && c.rarity >= UNUSUAL;
const reasonWords = (r: WebFlowsUnavailable | null, minutes = 0): Words | null =>
  r === null ? null : { key: `flows.reason.${r}` as StringKey, params: { minutes } };
/** A signed USD amount with the page's minus sign («−», as `signedPct`), never the ASCII hyphen. */
export const signedUsd = (v: number): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatUsd(Math.abs(v))}`;
const day = (sec: number | null) => (sec === null ? '—' : new Date(sec * 1000).toISOString().slice(0, 10));

export function flowsTiles(r: WebFlowsResponse, period: WebMarketPeriod): TileView[] {
  const dv = r.dvol;
  const dvTone = toneOf(dv.change?.value);
  const pc = r.putCall;
  const sc = r.stablecoins;
  const scTone = toneOf(sc.changeUsd?.value);
  const pr = r.coinbasePremium;
  // D18: with too few valid minutes the value stands but no sign is called — so no colour either
  const prTone = pr.unavailable === 'insufficient_minutes' ? 'flat' : toneOf(pr.premiumPct?.value);
  return [
    {
      id: 'dvol', title: 'flows.dvol.title', tone: dvTone, unusual: unusual(dv.change),
      value: dv.value === null ? null : dv.value.toFixed(1),
      detail: dv.change ? { key: 'flows.dvol.change', params: { change: `${dv.change.value > 0 ? '+' : ''}${dv.change.value.toFixed(1)}`, period } } : null,
      note: { key: 'flows.dvol.note', params: {} },
      reason: reasonWords(dv.unavailable), series: dv.series, lineColour: colourOf(dvTone),
    },
    {
      id: 'putCall', title: 'flows.putCall.title', tone: 'flat', unusual: false,
      value: pc.oiRatio === null ? null : pc.oiRatio.toFixed(2),
      detail: null,
      note: { key: 'flows.putCall.note', params: { date: day(pc.asOf), volume: pc.volumeRatio === null ? '—' : pc.volumeRatio.toFixed(2) } },
      reason: reasonWords(pc.unavailable), series: pc.series, lineColour: NEUTRAL,
    },
    {
      id: 'stablecoins', title: 'flows.stable.title', tone: scTone, unusual: unusual(sc.changeUsd),
      value: sc.supplyUsd === null ? null : formatUsd(sc.supplyUsd),
      detail: sc.changeUsd ? {
        key: 'flows.stable.change',
        params: { usd: signedUsd(sc.changeUsd.value), pct: signedPct(sc.changePct) ?? '—', days: sc.changeDays },
      } : null,
      note: { key: 'flows.stable.note', params: {} },
      reason: reasonWords(sc.unavailable), series: sc.series, lineColour: colourOf(scTone),
    },
    {
      id: 'coinbasePremium', title: 'flows.premium.title', tone: prTone,
      unusual: pr.unavailable === null && unusual(pr.premiumPct),
      value: pr.premiumPct === null ? null : signedPct(pr.premiumPct.value, 3),
      detail: pr.premiumPct && pr.unavailable === null ? { key: 'flows.premium.minutes', params: { same: pr.sameSignMinutes, minutes: pr.minutes } } : null,
      note: { key: 'flows.premium.note', params: {} },
      reason: reasonWords(pr.unavailable, pr.minutes), series: pr.series, lineColour: colourOf(prTone),
    },
  ];
}

/** The attribution line: every source the block shows, once, in tile order. */
export function sourceNames(r: WebFlowsResponse): string {
  return [...new Set([r.dvol.source.name, r.putCall.source.name, r.stablecoins.source.name, r.coinbasePremium.source.name])].join(' · ');
}
