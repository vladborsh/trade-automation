import type { WebInsightBasis, WebInsightBlock, WebInsightChart, WebInsightStatement } from '@trade-automation/contracts';
import { venueName } from '@trade-automation/contracts';
import type { StringKey } from '../../../i18n/keys';
import { formatUsd } from '../../liquidations/liquidations.format';
import { fundingPct, insightView, signedPct } from './market-text';

/**
 * IB-107 (market-page design §7.3, §7.4, D20) — one «Главное сейчас» card, pure and spec'd: the topic
 * chip, «when», the member-language title and explanation (what the number MEANS, never a forecast —
 * D20), the chart (IB-119), a link label that says where it goes, and the quiet basis with the sample sizes
 * kept for the tooltip. The server sends keys and numbers; the wording is chosen here by sign and side.
 */

/** A phrase to translate: a key, its params, and keys whose translation goes INTO a param. */
export interface Phrase {
  key: StringKey;
  params: Record<string, string | number>;
  nested: Record<string, StringKey>;
}

/**
 * IB-BUG-035 — where a card's link goes. A `route` is a router link; a `block` is a section of the
 * Market page, by its element id. Never a bare `href="#id"`: under `<base href="/">` that resolves to
 * `/#id` and leaves the page (the «К позициям ↓» link that led nowhere).
 */
export type CardLinkTarget =
  | { kind: 'route'; commands: string[]; queryParams: Record<string, number | string> | null }
  | { kind: 'block'; id: WebInsightBlock };

/**
 * IB-BUG-035 — the blocks that have a page of their own: the card goes there, not to the Market
 * section. Positioning since IB-103 (Market keeps a compact top 5; «Все монеты →» opens the page
 * with the card's period).
 */
const BLOCK_PAGES: Partial<Record<WebInsightBlock, string>> = { positioning: '/positioning' };

/** A statement's link (`insightView`'s) → the card's target: a block with a page becomes a route to it. */
export function cardLinkTarget(s: WebInsightStatement, nowSec: number): CardLinkTarget {
  const link = insightView(s, nowSec).link;
  if ('commands' in link) return { kind: 'route', ...link };
  const block = link.anchor as WebInsightBlock;
  const page = BLOCK_PAGES[block];
  return page === undefined
    ? { kind: 'block', id: block }
    : { kind: 'route', commands: [page], queryParams: { p: s.basis.window } };
}

/** The chip colours of §7.2: liquidations by side (`liq` without one), else by block. */
export type ChipTone = 'long' | 'short' | 'liq' | 'pos' | 'sent' | 'flows' | 'caps';

export interface CardView {
  chip: { key: StringKey; tone: ChipTone };
  when: Phrase;
  title: Phrase;
  /** The formatted figures inside the title, drawn in the number face (D23). */
  figures: string[];
  explanation: Phrase[];
  /** IB-119: the server's chart, drawn beside the text; null is no chart, the text stands alone. */
  chart: WebInsightChart | null;
  link: { label: Phrase; target: CardLinkTarget };
  basis: Phrase;
  basisTip: Phrase;
}

const phrase = (key: string, params: Record<string, string | number> = {}, nested: Record<string, string> = {}): Phrase =>
  ({ key: key as StringKey, params, nested: nested as Record<string, StringKey> });
const windowWord = (b: WebInsightBasis) => `market.period.${b.window}`;

/** «BTCUSDT» → «BTC»: the quote suffix is not part of what a member calls the coin. */
export function baseOf(symbol: string): string {
  const base = symbol.replace(/(USDT|USDC|FDUSD|BUSD|USD)$/, '');
  return base.length > 0 ? base : symbol;
}

/** «5×», «4.2×» → the number part: one decimal under 10, none above (as `formatUsd` does). */
export function ratioText(ratio: number): string {
  return ratio < 10 ? ratio.toFixed(1).replace(/\.0$/, '') : String(Math.round(ratio));
}

/** HH:MM of a UTC moment. */
export function hhmm(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(11, 16);
}

export function chipOf(s: Pick<WebInsightStatement, 'block' | 'params'>): CardView['chip'] {
  const tone: Record<WebInsightBlock, ChipTone> = { liquidations: 'liq', positioning: 'pos', sentiment: 'sent', flows: 'flows', caps: 'caps' };
  const side = s.params['side'];
  return {
    key: `card.chip.${s.block}` as StringKey,
    tone: s.block === 'liquidations' && (side === 'long' || side === 'short') ? side : tone[s.block],
  };
}

/** The statements whose link time is the START of the period they measure (IB-BUG-023): their «when» is the window. */
const PERIOD_START = new Set(['R4']);

/**
 * «when»: the moment the link points at («сегодня 03:00 UTC», «вчера …», or the date), R10 «последний
 * час», R9 «за сутки | за неделю», everything else the basis window («за 24ч»).
 */
export function whenOf(s: WebInsightStatement, nowSec: number): Phrase {
  if (s.ruleId === 'R10') return phrase('card.when.last_hour');
  if (s.ruleId === 'R9') return phrase(s.params['days'] === 7 ? 'card.when.week' : 'card.when.day');
  if ('route' in s.link && s.link.timeSec !== null && !PERIOD_START.has(s.ruleId)) {
    const day = (sec: number) => Math.floor(sec / 86_400);
    const ago = day(nowSec) - day(s.link.timeSec);
    const time = hhmm(s.link.timeSec);
    if (ago === 0) return phrase('card.when.today', { time });
    if (ago === 1) return phrase('card.when.yesterday', { time });
    return phrase('card.when.date', { time, date: new Date(s.link.timeSec * 1000).toISOString().slice(0, 10) });
  }
  return phrase('card.when.window', {}, { window: windowWord(s.basis) });
}

/** The link's label says where it goes (§7.3): the coin at a moment, over the window, on the chart, or the block. */
export function linkLabel(s: WebInsightStatement): Phrase {
  if ('anchor' in s.link) return phrase(`card.link.anchor.${s.link.anchor}`);
  const base = baseOf(s.link.symbol);
  if (s.link.timeSec === null) return phrase('card.link.chart', { base });
  if (PERIOD_START.has(s.ruleId)) return phrase('card.link.window', { base }, { window: windowWord(s.basis) });
  return phrase('card.link.at', { base, time: hhmm(s.link.timeSec) });
}

/** The quiet line («за 24ч · Binance») and its tooltip with the sample sizes and the start. */
export function basisOf(b: WebInsightBasis): { basis: Phrase; tip: Phrase } {
  const venues = b.venues.map(venueName).join(', ');
  const counts = { observed: b.observedWindows, sample: b.sampleWindows };
  return {
    basis: phrase('card.basis', { venues }, { window: windowWord(b) }),
    tip: b.from === null
      ? phrase('card.basis.tip_nofrom', counts)
      : phrase('card.basis.tip', { ...counts, from: new Date(b.from * 1000).toISOString().slice(0, 10) }),
  };
}

/** Title + explanation by rule, the variant chosen by sign and side (§7.4). */
export function wordingOf(s: WebInsightStatement): { title: Phrase; figures: string[]; explanation: Phrase[] } {
  const p = s.params;
  const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : null);
  const w = { window: windowWord(s.basis) };
  const usd = num('usd');
  const usdText = usd === null ? '' : formatUsd(Math.abs(usd));
  const ratio = num('ratio');
  const symbol = typeof p['symbol'] === 'string' ? p['symbol'] : '';
  const base = baseOf(symbol);
  const side = p['side'] === 'short' ? 'short' : 'long';
  switch (s.key) {
    case 'insight.liq_surge': {
      const r = ratio === null ? null : ratioText(ratio);
      return {
        title: phrase(`card.liq_surge.${r === null ? 'title_bare' : 'title'}.${side}`, { usd: usdText, ratio: r ?? '' }, w),
        figures: [usdText, ...(r === null ? [] : [`${r}×`])],
        explanation: [
          // {norm} = usd / ratio; the clause goes with a missing ratio
          ...(ratio === null || ratio <= 0 || usd === null ? [] : [phrase(`card.liq_surge.norm.${side}`, { norm: formatUsd(usd / ratio) }, w)]),
          phrase('card.liq_surge.expl'),
        ],
      };
    }
    case 'insight.liq_coin': {
      const r = ratio === null ? null : ratioText(ratio);
      return {
        title: phrase(r === null ? 'card.liq_coin.title_bare' : 'card.liq_coin.title', { base, usd: usdText, ratio: r ?? '' }, w),
        figures: [usdText, ...(r === null ? [] : [`${r}×`])],
        explanation: [
          ...(ratio === null || ratio <= 0 || usd === null ? [] : [phrase('card.liq_coin.norm', { base, norm: formatUsd(usd / ratio) }, w)]),
          phrase('card.liq_coin.expl'),
        ],
      };
    }
    case 'insight.liq_cascade':
      return {
        title: phrase(`card.liq_cascade.title.${side}`, { count: num('count') ?? 0, minutes: num('minutes') ?? 0, usd: usdText }),
        figures: [String(num('count') ?? 0), usdText],
        explanation: [phrase('card.liq_cascade.expl', { base })],
      };
    case 'insight.oi_vs_price': {
      const oi = signedPct(num('oiPct'), 1) ?? '—';
      const price = signedPct(num('pricePct'), 1) ?? '—';
      const q = p['quadrant'];
      return {
        title: phrase('card.oi_vs_price.title', { base, oiPct: oi, pricePct: price }),
        figures: [oi, price],
        explanation: [
          phrase('card.oi_vs_price.expl', { base }, w),
          ...(typeof q === 'string' && q !== 'flat' ? [phrase(`card.oi_vs_price.q.${q}`)] : []),
        ],
      };
    }
    case 'insight.funding_extremes': {
      const rate = num('rate') ?? 0;
      const sign = rate < 0 ? 'neg' : 'pos';
      const rateText = fundingPct(rate) ?? '—';
      const count = num('count') ?? 1;
      // IB-135 (TL): the raw rate is per the coin's own interval; say it when that is not the usual 8 h
      const h = num('intervalH');
      const perInterval = h !== null && h !== 8;
      return {
        title: perInterval
          ? phrase(`card.funding_extremes.title_interval.${sign}`, { base, rate: rateText, h })
          : phrase(`card.funding_extremes.title.${sign}`, { base, rate: rateText }),
        figures: [rateText],
        explanation: [
          phrase(`card.funding_extremes.expl.${sign}`, { base }),
          ...(count > 1 ? [phrase('card.funding_extremes.more', { more: count - 1, total: num('total') ?? count })] : []),
        ],
      };
    }
    case 'insight.crowd_vs_top': {
      const global = num('global') ?? 1;
      return {
        title: phrase(`card.crowd_vs_top.title.${global > 1 ? 'crowd_long' : 'crowd_short'}`, { base }),
        figures: [],
        explanation: [phrase('card.crowd_vs_top.expl', { base, global: global.toFixed(2), top: (num('top') ?? 1).toFixed(2) })],
      };
    }
    case 'insight.breadth': {
      const gap = num('altGapPct') ?? 0;
      const gapText = Math.abs(gap).toFixed(1);
      const band = p['fngBand'];
      return {
        title: phrase(`card.breadth.title.${gap >= 0 ? 'ahead' : 'behind'}`, { upPct: num('upPct') ?? 0, gap: gapText }),
        figures: [`${num('upPct') ?? 0}`, gapText],
        explanation: [
          phrase('card.breadth.expl', {}, w),
          ...(typeof band === 'string' ? [phrase('card.breadth.fng', {}, { fng: `kpi.ctx.fng.${band}` })] : []),
        ],
      };
    }
    case 'insight.dvol_spike': {
      const value = String(Math.round(num('value') ?? 0));
      const change = Math.abs(num('change') ?? 0).toFixed(1);
      return { title: phrase('card.dvol_spike.title', { value, change }), figures: [value, `+${change}`], explanation: [phrase('card.dvol_spike.expl', {}, w)] };
    }
    case 'insight.stablecoin_supply': {
      const kind = (usd ?? 0) < 0 ? 'burn' : 'mint';
      const span = { span: num('days') === 7 ? 'card.span.week' : 'card.span.day' };
      const pct = signedPct(num('pct'), 2) ?? '—';
      return {
        title: phrase(`card.stablecoin_supply.title.${kind}`, { usd: usdText }, span),
        figures: [usdText],
        explanation: [phrase(`card.stablecoin_supply.expl.${kind}`), phrase('card.stablecoin_supply.share', { pct })],
      };
    }
    case 'insight.coinbase_premium': {
      const pct = num('pct') ?? 0;
      const text = signedPct(pct, Math.abs(pct) < 0.1 ? 3 : 2) ?? '—';
      return {
        title: phrase(`card.coinbase_premium.title.${pct > 0 ? 'above' : 'below'}`, { pct: text }),
        figures: [text],
        explanation: [phrase('card.coinbase_premium.expl', { minutes: num('minutes') ?? 0 })],
      };
    }
    case 'insight.oi_divergence': {
      // IB-113 (OI divergence design V16, D20): what happened at B against A, never what comes next
      const bull = p['direction'] !== 'bearish';
      // IB-144 (V44): a hidden divergence has its own key per direction; an absent kind (an older payload) is regular
      const dir = `${p['kind'] === 'hidden' ? 'hidden_' : ''}${bull ? 'bullish' : 'bearish'}` as const;
      const price = signedPct(num('pricePct'), 1) ?? '—';
      const oi = signedPct(num('oiPct'), 1) ?? '—';
      const tf = typeof p['tf'] === 'string' ? p['tf'] : '';
      const run = num('runLength') ?? 2;
      return {
        title: phrase(`card.oi_divergence.title.${dir}`, { base, tf, pricePct: price, oiPct: oi }),
        figures: [price, oi],
        explanation: [
          phrase(`card.oi_divergence.expl.${dir}`),
          // the count after a colon: it agrees with no noun («подряд: 3»)
          ...(run > 2 ? [phrase(`card.oi_divergence.repeat.${dir}`, { count: run })] : []),
        ],
      };
    }
    default:
      // a key this build does not word (the contract is closed; this is the type's exhaustiveness net)
      return { title: phrase(s.key), figures: [], explanation: [] };
  }
}

export function cardView(s: WebInsightStatement, nowSec: number): CardView {
  const { basis, tip: normTip } = basisOf(s.basis);
  // IB-113: an alert is an event with no norm to compare against — the tooltip says so, not «норма: 0 окон»
  const tip = s.ruleId === 'R11' ? phrase('card.basis.tip_event') : normTip;
  return {
    chip: chipOf(s),
    when: whenOf(s, nowSec),
    ...wordingOf(s),
    // the contract requires the field; an older payload without it is no chart, not a crash
    chart: s.chart ?? null,
    link: { label: linkLabel(s), target: cardLinkTarget(s, nowSec) },
    basis,
    basisTip: tip,
  };
}

/**
 * D23: the title's figures in the number face — the worded title split into text and figure runs.
 * A figure that does not occur in the text (a translation that rewrites it) simply stays text; a
 * figure's « %» unit is a text run of its own (the digits are the number, the unit is not).
 */
export function figureRuns(text: string, figures: readonly string[]): { text: string; num: boolean }[] {
  const wanted = [...new Set(figures.filter((f) => f.length > 0))].sort((a, b) => b.length - a.length);
  const out: { text: string; num: boolean }[] = [];
  let rest = text;
  while (rest.length > 0) {
    const hits = wanted.map((f) => ({ f, at: rest.indexOf(f) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at || b.f.length - a.f.length);
    const hit = hits[0];
    if (!hit) {
      out.push({ text: rest, num: false });
      break;
    }
    if (hit.at > 0) out.push({ text: rest.slice(0, hit.at), num: false });
    // TL 2026-11-04: the unit stays in the text face — in mono the space before «%» is a full cell
    const unit = /\s%$/.exec(hit.f);
    if (unit) out.push({ text: hit.f.slice(0, unit.index), num: true }, { text: unit[0], num: false });
    else out.push({ text: hit.f, num: true });
    rest = rest.slice(hit.at + hit.f.length);
  }
  return out;
}

