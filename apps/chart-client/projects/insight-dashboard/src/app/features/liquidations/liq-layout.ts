import {
  WEB_MARKET_PERIOD_SECONDS, venueName,
  type WebLiquidationsOverviewResponse,
  type WebLiquidationCoinPeriod,
  type WebLiquidationHourly,
  type WebLiquidationFeedEvent,
  type WebLiquidationLargeEvent,
  type WebLiquidationNormBasis,
  type WebMarketPeriod,
} from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';
import { formatRatio, formatUsd } from './liquidations.format';
import { presentNote, venueNote, type VenueNote } from './venue-note';

/**
 * IB-089 (market-page design D8, D12) — every number the liquidation charts draw, computed here
 * and nowhere else. The components only place what these functions return.
 *
 * One orientation for the whole block: **shorts above the axis, longs below**, and the colour
 * follows the market, not the noun (a long liquidated is price falling: red; IB-031's rule).
 * Coordinates are CSS pixels of the box the chart is given, so SVG text is never stretched.
 */

export interface Size {
  width: number;
  height: number;
}

/** Room above the bars for an outlier's «×2.4», and below for the time labels. */
export const HOURLY_PAD_TOP = 16;
export const HOURLY_PAD_BOTTOM = 18;
/** The narrowest gap between two time labels, in px — about «18:00» at 12 px plus air. */
export const TICK_MIN_GAP_PX = 52;

export interface HourBarView {
  time: number;
  x: number;
  w: number;
  shortY: number;
  shortH: number;
  longY: number;
  longH: number;
  partial: boolean;
  outlier: boolean;
  /** This bucket's total ÷ the per-bucket norm; null when partial or there is no norm. */
  ratio: number | null;
}

export interface HourlyLayout {
  axisY: number;
  bars: HourBarView[];
  /** The norm per side as a line; null for a side without a norm (the note says why). */
  norm: { shortY: number | null; longY: number | null };
  callouts: Array<{ x: number; text: string }>;
  ticks: Array<{ x: number; time: number }>;
  /** Nothing liquidated in the whole window: the chart says so instead of drawing a flat axis. */
  empty: boolean;
}

/** D8(a): the mirrored bars. One scale for both sides, so a short bar and a long bar compare. */
export function hourlyLayout(hourly: WebLiquidationHourly, size: Size): HourlyLayout {
  const n = hourly.buckets.length;
  const plotH = Math.max(0, size.height - HOURLY_PAD_TOP - HOURLY_PAD_BOTTOM);
  const half = plotH / 2;
  const axisY = HOURLY_PAD_TOP + half;
  const values = hourly.buckets.flatMap((b) => [b.long, b.short]);
  const max = Math.max(0, ...values, hourly.norm.long ?? 0, hourly.norm.short ?? 0);
  const k = max > 0 ? half / max : 0;
  const slot = n > 0 ? size.width / n : 0;
  const w = Math.max(1, slot * 0.72);

  const bars = hourly.buckets.map((b, i): HourBarView => {
    const shortH = b.short * k;
    const total = hourly.norm.total;
    return {
      time: b.time,
      x: i * slot + (slot - w) / 2,
      w,
      shortY: axisY - shortH,
      shortH,
      longY: axisY,
      longH: b.long * k,
      partial: b.partial,
      outlier: b.outlier,
      ratio: !b.partial && total !== null && total > 0 ? (b.long + b.short) / total : null,
    };
  });

  return {
    axisY,
    bars,
    norm: {
      shortY: hourly.norm.short === null ? null : axisY - hourly.norm.short * k,
      longY: hourly.norm.long === null ? null : axisY + hourly.norm.long * k,
    },
    callouts: bars
      .filter((b) => b.outlier && b.ratio !== null)
      .map((b) => ({ x: b.x + b.w / 2, text: formatRatio(b.ratio) as string })),
    ticks: ticks(hourly.buckets.map((b) => b.time), slot, (i) => i * slot + slot / 2),
    empty: max === 0,
  };
}

/** Every k-th position, so labels are at least `TICK_MIN_GAP_PX` apart at this width. */
function ticks(times: number[], slot: number, xOf: (i: number) => number): Array<{ x: number; time: number }> {
  if (times.length === 0 || slot <= 0) return [];
  const step = Math.max(1, Math.ceil(TICK_MIN_GAP_PX / slot));
  const out: Array<{ x: number; time: number }> = [];
  for (let i = times.length - 1; i >= 0; i -= step) out.unshift({ x: xOf(i), time: times[i] });
  return out;
}

/**
 * A time label: `18:00` for hourly buckets, `03.11 16:00` for the 7d chart's 4-hour ones. The
 * member's clock (the feed it replaces did the same); `timeZone` exists for the spec.
 */
export function tickLabel(time: number, bucketSec: number, timeZone?: string): string {
  const d = new Date(time * 1000);
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
  if (bucketSec <= 3_600) return hm;
  const dm = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', timeZone });
  return `${dm} ${hm}`;
}

export interface WhereRow {
  symbol: string;
  base: string;
  /** The coin's liquidation total for the period: the ranking key, and what «ещё K · $X» sums (IB-101). */
  usd: number;
  long: number;
  short: number;
  /** Bar lengths as % of the widest side of any row: one scale, so rows compare. */
  longPct: number;
  shortPct: number;
  verdict: { key: StringKey; params: { ratio: string } } | null;
}

/**
 * D8(b): the diverging bars — longs to the left, shorts to the right, biggest coin first. A coin
 * with nothing in the period is left out and counted (`quiet`), not drawn as an empty row.
 */
export function whereRows(perCoin: readonly WebLiquidationCoinPeriod[]): { rows: WhereRow[]; quiet: number } {
  const active = perCoin.filter((c) => c.totals.usd > 0).sort((a, b) => b.totals.usd - a.totals.usd);
  const max = Math.max(0, ...active.flatMap((c) => [c.totals.long, c.totals.short]));
  const pct = (v: number) => (max > 0 ? (v / max) * 100 : 0);
  return {
    quiet: perCoin.length - active.length,
    rows: active.map((c) => ({
      symbol: c.symbol,
      base: c.base,
      usd: c.totals.usd,
      long: c.totals.long,
      short: c.totals.short,
      longPct: pct(c.totals.long),
      shortPct: pct(c.totals.short),
      verdict: c.verdict === null ? null : {
        key: c.verdict.side === 'long' ? 'liq.verdict.long' : 'liq.verdict.short',
        params: { ratio: formatRatio(c.verdict.ratio) as string },
      },
    })),
  };
}

export const BUBBLE_R_MIN = 3;
export const BUBBLE_R_MAX = 18;
export const BUBBLE_PAD_X = 20;
/**
 * IB-BUG-036 — the circles carry a 1 px stroke, half of it outside the radius: the outermost bubble
 * of a column stops this far from the edge (top) or the label band (bottom), so it is never cut.
 */
export const BUBBLE_EDGE_PAD = 1;
/** A time label's glyph advance: the axis font is IBM Plex Mono 12 px, 600/1000 em a glyph. */
export const TICK_CHAR_PX = 7.2;
/**
 * The least empty space between two neighbouring labels. A 390 px phone gives the chart 324–332 px
 * (measured 2026-11-05, IB-BUG-036), a day 41 px: 7d labels every other day there, one a day at 1240.
 */
export const TICK_AIR_PX = 8;

export interface BubbleView<E extends WebLiquidationFeedEvent = WebLiquidationFeedEvent> {
  event: E;
  cx: number;
  cy: number;
  r: number;
}

export interface BubbleTick {
  /** The label's centre (`text-anchor: middle`). */
  x: number;
  time: number;
  label: string;
}

/** The member's clock, as seconds east of UTC at an instant. A spec passes a fixed one. */
export type UtcOffset = (timeSec: number) => number;
export const LOCAL_OFFSET: UtcOffset = (t) => -new Date(t * 1000).getTimezoneOffset() * 60;

export interface BubbleAxis {
  /** IB-BUG-036: the 7d chart labels days (`DD/MM`, one per local midnight), not `DD/MM HH:MM`. */
  days: boolean;
  offset: UtcOffset;
}

/**
 * D8(c): the bubble timeline over the period. Radius ∝ √USD (area ∝ money), shorts above the axis,
 * longs below. A bubble that would overlap one already placed on its side moves outward, so a
 * cascade reads as a column rather than one blot; the biggest are placed first, nearest the axis.
 */
export function bubbleLayout<E extends WebLiquidationFeedEvent>(
  large: readonly E[],
  window: { from: number; to: number },
  size: Size,
  axis: BubbleAxis = { days: false, offset: LOCAL_OFFSET },
): { axisY: number; bubbles: Array<BubbleView<E>>; ticks: BubbleTick[] } {
  const axisY = (size.height - HOURLY_PAD_BOTTOM) / 2;
  const span = Math.max(1, window.to - window.from);
  const plotW = Math.max(0, size.width - 2 * BUBBLE_PAD_X);
  const xOf = (t: number) => BUBBLE_PAD_X + (Math.min(Math.max(t, window.from), window.to) - window.from) / span * plotW;
  const usdMax = Math.max(0, ...large.map((e) => e.usd));
  const rMax = Math.min(BUBBLE_R_MAX, Math.max(BUBBLE_R_MIN, axisY / 2));
  const placed: Array<BubbleView<E> & { offset: number; up: boolean }> = [];

  for (const event of [...large].sort((a, b) => b.usd - a.usd)) {
    const r = usdMax > 0 ? Math.max(BUBBLE_R_MIN, rMax * Math.sqrt(event.usd / usdMax)) : BUBBLE_R_MIN;
    const cx = xOf(event.time);
    const up = event.side === 'short';
    let offset = r + 2;
    for (const p of placed) {
      if (p.up === up && Math.abs(p.cx - cx) < p.r + r) offset = Math.max(offset, p.offset + p.r + r + 1);
    }
    // Room on this side, from the axis to the top edge (shorts) or to the label band (longs).
    const room = up ? axisY : size.height - HOURLY_PAD_BOTTOM - axisY;
    offset = Math.min(offset, Math.max(r, room - r - BUBBLE_EDGE_PAD));
    placed.push({ event, cx, cy: up ? axisY - offset : axisY + offset, r, offset, up });
  }

  const times = axis.days
    ? localMidnights(window, axis.offset)
    : evenTimes(window, Math.max(1, Math.floor(plotW / (TICK_MIN_GAP_PX * 1.6))));
  return {
    axisY,
    bubbles: placed.map(({ event, cx, cy, r }) => ({ event, cx, cy, r })),
    ticks: spacedTicks(times.map((time) => ({ time, x: xOf(time), label: axisLabel(time, axis) }))),
  };
}

function evenTimes(window: { from: number; to: number }, count: number): number[] {
  const span = Math.max(1, window.to - window.from);
  return Array.from({ length: count + 1 }, (_, i) => Math.round(window.from + (span * i) / count));
}

/** Every local midnight inside the window: the instants a day label belongs to. */
function localMidnights(window: { from: number; to: number }, offset: UtcOffset): number[] {
  const out: number[] = [];
  let off = offset(window.from);
  for (let day = Math.floor((window.from + off) / 86_400) + 1; ; day++) {
    off = offset(day * 86_400 - off);
    const t = day * 86_400 - off;
    if (t > window.to) return out;
    if (t >= window.from) out.push(t);
  }
}

/** `HH:MM`, or `DD/MM` on the day axis — on the member's clock. */
function axisLabel(time: number, axis: BubbleAxis): string {
  const d = new Date((time + axis.offset(time)) * 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  return axis.days
    ? `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}`
    : `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/**
 * IB-BUG-036: walking back from the newest, a label too close to the one kept after it is dropped.
 * Edge labels need no nudging: `BUBBLE_PAD_X` (20 px) holds half of a 5-glyph label (18 px), and the
 * spec fails the day a longer format (the old `DD/MM HH:MM`, cut at both ends) comes back.
 */
function spacedTicks(ticks: BubbleTick[]): BubbleTick[] {
  const half = (t: BubbleTick) => (t.label.length * TICK_CHAR_PX) / 2;
  const kept: BubbleTick[] = [];
  for (let i = ticks.length - 1; i >= 0; i--) {
    const t = ticks[i];
    const next = kept[0];
    if (next === undefined || next.x - half(next) - (t.x + half(t)) >= TICK_AIR_PX) kept.unshift(t);
  }
  return kept;
}

/** The instrument at an event's minute: IB-088's link format, `/instrument/<sym>?at=<unix sec>`. */
export interface InstrumentLink {
  commands: string[];
  queryParams: { at: number };
}

/** One builder for every liquidation that opens the chart: Market's bubbles and cards, /liquidations' rows. */
export function instrumentLink(event: Pick<WebLiquidationFeedEvent, 'symbol' | 'time'>): InstrumentLink {
  return { commands: ['/instrument', event.symbol], queryParams: { at: event.time } };
}

export interface LargeCard {
  event: WebLiquidationLargeEvent;
  /** «×180 медианы»; null under 7 days of history (the block's note says so once). */
  xMedian: { key: StringKey; params: { x: string } } | null;
  /** «серия: 4 за 9 мин» for an event in an R3 cascade. */
  series: { key: StringKey; params: { count: number; minutes: number } } | null;
  link: InstrumentLink;
  /** The venue as its owner spells it («OKX»), never the key (IB-BUG-033). */
  venue: string;
}

/**
 * D8(c): the cards under the timeline, biggest first. The link is IB-088's format exactly —
 * `/instrument/<sym>?at=<unix sec>` (Architect note 2026-11-03: no new format).
 */
export function largeCards(large: readonly WebLiquidationLargeEvent[]): LargeCard[] {
  return [...large].sort((a, b) => b.usd - a.usd || b.time - a.time).map((event) => ({
    event,
    xMedian: event.xMedian === null ? null : { key: 'liq.large.xMedian', params: { x: formatRatio(event.xMedian) as string } },
    series: event.seriesId === null || event.seriesCount < 3 ? null : {
      key: 'liq.large.series',
      params: { count: event.seriesCount, minutes: Math.max(1, Math.round(event.seriesSpanSec / 60)) },
    },
    link: instrumentLink(event),
    venue: venueName(event.venue),
  }));
}

/**
 * IB-108 (§7.6) replaced the phone-only limit of 5 (TL 2026-11-03: the 4 900 px page) with IB-101's
 * fold at every width: the first `WHERE_TOP_N` (8) cards, the rest behind «показать все»
 * (`liq-where-collapse.ts`, the same rule and the same minimum of 3 hidden).
 */

export interface NormNote {
  key: StringKey;
  params: Record<string, string | number>;
}

/**
 * Why a chart has no norm line or no «×», in words — never an empty space (task: «честность»).
 * - 7d: always refused (D14: 30 days hold four weeks, which is not a norm);
 * - first week of the box: the day it will appear, which is when 7 days of tape exist —
 *   `availableFrom['7d']` is exactly that day;
 * - `no_norm`: most windows are empty, so there is nothing to divide by;
 * - a norm: what it is — median of how many windows, how many held data.
 */
export function normNote(
  basis: WebLiquidationNormBasis,
  period: WebMarketPeriod,
  weekFrom: number | null,
  nowSec: number,
): NormNote {
  if (period === '7d') return { key: 'liq.norm.week', params: {} };
  if (basis.unavailable === 'insufficient_history') {
    return weekFrom !== null && weekFrom > nowSec
      ? { key: 'liq.norm.from', params: { date: new Date(weekFrom * 1000).toISOString().slice(0, 10) } }
      : { key: 'liq.norm.noHistory', params: {} };
  }
  if (basis.unavailable === 'no_norm') {
    return { key: 'liq.norm.noNorm', params: { observed: basis.windowsObserved, total: basis.windowsInPeriod } };
  }
  return { key: 'liq.norm.median', params: { days: Math.round(basis.periodDays), observed: basis.windowsObserved, total: basis.windowsInPeriod } };
}

export interface BlockView {
  totals: { usd: string; long: string; short: string; events: number };
  /** The bubble chart's time axis: the period ending at the response's `asOf`. */
  window: { from: number; to: number };
  hourlyNote: NormNote;
  whereNote: NormNote;
  /** Why some cards have no «× медианы» (the first week); null when every card has one. */
  largeNote: NormNote | null;
  /** Venues we collect from that wrote nothing: said on the block, not implied by silence (§12.4). */
  venues: VenueNote | null;
  /** …and the venues the figures DID come from, always, so three venues never read as "all". */
  present: VenueNote | null;
  /** D6: TradFi and unclassified rows are outside every total, and said so in one line each. */
  tradfi: NormNote | null;
  unknown: NormNote | null;
}

/** IB-089 — the block's own facts, around the three charts. */
export function blockView(o: WebLiquidationsOverviewResponse, period: WebMarketPeriod, nowSec: number): BlockView {
  const b = o.block;
  const weekFrom = b.availableFrom['7d'] ?? null;
  return {
    totals: { usd: formatUsd(b.totals.usd), long: formatUsd(b.totals.long), short: formatUsd(b.totals.short), events: b.totals.events },
    window: { from: o.asOf - WEB_MARKET_PERIOD_SECONDS[period], to: o.asOf },
    hourlyNote: normNote(b.hourly.basis, period, weekFrom, nowSec),
    whereNote: normNote(b.basis, period, weekFrom, nowSec),
    largeNote: b.large.some((e) => e.xMedian === null) ? normNote({ ...b.hourly.basis, unavailable: b.hourly.basis.unavailable ?? 'insufficient_history' }, '24h', weekFrom, nowSec) : null,
    venues: venueNote(o.venues),
    present: presentNote(o.venues),
    tradfi: b.tradfi.usd > 0 ? { key: 'liq.tradfi', params: { usd: formatUsd(b.tradfi.usd) } } : null,
    unknown: b.unknown.usd > 0 ? { key: 'liq.unknown', params: { usd: formatUsd(b.unknown.usd), events: b.unknown.events } } : null,
  };
}
