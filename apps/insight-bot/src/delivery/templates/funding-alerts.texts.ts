import { FUNDING_ALERT_TF, type FundingEnterDetails, type FundingFlipDetails, type FundingSide } from '@trade-automation/contracts';
import type { Lang } from '../../users/user.model';
import type { Texts } from './texts';

/**
 * IB-124 (design F2, F4, F5; C3) — the funding messages, plain text in the recipient's language. Each one prints the
 * venue's OWN rate and interval, and the per-8 h figure beside it when the interval is not 8 h (F2). It names who pays
 * whom. It states the coin's 30-day band and the floor the rate was judged against. It never says what happens next
 * (D20); a spec scans every variant for forecast words. Tickers and venues stay English; sentences are translated (C3).
 */
export interface FundingText {
  /** `BTCUSDT` → `BTC` (alert_symbols.base). */
  base: string;
  symbol: string;
}

/** A fraction as a signed percent with 4 decimals: 0.000412 → «+0.0412 %» (ru) / «+0.0412%» (en). */
export function pct(fraction: number, lang: Lang): string {
  const v = (fraction * 100).toFixed(4);
  const signed = fraction > 0 ? `+${v}` : fraction < 0 ? `−${v.slice(1)}` : v;
  return lang === 'ru' ? `${signed} %` : `${signed}%`;
}

const PAYS: Record<Lang, Record<FundingSide, string>> = {
  ru: { high: 'лонги платят шортам', low: 'шорты платят лонгам' },
  en: { high: 'longs pay shorts', low: 'shorts pay longs' },
};

/** «Ставка Binance +0.0206 % за 4 ч (+0.0412 % за 8 ч)»; an unknown interval is said, and counted as 8 h. */
function rateLine(d: Pick<FundingEnterDetails, 'rate' | 'intervalH' | 'ratePer8h'>, lang: Lang): string {
  const h = d.intervalH;
  if (lang === 'ru') {
    if (h === null) return `Ставка Binance ${pct(d.rate, 'ru')} (интервал выплат не определён, считаем 8 ч)`;
    return `Ставка Binance ${pct(d.rate, 'ru')} за ${h} ч${h === 8 ? '' : ` (${pct(d.ratePer8h, 'ru')} за 8 ч)`}`;
  }
  if (h === null) return `Binance rate ${pct(d.rate, 'en')} (settlement interval unknown, counted as 8h)`;
  return `Binance rate ${pct(d.rate, 'en')} per ${h}h${h === 8 ? '' : ` (${pct(d.ratePer8h, 'en')} per 8h)`}`;
}

/** The floor in percent, trailing zeros dropped: 0.0003 → «0.03». */
const floor = (fraction: number): string => (fraction * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');

/** The band is in the venue's own interval (settled rates); the floor is per 8 h. */
function basisLine(t: FundingText, d: FundingEnterDetails, lang: Lang): string {
  const per = d.intervalH ?? 8;
  return lang === 'ru'
    ? `Необычно для ${t.base}: полоса 30 дней ${pct(d.band.lo, 'ru')} … ${pct(d.band.hi, 'ru')} за ${per} ч, порог ±${floor(d.floorPer8h)} % за 8 ч`
    : `Unusual for ${t.base}: 30-day band ${pct(d.band.lo, 'en')} … ${pct(d.band.hi, 'en')} per ${per}h, floor ±${floor(d.floorPer8h)}% per 8h`;
}

/** The instrument page at the row's moment, on 1h (§1 «Link»). */
export function fundingAlertLink(webBaseUrl: string, symbol: string, atMs: number): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/instrument/${encodeURIComponent(symbol)}?at=${Math.floor(atMs / 1000)}&tf=${FUNDING_ALERT_TF}`;
}

/** F4: «Фандинг BTC в экстремуме: лонги платят шортам», the rate, the basis, the link. */
export function fundingEnter(t: FundingText, d: FundingEnterDetails, webBaseUrl: string): Texts {
  const build = (lang: Lang) => [
    lang === 'ru' ? `Фандинг ${t.base} в экстремуме: ${PAYS.ru[d.side]}` : `${t.base} funding at an extreme: ${PAYS.en[d.side]}`,
    rateLine(d, lang),
    basisLine(t, d, lang),
    fundingAlertLink(webBaseUrl, t.symbol, d.episodeStartMs),
  ].join('\n');
  return { ru: build('ru'), en: build('en') };
}

/** «31 ч», whole hours rounded down: a 24.9 h episode is «24 ч», never more than it lasted. */
const hours = (h: number): number => Math.floor(h);

/** F5: «Фандинг BTC сменил знак после 31 ч экстремума», who pays now, the rate, the link. */
export function fundingFlip(t: FundingText, d: FundingFlipDetails, webBaseUrl: string): Texts {
  const now: FundingSide = d.side === 'high' ? 'low' : 'high';
  const build = (lang: Lang) => [
    lang === 'ru'
      ? `Фандинг ${t.base} сменил знак после ${hours(d.episodeHours)} ч экстремума: теперь ${PAYS.ru[now]}`
      : `${t.base} funding changed sign after ${hours(d.episodeHours)}h at an extreme: now ${PAYS.en[now]}`,
    rateLine(d, lang),
    fundingAlertLink(webBaseUrl, t.symbol, d.flipSinceMs),
  ].join('\n');
  return { ru: build('ru'), en: build('en') };
}
