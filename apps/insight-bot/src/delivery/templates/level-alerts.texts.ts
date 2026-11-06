import { LEVEL_ALERT_TF, LEVEL_BAR_SEC, LEVEL_KIND_LABEL, LEVEL_KIND_SIDE, type LevelAlertDetails, type LevelEvent } from '@trade-automation/contracts';
import type { Lang } from '../../users/user.model';
import type { Texts } from './texts';
import { utc } from './utc-label';

/**
 * IB-126 (design P6; C3) — the level messages, plain text in the recipient's language. Each says what the 15m bar DID
 * at the level (closed beyond it, wicked through and closed back, closed back across after closes beyond), with the
 * prices, and links the instrument page at the bar's open on 15m. Level names and tickers stay English; the sentence
 * is translated. Nothing about what happens next (D20); a spec scans every variant for forecast words.
 */
export interface LevelText {
  /** `BTCUSDT` → `BTC` (alert_symbols.base). */
  base: string;
  symbol: string;
}

const MONTHS: Record<Lang, string[]> = {
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/**
 * A price at the precision its size needs: 71 850 (ru) / 71,850 (en) for BTC, 3 512.4 for ETH, 0.31245 for TRX —
 * decimals `4 − ⌊log10 ref⌋` (0…8). Every price of one message takes the LEVEL's precision (`ref`), so 99.00 and 100.00
 * read alike.
 */
export function price(p: number, lang: Lang, ref = p): string {
  const decimals = Math.min(8, Math.max(0, 4 - Math.floor(Math.log10(Math.abs(ref) || 1))));
  const [int, frac] = p.toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'ru' ? ' ' : ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/** «4 ноя 15:00 UTC» / «4 Nov 15:00 UTC». */
export function utcTime(epochMs: number, lang: Lang): string {
  const d = new Date(epochMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return utc(`${d.getUTCDate()} ${MONTHS[lang][d.getUTCMonth()]} ${hh}:${mm}`);
}

/** The instrument page at the bar's open, on 15m (§1 «Link»). */
export function levelAlertLink(webBaseUrl: string, symbol: string, barOpenMs: number): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/instrument/${encodeURIComponent(symbol)}?at=${Math.floor(barOpenMs / 1000)}&tf=${LEVEL_ALERT_TF}`;
}

function headline(t: LevelText, e: LevelEvent, d: LevelAlertDetails, lang: Lang): string {
  const px = (p: number) => price(p, lang, d.price);
  const L = `${LEVEL_KIND_LABEL[d.kind]} ${px(d.price)}`;
  const c = px(d.bar.close);
  const open = LEVEL_KIND_SIDE[d.kind] === 'open';
  if (lang === 'ru') {
    switch (e) {
      // P6 «пробой PWH»: a high or low level has one direction; an open says which way
      case 'breakout_up': return `${t.base}: пробой ${open ? 'вверх ' : ''}${L} — 15m закрылась на ${c}`;
      case 'breakout_down': return `${t.base}: пробой ${open ? 'вниз ' : ''}${L} — 15m закрылась на ${c}`;
      case 'sweep_above': return `${t.base}: снятие ликвидности над ${L} — хвост до ${px(d.bar.high)}, закрытие ${c}`;
      case 'sweep_below': return `${t.base}: снятие ликвидности под ${L} — хвост до ${px(d.bar.low)}, закрытие ${c}`;
      case 'crossunder': return `${t.base}: возврат под ${L} — 15m закрылась на ${c}${since(d, 'выше уровня закрывалась с', lang)}`;
      case 'crossover': return `${t.base}: возврат над ${L} — 15m закрылась на ${c}${since(d, 'ниже уровня закрывалась с', lang)}`;
    }
  }
  switch (e) {
    case 'breakout_up': return `${t.base}: breakout above ${L} — 15m closed at ${c}`;
    case 'breakout_down': return `${t.base}: breakdown below ${L} — 15m closed at ${c}`;
    case 'sweep_above': return `${t.base}: liquidity sweep above ${L} — wick to ${px(d.bar.high)}, close ${c}`;
    case 'sweep_below': return `${t.base}: liquidity sweep below ${L} — wick to ${px(d.bar.low)}, close ${c}`;
    case 'crossunder': return `${t.base}: back below ${L} — 15m closed at ${c}${since(d, 'closes above the level since', lang)}`;
    case 'crossover': return `${t.base}: back above ${L} — 15m closed at ${c}${since(d, 'closes below the level since', lang)}`;
  }
}

/** P6: «; выше уровня закрывалась с 4 ноя 15:00 UTC» — P10's first close beyond, a fact. */
function since(d: LevelAlertDetails, words: string, lang: Lang): string {
  return d.firstBeyondAtMs === null ? '' : `; ${words} ${utcTime(d.firstBeyondAtMs, lang)}`;
}

/** The message for one level event; the link opens the bar itself (its open), on 15m. */
export function levelAlert(t: LevelText, event: LevelEvent, d: LevelAlertDetails, webBaseUrl: string): Texts {
  const build = (lang: Lang) => [headline(t, event, d, lang), levelAlertLink(webBaseUrl, t.symbol, d.bar.openMs)].join('\n');
  return { ru: build('ru'), en: build('en') };
}

/** The bar's close moment, epoch ms (the bar opens at `openMs`). */
export const barCloseMs = (openMs: number): number => openMs + LEVEL_BAR_SEC * 1_000;
