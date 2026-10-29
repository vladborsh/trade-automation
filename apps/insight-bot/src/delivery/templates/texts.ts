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
  /** IB-062; optional so callers from before the calendar still render. */
  calendarAlerts?: boolean;
}): Texts {
  const deposit = user.deposit === null ? { ru: 'не задан', en: 'not set' } : { ru: `${money(user.deposit)} USDT`, en: `${money(user.deposit)} USDT` };
  const limit = user.dailyLossLimitPct === null ? { ru: 'не задан', en: 'not set' } : { ru: pct(user.dailyLossLimitPct), en: pct(user.dailyLossLimitPct) };
  return {
    ru: 'Ваши настройки\n'
      + `• Депозит: ${deposit.ru}\n`
      + `• Риск на сделку: ${pct(user.riskPct)}\n`
      + `• Дневной лимит убытка: ${limit.ru}\n`
      + `• Алерты по DEX: ${user.dexAlerts ? 'включены' : 'выключены'}\n`
      + (user.calendarAlerts === undefined ? '' : `• Календарь США: ${user.calendarAlerts ? 'включён' : 'выключен'}\n`)
      + `• Язык: ${user.lang}\n\n`
      + `Изменить: /deposit 1000, /risk 1, /limit 3, /dex on, ${user.calendarAlerts === undefined ? '' : '/calendar, '}/lang en`,
    en: 'Your settings\n'
      + `• Deposit: ${deposit.en}\n`
      + `• Risk per trade: ${pct(user.riskPct)}\n`
      + `• Daily loss limit: ${limit.en}\n`
      + `• DEX alerts: ${user.dexAlerts ? 'on' : 'off'}\n`
      + (user.calendarAlerts === undefined ? '' : `• US calendar: ${user.calendarAlerts ? 'on' : 'off'}\n`)
      + `• Language: ${user.lang}\n\n`
      + `Change with: /deposit 1000, /risk 1, /limit 3, /dex on, ${user.calendarAlerts === undefined ? '' : '/calendar, '}/lang ru`,
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

/**
 * IB-BUG-008 — the sign-in message, as **HTML** so the link is tappable.
 *
 * Telegram auto-links bare URLs only when they look like URLs to it, and
 * `http://localhost:3005/...` has no TLD, so the user got plain text they could not tap. An
 * explicit `<a href>` works regardless of auto-linking.
 *
 * **Measured against the real API on 2026-10-07** (one probe per variant, so a note rather than
 * a rule — AGENTS.md's repetition bar is five, and this was four messages total):
 *
 * | variant | `localhost` | `127.0.0.1` |
 * |---|---|---|
 * | HTML anchor | accepted | accepted |
 * | inline button | **rejected**, "Wrong HTTP URL" | accepted |
 *
 * Hence `WEB_BASE_URL=http://127.0.0.1:3005`: it is the only host of the two that gets a real
 * tap target rather than a fallback. Both the try/catch and the plain-URL line stay anyway —
 * they cost nothing, and the next client or the next Telegram change is not ours to predict.
 *
 * The bare URL stays underneath on its own line: a client that renders neither the anchor nor
 * the button still leaves something copyable, and the whole point is that the person gets in.
 *
 * **The token appears twice** (anchor and fallback, plus the button the caller attaches) and
 * that is safe: it is ONE token, so the single-use rule is untouched — whichever copy is opened
 * spends the same row, and the second attempt gets `TOKEN_USED`.
 */
export function webLink(url: string, minutes: number): Texts {
  const a = `<a href="${escapeHtml(url)}">`;
  return {
    ru: `Вход в панель (ссылка одноразовая, действует ${minutes} мин):\n${a}Открыть панель</a>\n\n${escapeHtml(url)}`,
    en: `Dashboard sign-in (single-use link, valid for ${minutes} min):\n${a}Open the dashboard</a>\n\n${escapeHtml(url)}`,
  };
}

/**
 * The same message with no markup at all, for the fallback path: if Telegram refuses the HTML
 * or the button, the person must still end up with something they can copy.
 */
export function webLinkPlain(url: string, minutes: number): Texts {
  return {
    ru: `Вход в панель (ссылка одноразовая, действует ${minutes} мин):\n${url}`,
    en: `Dashboard sign-in (single-use link, valid for ${minutes} min):\n${url}`,
  };
}

/** The label on the inline button, in the member's language. */
export const WEB_BUTTON: Texts = {
  ru: 'Открыть панель',
  en: 'Open the dashboard',
};

/**
 * Telegram's HTML parse mode needs these three escaped, and only these three. Our URLs are
 * base64url plus a path so they contain none of them today — escaping anyway because a URL that
 * is built differently tomorrow must not be able to break the markup or inject a tag.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The dashboard is not deployed for this instance — §4: /web refuses rather than guessing. */
export const WEB_NOT_CONFIGURED: Texts = {
  ru: 'Веб-панель для этого бота не настроена.',
  en: 'The dashboard is not configured for this bot.',
};

/** An unrecognised command from a KNOWN member — different from an unknown user's one line. */
export const UNKNOWN_COMMAND: Texts = {
  ru: 'Не знаю такой команды. /settings — ваши настройки.',
  en: 'I do not know that command. /settings shows your settings.',
};

/**
 * IB-062 — the economic-calendar messages: a morning digest and a reminder before a high-impact
 * USD event. Event titles stay as the feed spells them (English), like tickers: they are names a
 * member will search for. Times are given in UTC and in Kyiv, where the members are.
 */
interface CalendarLine {
  title: string;
  scheduledAt: number;
  forecast: string | null;
  previous: string | null;
}

const hhmm = (ms: number, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));

/** `12:30 UTC / 14:30 Kyiv` — both, because the feed is UTC and the members live in Kyiv. */
export function calendarTime(ms: number, lang: Lang): string {
  return `${hhmm(ms, 'UTC')} UTC / ${hhmm(ms, 'Europe/Kyiv')} ${lang === 'ru' ? 'Киев' : 'Kyiv'}`;
}

function figures(e: CalendarLine, lang: Lang): string {
  const parts = [
    e.forecast !== null ? `${lang === 'ru' ? 'прогноз' : 'forecast'} ${e.forecast}` : null,
    e.previous !== null ? `${lang === 'ru' ? 'пред.' : 'prev.'} ${e.previous}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

export function calendarDigest(
  day: string, events: readonly CalendarLine[], holidays: readonly { title: string }[], leadMin: number,
): Texts {
  const [, m, d] = day.split('-');
  const build = (lang: Lang): string => {
    const lines: string[] = [lang === 'ru' ? `Календарь США на ${d}.${m}` : `US calendar for ${d}.${m}`];
    for (const h of holidays) lines.push(lang === 'ru' ? `• Праздник в США: ${h.title} — рынки США закрыты или работают сокращённо` : `• US holiday: ${h.title} — US markets closed or on short hours`);
    for (const e of events) lines.push(`• ${calendarTime(e.scheduledAt, lang)} — ${e.title}${figures(e, lang)}`);
    if (events.length === 0) lines.push(lang === 'ru' ? 'Важных событий по USD нет.' : 'No high-impact USD events.');
    lines.push('', lang === 'ru' ? `Напомню за ${leadMin} мин до каждого. Отключить: /calendar` : `I will remind you ${leadMin} min before each. Turn off: /calendar`);
    return lines.join('\n');
  };
  return { ru: build('ru'), en: build('en') };
}

export function calendarReminder(scheduledAt: number, events: readonly CalendarLine[], minutesLeft: number): Texts {
  const build = (lang: Lang): string => {
    const head = lang === 'ru'
      ? `Через ${minutesLeft} мин, ${calendarTime(scheduledAt, lang)} — важное по USD:`
      : `In ${minutesLeft} min, ${calendarTime(scheduledAt, lang)} — high-impact USD:`;
    return [head, ...events.map((e) => `• ${e.title}${figures(e, lang)}`)].join('\n');
  };
  return { ru: build('ru'), en: build('en') };
}

export function calendarToggled(on: boolean): Texts {
  return on
    ? { ru: 'Календарь США включён: утренняя сводка и напоминание перед важными событиями. Выключить: /calendar', en: 'US calendar on: a morning digest and a reminder before high-impact events. Turn off: /calendar' }
    : { ru: 'Календарь США выключен. Включить: /calendar', en: 'US calendar off. Turn on: /calendar' };
}
