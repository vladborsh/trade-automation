import { venueName, type WebLiquidationEpisode, type WebLiquidationEpisodesResponse } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';
import { ruPlural } from '../market/shell/kpi-tile';
import { signedPct, toneOf, type Tone } from '../market/shell/market-text';
import { instrumentLink, tickLabel, type InstrumentLink } from './liq-layout';
import { formatPrice } from './liq-table';
import { formatUsd } from './liquidations.format';

/**
 * IB-134 (liquidation-episodes design E3–E6) — what the /liquidations episode view says, as data.
 *
 * Numbers and string KEYS, never prose (§11). The sentences with coloured or bold parts are a key
 * plus `segments()`: the template is split at its `{placeholders}`, so each language keeps its own
 * word order and the template still decides how a part looks.
 */

export interface Text {
  key: StringKey;
  params: Record<string, string | number>;
}

/**
 * The counted words, each `<key>.one|few|many` with `{n}`: Russian has three forms, English uses the
 * same three keys. Written out as template literals so the unused-key guard (no-literals.spec) sees them.
 */
type Form = ReturnType<typeof ruPlural>;
const PLURALS = {
  episodes: (f: Form) => `liqEp.episodes.${f}`,
  times: (f: Form) => `liqEp.times.${f}`,
  prints: (f: Form) => `liqEp.prints.${f}`,
  minutes: (f: Form) => `liqEp.minutes.${f}`,
  folded: (f: Form) => `liqEp.folded.${f}`,
} as const;
export type Counted = keyof typeof PLURALS;

export function plural(word: Counted, n: number): Text {
  return { key: PLURALS[word](ruPlural(n)) as StringKey, params: { n } };
}

/** E6: «за {m} минут», `m = max(1, ceil((to − from) / 60 s))` — a single print is «за 1 минуту». */
export function episodeMinutes(e: Pick<WebLiquidationEpisode, 'from' | 'to'>): number {
  return Math.max(1, Math.ceil((e.to - e.from) / 60));
}

/** E6: «Только X» when one coin is the whole episode, «Почти всё — X» at ≥ 80 %, otherwise nothing. */
export const ALMOST_ALL_SHARE = 0.8;
export function coinSentence(e: Pick<WebLiquidationEpisode, 'coins' | 'usd'>): Text | null {
  const top = e.coins[0];
  if (e.coins.length === 1) return { key: 'liqEp.coin.only', params: { coin: top.base } };
  if (e.usd > 0 && top.usd / e.usd >= ALMOST_ALL_SHARE) return { key: 'liqEp.coin.almost', params: { coin: top.base } };
  return null;
}

export interface Chip {
  label: string;
  /** The filter's coin or venue: highlighted, figures stay whole-episode (E5). */
  on: boolean;
}

/** E6: the top 3 coins by sum, then «ещё n». A filtered coin outside the top 3 is shown, not folded. */
export function coinChips(e: Pick<WebLiquidationEpisode, 'coins'>, symbol: string): { chips: Chip[]; more: number } {
  const top = e.coins.slice(0, 3);
  const picked = e.coins.slice(3).find((c) => c.symbol === symbol);
  const shown = picked ? [...top, picked] : top;
  return {
    chips: shown.map((c) => ({ label: `${c.base} ${formatUsd(c.usd)}`, on: c.symbol === symbol })),
    more: e.coins.length - shown.length,
  };
}

/** E6: each venue's share, only when more than one venue took part. */
export function venueChips(e: Pick<WebLiquidationEpisode, 'venues'>, venue: string): Chip[] {
  if (e.venues.length < 2) return [];
  return e.venues.map((v) => ({ label: `${venueName(v.venue)} ${v.pct} %`, on: v.venue === venue }));
}

/** «04.11 17:04–17:13» (7d) or «17:04–17:13» (24h), the table's formatter (IB-120); one time for one print. */
export function episodeTime(e: Pick<WebLiquidationEpisode, 'from' | 'to'>, withDay: boolean, timeZone?: string): string {
  const from = tickLabel(e.from, withDay ? 86_400 : 60, timeZone);
  if (e.to === e.from) return from;
  // across midnight the 7d view names the second day too; the 24h view never shows days
  const day = (t: number) => tickLabel(t, 86_400, timeZone).slice(0, 5);
  const toWithDay = withDay && day(e.to) !== day(e.from);
  return `${from}–${tickLabel(e.to, toWithDay ? 86_400 : 60, timeZone)}`;
}

export interface PriceFacts {
  /** The coin the price, the facts and the link are all about: the episode's largest (E6). */
  coin: string;
  during: { from: string; to: string; pct: string | null; tone: Tone | null };
  /** Null until the minute at `to + 4 h` has closed («ещё не прошло»). */
  after: { close: string; pct: string | null; tone: Tone | null } | null;
}

/** E6: «{COIN} во время: a → b ±x %», «через 4 ч: c ±y %» against the episode end. Null without a price. */
export function priceFacts(e: Pick<WebLiquidationEpisode, 'coins' | 'price'>): PriceFacts | null {
  const p = e.price;
  if (p === null) return null;
  const move = (a: number, b: number) => ((b - a) / a) * 100;
  const during = move(p.startOpen, p.endClose);
  const after = p.after4hClose === null ? null : move(p.endClose, p.after4hClose);
  return {
    coin: e.coins[0].base,
    during: { from: formatPrice(p.startOpen), to: formatPrice(p.endClose), pct: signedPct(during, 1), tone: toneOf(round1(during)) },
    after: after === null ? null : { close: formatPrice(p.after4hClose as number), pct: signedPct(after, 1), tone: toneOf(round1(after)) },
  };
}

/** «Открыть {COIN} в HH:MM →»: `/instrument/<SYM>?at=<from>` — IB-098's moment link, the same coin as the price. */
export function episodeLink(e: Pick<WebLiquidationEpisode, 'coins' | 'from'>, timeZone?: string): { link: InstrumentLink; coin: string; time: string } {
  const top = e.coins[0];
  return { link: instrumentLink({ symbol: top.symbol, time: e.from }), coin: top.base, time: tickLabel(e.from, 60, timeZone) };
}

/** The view's state from the answer: no norm yet, no episode, or cards. */
export type EpisodesState = 'collecting' | 'none' | 'cards';
export function episodesState(r: Pick<WebLiquidationEpisodesResponse, 'norm' | 'summary'>): EpisodesState {
  if (r.norm.status === 'collecting') return 'collecting';
  return r.summary.count === 0 ? 'none' : 'cards';
}

/** «норма по {d} дн.» is said only on a tape shorter than a week (E2). */
export function shortNormDays(r: Pick<WebLiquidationEpisodesResponse, 'norm'>): number | null {
  return r.norm.status === 'ready' && r.norm.heldDays < 7 ? r.norm.heldDays : null;
}

export interface Segment {
  text: string;
  /** The placeholder's name, or null for the template's own words. */
  part: string | null;
}

/** A template split at its `{placeholders}`: the words, and each part where the template puts it. */
export function segments(template: string, parts: Record<string, string>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    if (m.index > last) out.push({ text: template.slice(last, m.index), part: null });
    out.push({ text: parts[m[1]] ?? m[0], part: m[1] });
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push({ text: template.slice(last), part: null });
  return out;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * The coin filter's options on the episode view, which has no flat list to take them from: every coin
 * seen in an episode of this period so far, kept across answers, so choosing BTC does not empty the
 * list of coins to switch to (the IB-120 rule for the flat list's `coins`).
 */
export function mergeCoinOptions(
  known: ReadonlyArray<{ symbol: string; base: string }>,
  episodes: ReadonlyArray<Pick<WebLiquidationEpisode, 'coins'>>,
): Array<{ symbol: string; base: string }> {
  const out = [...known];
  const seen = new Set(known.map((c) => c.symbol));
  for (const e of episodes) {
    for (const c of e.coins) {
      if (!seen.has(c.symbol)) {
        seen.add(c.symbol);
        out.push({ symbol: c.symbol, base: c.base });
      }
    }
  }
  return out;
}
