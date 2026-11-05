import { LIQ_ALERT_TF, LIQ_VENUES, type LiqByVenue, type LiqSide, type LiqSilentVenue, type LiqVenue } from '@trade-automation/contracts';
import { WEB_VENUE_NAMES } from '@trade-automation/contracts';
import type { Lang } from '../../users/user.model';
import type { Texts } from './texts';

/**
 * IB-122 (design L2, L3; C3) — the large-liquidation messages, as the bot sends them: plain text, in the
 * recipient's language. What happened, in numbers: the sum, the venue split, the count, the largest, and
 * which venue could not report. Never what happens next (D20); a spec scans every variant for forecast words.
 * Tickers and venues stay English (C3); sentences are translated.
 */
export interface LiqAlertText {
  symbol: string;
  base: string;
  side: LiqSide;
  /** Epoch ms of the crossing: the link's `at`. */
  atMs: number;
  sumUsd: number;
  byVenue: LiqByVenue;
  count: number;
  largest: { usd: number; venue: LiqVenue };
  silentVenues: readonly LiqSilentVenue[];
  /** The first message of the UTC day carries the Binance footnote (L3). */
  binanceFootnote: boolean;
}

export interface LiqContinuationText {
  symbol: string;
  base: string;
  side: LiqSide;
  atMs: number;
  sumUsd: number;
  /** The alert's window start, epoch ms («с 14:05 UTC»). */
  windowStartMs: number;
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
const hhmm = (ms: number): string => new Date(ms).toISOString().slice(11, 16);

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

export function liqAlert(a: LiqAlertText, webBaseUrl: string): Texts {
  const link = liqAlertLink(webBaseUrl, a.symbol, a.atMs);
  const ru = [
    `Крупные ликвидации ${SIDE.ru[a.side]} ${a.base}: ${usd(a.sumUsd)} за 5 мин`,
    venueLine(a.byVenue, a.silentVenues, 'ru'),
    `${ruLiquidations(a.count)}, крупнейшая ${usd(a.largest.usd)} (${venueName(a.largest.venue)})`,
    ...(a.binanceFootnote ? ['Binance публикует не больше одной ликвидации в секунду по монете, поэтому его сумма — нижняя граница.'] : []),
    link,
  ];
  const en = [
    `Large ${a.base} ${SIDE.en[a.side]} liquidations: ${usd(a.sumUsd)} in 5 min`,
    venueLine(a.byVenue, a.silentVenues, 'en'),
    `${a.count} ${a.count === 1 ? 'liquidation' : 'liquidations'}, largest ${usd(a.largest.usd)} (${venueName(a.largest.venue)})`,
    ...(a.binanceFootnote ? ['Binance publishes at most one liquidation per second per coin, so its figure is a lower bound.'] : []),
    link,
  ];
  return { ru: ru.join('\n'), en: en.join('\n') };
}

/** L2: «продолжается: уже $X» — the running sum since the alert's window start. */
export function liqContinuation(c: LiqContinuationText, webBaseUrl: string): Texts {
  const link = liqAlertLink(webBaseUrl, c.symbol, c.atMs);
  return {
    ru: `Ликвидации ${SIDE.ru[c.side]} ${c.base} — продолжается: уже ${usd(c.sumUsd)} с ${hhmm(c.windowStartMs)} UTC\n${link}`,
    en: `${c.base} ${SIDE.en[c.side]} liquidations — continuing: ${usd(c.sumUsd)} so far since ${hhmm(c.windowStartMs)} UTC\n${link}`,
  };
}
