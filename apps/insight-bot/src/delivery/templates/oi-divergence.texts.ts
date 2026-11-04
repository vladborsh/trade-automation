import type { OiDivergenceDirection, OiDivergenceTf } from '@trade-automation/contracts';
import type { Lang } from '../../users/user.model';
import type { Texts } from './texts';

/**
 * IB-112 (architecture/oi-divergence-design-2026-11-04.md V14) — the OI divergence alert, as the
 * bot sends it: plain text (no parse mode), in the recipient's language.
 *
 * What it may say is fixed by the owner: what HAPPENED (price made a new low, OI did not), and what
 * that describes (positions are being opened into the drop). Never what will happen next, and no
 * hit rate: there is none yet (V12: after 1–2 months of the journal). A spec scans both languages
 * for forecast words.
 *
 * Tickers and timeframes stay as the venue spells them (texts.ts rule 1).
 */
export interface OiDivergenceAlertText {
  symbol: string;
  base: string;
  tf: OiDivergenceTf;
  direction: OiDivergenceDirection;
  /** B against A, in percent: price and OI. */
  pricePct: number;
  oiPct: number;
  /** 2 for a first alert, 3 for «третий … подряд» (V8). */
  runLength: number;
  /** B's bar open time, unix seconds: where the link opens the chart. */
  bTime: number;
}

const MINUS = '−';

/** `−2.4 %`, `+11 %`: the page's minus sign; two decimals under 1 %, one under 10 %, none above. */
export function signedPct(value: number): string {
  const abs = Math.abs(value);
  const digits = abs < 1 ? 2 : abs < 10 ? 1 : 0;
  const text = abs.toFixed(digits);
  const sign = Number(text) === 0 ? '' : value < 0 ? MINUS : '+';
  return `${sign}${text} %`;
}

const RU_ORDINALS: Record<number, string> = { 3: 'третий', 4: 'четвёртый', 5: 'пятый', 6: 'шестой', 7: 'седьмой', 8: 'восьмой', 9: 'девятый', 10: 'десятый' };
const EN_ORDINALS: Record<number, string> = { 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth' };

/** «третий», …; past ten «11-й» / «11th» — a run that long is rare, and a number reads fine. */
export function ordinal(n: number, lang: Lang): string {
  if (lang === 'ru') return RU_ORDINALS[n] ?? `${n}-й`;
  if (EN_ORDINALS[n]) return EN_ORDINALS[n] as string;
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${tail}`;
}

/** V14's link: the instrument page at B, on the alert's timeframe. */
export function alertLink(webBaseUrl: string, a: Pick<OiDivergenceAlertText, 'symbol' | 'bTime' | 'tf'>): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/instrument/${encodeURIComponent(a.symbol)}?at=${a.bTime}&tf=${a.tf}`;
}

export function oiDivergenceAlert(a: OiDivergenceAlertText, webBaseUrl: string): Texts {
  const price = signedPct(a.pricePct);
  const oi = signedPct(a.oiPct);
  const bull = a.direction === 'bullish';
  const repeat = a.runLength > 2;
  const ru = (bull
    ? `${a.base} ${a.tf}: цена обновила минимум (${price}), OI — нет (${oi}). Набирают позиции на падении.`
    : `${a.base} ${a.tf}: цена обновила максимум (${price}), OI — нет (${oi}). Рост идёт без новых позиций.`)
    + (repeat ? ` · повторное: ${ordinal(a.runLength, 'ru')} ${bull ? 'минимум' : 'максимум'} подряд` : '');
  const en = (bull
    ? `${a.base} ${a.tf}: price made a lower low (${price}), OI did not (${oi}). Positions are being opened into the drop.`
    : `${a.base} ${a.tf}: price made a higher high (${price}), OI did not (${oi}). The rise comes without new positions.`)
    + (repeat ? ` · repeat: ${ordinal(a.runLength, 'en')} ${bull ? 'lower low' : 'higher high'} in a row` : '');
  const link = alertLink(webBaseUrl, a);
  return { ru: `${ru}\n${link}`, en: `${en}\n${link}` };
}

/** `/oialerts`: what changed, and how to change it back. */
export function oiAlertsToggled(on: boolean): Texts {
  return on
    ? { ru: 'Сигналы OI включены: сообщение, когда цена обновляет минимум или максимум, а открытый интерес — нет. Выключить: /oialerts', en: 'OI alerts on: a message when price makes a new low or high and open interest does not. Turn off: /oialerts' }
    : { ru: 'Сигналы OI выключены. Включить: /oialerts', en: 'OI alerts off. Turn on: /oialerts' };
}
