import { CUSTOM_LEVELS_PER_COIN_MAX, CUSTOM_LEVEL_NOTE_MAX, type CustomLevelAlertDetails, type LevelEvent } from '@trade-automation/contracts';
import type { Lang } from '../../users/user.model';
import { levelAlertLink, price, type LevelText } from './level-alerts.texts';
import type { Texts } from './texts';

/**
 * IB-128 (design §4 P9, P6; C3) — a custom level's message, plain text in the recipient's language: what the 15m bar
 * DID at the owner's level, with the prices and the owner's note, and the instrument page at the bar's open on 15m.
 * Tickers stay English, the sentence is translated, nothing about what happens next (D20; a spec scans every variant).
 * A custom level is evaluated as an open, so the breakout says its direction.
 */
function headline(t: LevelText, e: LevelEvent, d: CustomLevelAlertDetails, lang: Lang): string {
  const px = (p: number) => price(p, lang, d.price);
  const note = d.note ? ` (${d.note})` : '';
  const c = px(d.bar.close);
  if (lang === 'ru') {
    const L = `${px(d.price)}${note}`;
    switch (e) {
      case 'breakout_up': return `${t.base}: пробой вверх своего уровня ${L} — 15m закрылась на ${c}`;
      case 'breakout_down': return `${t.base}: пробой вниз своего уровня ${L} — 15m закрылась на ${c}`;
      case 'sweep_above': return `${t.base}: снятие ликвидности над своим уровнем ${L} — хвост до ${px(d.bar.high)}, закрытие ${c}`;
      case 'sweep_below': return `${t.base}: снятие ликвидности под своим уровнем ${L} — хвост до ${px(d.bar.low)}, закрытие ${c}`;
      default: throw new Error(`a custom level has no ${e} (P9)`);
    }
  }
  const L = `custom level ${px(d.price)}${note}`;
  switch (e) {
    case 'breakout_up': return `${t.base}: breakout above ${L} — 15m closed at ${c}`;
    case 'breakout_down': return `${t.base}: breakdown below ${L} — 15m closed at ${c}`;
    case 'sweep_above': return `${t.base}: liquidity sweep above ${L} — wick to ${px(d.bar.high)}, close ${c}`;
    case 'sweep_below': return `${t.base}: liquidity sweep below ${L} — wick to ${px(d.bar.low)}, close ${c}`;
    default: throw new Error(`a custom level has no ${e} (P9)`);
  }
}

export function customLevelAlert(t: LevelText, event: LevelEvent, d: CustomLevelAlertDetails, webBaseUrl: string): Texts {
  const build = (lang: Lang) => [headline(t, event, d, lang), levelAlertLink(webBaseUrl, t.symbol, d.bar.openMs)].join('\n');
  return { ru: build('ru'), en: build('en') };
}

// ------------------------------------------------------------------------------------------------ the bot's replies

export interface CustomLevelLine { id: number; base: string; price: number; note: string | null }

const line = (l: CustomLevelLine, lang: Lang): string => `#${l.id} ${l.base} ${price(l.price, lang)}${l.note ? ` — ${l.note}` : ''}`;

/** `/level BTC 72000`: the level and its id, so `/level del <id>` can be typed from the answer. */
export const customLevelAdded = (l: CustomLevelLine): Texts => ({
  ru: `Уровень добавлен: ${line(l, 'ru')}\nУдалить: /level del ${l.id}`,
  en: `Level added: ${line(l, 'en')}\nDelete: /level del ${l.id}`,
});

export const customLevelDeleted = (l: CustomLevelLine): Texts => ({
  ru: `Уровень удалён: ${line(l, 'ru')}`,
  en: `Level deleted: ${line(l, 'en')}`,
});

export const customLevelList = (levels: readonly CustomLevelLine[]): Texts => levels.length === 0
  ? { ru: 'Своих уровней нет. Добавить: /level BTC 72000', en: 'No custom levels. Add one: /level BTC 72000' }
  : {
    ru: ['Свои уровни:', ...levels.map((l) => line(l, 'ru')), 'Удалить: /level del <id>'].join('\n'),
    en: ['Custom levels:', ...levels.map((l) => line(l, 'en')), 'Delete: /level del <id>'].join('\n'),
  };

export const CUSTOM_LEVEL_ERRORS = {
  usage: { ru: 'Формат: /level BTC 72000 [заметка] · /level del <id> · /level — список', en: 'Usage: /level BTC 72000 [note] · /level del <id> · /level — the list' },
  bad_price: { ru: 'Цена — положительное число, например 72000 или 0.3125', en: 'The price is a positive number, e.g. 72000 or 0.3125' },
  comma: { ru: 'Дробную часть отделяйте точкой: 0.3125, а не 0,3125', en: 'Use a dot for decimals: 0.3125, not 0,3125' },
  bad_id: { ru: 'Формат: /level del <id> — id есть в списке /level', en: 'Usage: /level del <id> — the ids are in /level' },
  note_too_long: { ru: `Заметка длиннее ${CUSTOM_LEVEL_NOTE_MAX} символов`, en: `The note is longer than ${CUSTOM_LEVEL_NOTE_MAX} characters` },
  not_listed: { ru: 'Этой монеты нет в списке сигналов (/admin/alerts)', en: 'That coin is not on the alert list (/admin/alerts)' },
  too_many: { ru: `У этой монеты уже максимум активных уровней (${CUSTOM_LEVELS_PER_COIN_MAX}); удалите лишний`, en: `That coin already has the most active levels (${CUSTOM_LEVELS_PER_COIN_MAX}); delete one first` },
  not_found: { ru: 'Активного уровня с таким id нет', en: 'No active level with that id' },
} satisfies Record<string, Texts>;
