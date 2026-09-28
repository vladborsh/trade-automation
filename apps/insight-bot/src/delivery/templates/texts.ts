/**
 * IB-021 — every string the bot sends, as pure functions (design §8.6: "message text in the
 * user's `lang` (`ru` default), templates as pure functions with specs, no AI in stage 1").
 *
 * Three rules this file exists to enforce:
 *
 * 1. **Commands, codes and tickers stay English** (§8.6). Only prose is translated, so a Russian
 *    member and an English one type exactly the same commands and can be helped by the same
 *    instructions.
 * 2. **An unknown user gets one line and nothing else** (§8.6). No hint that an invite system
 *    exists, no command list, no error detail — a stranger who finds the bot learns nothing
 *    about it, and the same line answers an expired code, a used code and a wrong code so that
 *    probing codes yields no signal.
 * 3. **Every text has both languages.** `Texts` is a record over `Lang`, so a missing
 *    translation is a compile error rather than a Russian string shown to an English member.
 */

import type { Lang } from '../../users/user.model';

export type Texts = Record<Lang, string>;

const pct = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(2)}%`;
const money = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function pick(texts: Texts, lang: Lang): string {
  return texts[lang];
}

/** The ONLY thing an unknown user ever sees (§8.6). */
export const UNKNOWN_USER: Texts = {
  ru: 'Этот бот приватный.',
  en: 'This bot is private.',
};

/** An invite that is wrong, already used or expired — deliberately one message for all three. */
export const INVITE_REFUSED: Texts = {
  ru: 'Ссылка не подошла. Попросите новую у администратора.',
  en: 'That link did not work. Ask the administrator for a new one.',
};

export function welcome(name: string | null): Texts {
  const who = name ? `, ${name}` : '';
  return {
    ru: `Готово${who} — доступ открыт.\n\n`
      + 'Что дальше:\n'
      + '• /settings — посмотреть свои настройки\n'
      + '• /deposit 1000 — размер депозита в USDT, нужен для расчёта позиции\n'
      + '• /risk 1 — риск на сделку в процентах от депозита\n\n'
      + 'Сигналы приходят сами. Пока идёт сбор данных, их может не быть несколько дней.',
    en: `You are in${who}.\n\n`
      + 'Next:\n'
      + '• /settings — see your settings\n'
      + '• /deposit 1000 — deposit size in USDT, needed to size positions\n'
      + '• /risk 1 — risk per trade, in percent of the deposit\n\n'
      + 'Signals arrive on their own. While data is still being collected there may be none for days.',
  };
}

export const ALREADY_MEMBER: Texts = {
  ru: 'Вы уже подключены. /settings — ваши настройки.',
  en: 'You are already connected. /settings shows your settings.',
};

export function settings(user: {
  deposit: number | null;
  riskPct: number;
  dailyLossLimitPct: number | null;
  dexAlerts: boolean;
  lang: Lang;
}): Texts {
  const deposit = user.deposit === null ? { ru: 'не задан', en: 'not set' } : { ru: `${money(user.deposit)} USDT`, en: `${money(user.deposit)} USDT` };
  const limit = user.dailyLossLimitPct === null ? { ru: 'не задан', en: 'not set' } : { ru: pct(user.dailyLossLimitPct), en: pct(user.dailyLossLimitPct) };
  return {
    ru: 'Ваши настройки\n'
      + `• Депозит: ${deposit.ru}\n`
      + `• Риск на сделку: ${pct(user.riskPct)}\n`
      + `• Дневной лимит убытка: ${limit.ru}\n`
      + `• Алерты по DEX: ${user.dexAlerts ? 'включены' : 'выключены'}\n`
      + `• Язык: ${user.lang}\n\n`
      + 'Изменить: /deposit 1000, /risk 1, /limit 3, /dex on, /lang en',
    en: 'Your settings\n'
      + `• Deposit: ${deposit.en}\n`
      + `• Risk per trade: ${pct(user.riskPct)}\n`
      + `• Daily loss limit: ${limit.en}\n`
      + `• DEX alerts: ${user.dexAlerts ? 'on' : 'off'}\n`
      + `• Language: ${user.lang}\n\n`
      + 'Change with: /deposit 1000, /risk 1, /limit 3, /dex on, /lang ru',
  };
}

export function saved(field: string, value: string): Texts {
  return {
    ru: `Сохранено: ${field} = ${value}`,
    en: `Saved: ${field} = ${value}`,
  };
}

/**
 * A rejected value says what is accepted. "Неверное значение" tells the person nothing, and they
 * are usually on a phone with one hand.
 */
export function badNumber(field: string, min: number, max: number, example: string): Texts {
  return {
    ru: `${field}: нужно число от ${min} до ${max}. Например: ${example}`,
    en: `${field}: expected a number between ${min} and ${max}. For example: ${example}`,
  };
}

export function missingArgument(usage: string): Texts {
  return {
    ru: `Не хватает значения. Например: ${usage}`,
    en: `A value is missing. For example: ${usage}`,
  };
}

export const BAD_LANG: Texts = {
  ru: 'Язык: ru или en. Например: /lang en',
  en: 'Language: ru or en. For example: /lang ru',
};

export const BAD_ON_OFF: Texts = {
  ru: 'Нужно on или off. Например: /dex on',
  en: 'Expected on or off. For example: /dex on',
};

export const ADMIN_ONLY: Texts = {
  ru: 'Эта команда только для администратора.',
  en: 'That command is for the administrator only.',
};

export function inviteCreated(link: string, expiresAt: Date): Texts {
  const until = expiresAt.toISOString().slice(0, 16).replace('T', ' ');
  return {
    ru: `Одноразовая ссылка, действует до ${until} UTC:\n${link}`,
    en: `Single-use link, valid until ${until} UTC:\n${link}`,
  };
}

export function userList(rows: ReadonlyArray<{ tgUserId: number; role: string; disabled: boolean; createdAt: Date }>): Texts {
  if (rows.length === 0) return { ru: 'Пока никого нет.', en: 'Nobody yet.' };
  const line = (r: (typeof rows)[number]) =>
    `• ${r.tgUserId} — ${r.role}${r.disabled ? ' (disabled)' : ''}, ${r.createdAt.toISOString().slice(0, 10)}`;
  const body = rows.map(line).join('\n');
  return {
    ru: `Участники (${rows.length}):\n${body}`,
    en: `Members (${rows.length}):\n${body}`,
  };
}

/** An unrecognised command from a KNOWN member — different from an unknown user's one line. */
export const UNKNOWN_COMMAND: Texts = {
  ru: 'Не знаю такой команды. /settings — ваши настройки.',
  en: 'I do not know that command. /settings shows your settings.',
};
