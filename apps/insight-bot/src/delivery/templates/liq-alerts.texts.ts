import {
  LIQ_ALERT_TF, LIQ_VENUES, type LiqByVenue, type LiqEventContinuingDetails, type LiqEventDetails, type LiqSide, type LiqSilentVenue, type LiqVenue,
} from '@trade-automation/contracts';
import { WEB_VENUE_NAMES } from '@trade-automation/contracts';
import type { Lang } from '../../users/user.model';
import type { Texts } from './texts';

/**
 * IB-122 / IB-143 (design L3, L12, L13; C3) — the large-liquidation messages, as the bot sends them: plain text,
 * in the recipient's language. One message per market event (all coins of one side): the total, a line per coin
 * with its venue split, the count and the largest print, which venue could not report. Never what happens next
 * (D20); a spec scans every variant for forecast words. Tickers and venues stay English (C3); sentences are
 * translated.
 */
export interface LiqEventText {
  side: LiqSide;
  /** The `event` / `event_continuing` row's details (coins largest first). */
  details: LiqEventDetails | LiqEventContinuingDetails;
  /** `BTCUSDT` → `BTC` (alert_symbols.base). */
  baseOf: (symbol: string) => string;
}

/** `$7.4M`, `$300k`, `$950`: one decimal under 10 of a unit, none above. */
export function usd(value: number): string {
  const abs = Math.abs(value);
  const unit = (v: number, suffix: string) => `$${(v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v).toString())}${suffix}`;
  if (abs >= 1e9) return unit(value / 1e9, 'B');
  if (abs >= 1e6) return unit(value / 1e6, 'M');
  if (abs >= 1e3) return unit(value / 1e3, 'k');
  return `$${Math.round(value)}`;
}

/** «1 ликвидация», «3 ликвидации», «12 ликвидаций». */
export function ruLiquidations(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'ликвидация' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'ликвидации' : 'ликвидаций';
  return `${n} ${word}`;
}

/** The instrument page at the crossing, on 5m (§1 «Link»). */
export function liqAlertLink(webBaseUrl: string, symbol: string, atMs: number): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/instrument/${encodeURIComponent(symbol)}?at=${Math.floor(atMs / 1000)}&tf=${LIQ_ALERT_TF}`;
}

const venueName = (v: LiqVenue): string => WEB_VENUE_NAMES[v];

/** «Binance $3.1M · Bybit $2.9M · нет данных с OKX»: a silent venue is named, never shown as $0. */
export function venueLine(byVenue: LiqByVenue, silent: readonly LiqSilentVenue[], lang: Lang): string {
  return LIQ_VENUES.map((v) => {
    if (silent.some((s) => s.venue === v)) return lang === 'ru' ? `нет данных с ${venueName(v)}` : `no data from ${venueName(v)}`;
    return `${venueName(v)} ${usd(byVenue[v])}`;
  }).join(' · ');
}

const SIDE: Record<Lang, Record<LiqSide, string>> = {
  ru: { long: 'лонгов', short: 'шортов' },
  en: { long: 'long', short: 'short' },
};

/** `{m}` (L12): from the earliest window start to the message's moment, rounded up to whole minutes. */
export function eventMinutes(coins: ReadonlyArray<{ windowStartMs: number }>, untilMs: number): number {
  return Math.ceil((untilMs - Math.min(...coins.map((c) => c.windowStartMs))) / 60_000);
}

function coinLines(t: LiqEventText, lang: Lang, fresh: ReadonlySet<string>): string[] {
  return t.details.coins.map((c) => `${fresh.has(c.symbol) ? '+' : ''}${t.baseOf(c.symbol)} ${usd(c.sumUsd)} — ${venueLine(c.byVenue, c.silentVenues, lang)}`);
}

function countLine(t: LiqEventText, lang: Lang): string {
  const d = t.details;
  const where = d.coins.length > 1 ? `${t.baseOf(d.largest.symbol)}, ${venueName(d.largest.venue)}` : venueName(d.largest.venue);
  return lang === 'ru'
    ? `${ruLiquidations(d.count)}, крупнейшая ${usd(d.largest.usd)} (${where})`
    : `${d.count} ${d.count === 1 ? 'liquidation' : 'liquidations'}, largest ${usd(d.largest.usd)} (${where})`;
}

const FOOTNOTE: Record<Lang, string> = {
  ru: 'Binance публикует не больше одной ликвидации в секунду по монете, поэтому его сумма — нижняя граница.',
  en: 'Binance publishes at most one liquidation per second per coin, so its figure is a lower bound.',
};

/** The link coin (the largest) at its crossing. */
const eventLink = (t: LiqEventText, webBaseUrl: string): string => {
  const c = t.details.coins[0] as LiqEventDetails['coins'][number];
  return liqAlertLink(webBaseUrl, c.symbol, c.crossedAt);
};

/**
 * L12, the first message: «Крупные ликвидации лонгов: $21.2M за 7 мин», a line per coin, the count and the
 * largest, the link. With one coin it reads like IB-122's single-coin alert: the coin in the title.
 */
export function liqEvent(t: LiqEventText, webBaseUrl: string): Texts {
  const d = t.details;
  const m = eventMinutes(d.coins, d.sentAt);
  const one = d.coins.length === 1 ? t.baseOf((d.coins[0] as { symbol: string }).symbol) : null;
  const build = (lang: Lang) => [
    lang === 'ru'
      ? `Крупные ликвидации ${SIDE.ru[t.side]}${one ? ` ${one}` : ''}: ${usd(d.totalUsd)} за ${m} мин`
      : `Large ${one ? `${one} ` : ''}${SIDE.en[t.side]} liquidations: ${usd(d.totalUsd)} in ${m} min`,
    ...(one ? [venueLine((d.coins[0] as LiqEventDetails['coins'][number]).byVenue, (d.coins[0] as LiqEventDetails['coins'][number]).silentVenues, lang)] : coinLines(t, lang, new Set())),
    countLine(t, lang),
    ...(d.binanceFootnote ? [FOOTNOTE[lang]] : []),
    eventLink(t, webBaseUrl),
  ].join('\n');
  return { ru: build('ru'), en: build('en') };
}

/** L13, the continuation: «Ликвидации лонгов продолжаются: уже $X за {m} мин», a line per coin (new ones «+BNB»). */
export function liqEventContinuation(t: LiqEventText & { details: LiqEventContinuingDetails }, webBaseUrl: string): Texts {
  const d = t.details;
  const m = eventMinutes(d.coins, d.closedAt);
  const fresh = new Set(d.newCoins);
  const one = d.coins.length === 1 ? t.baseOf((d.coins[0] as { symbol: string }).symbol) : null;
  const build = (lang: Lang) => [
    lang === 'ru'
      ? `Ликвидации ${SIDE.ru[t.side]}${one ? ` ${one}` : ''} продолжаются: уже ${usd(d.totalUsd)} за ${m} мин`
      : `${one ? `${one} ${SIDE.en[t.side]}` : SIDE.en[t.side] === 'long' ? 'Long' : 'Short'} liquidations continuing: ${usd(d.totalUsd)} so far in ${m} min`,
    ...coinLines(t, lang, fresh),
    ...(d.binanceFootnote ? [FOOTNOTE[lang]] : []),
    eventLink(t, webBaseUrl),
  ].join('\n');
  return { ru: build('ru'), en: build('en') };
}
