/**
 * IB-021 — what the bot does with an update (design §8.6).
 *
 * Written against a small `UsersPort` rather than the database directly, so every handler is
 * unit-testable by driving real grammY `Update` objects through `bot.handleUpdate()` with the
 * API stubbed — no network, no Postgres, and the routing is exercised rather than mocked.
 *
 * The access rule, applied before any handler body runs: a person with no row gets
 * `UNKNOWN_USER` and nothing else. `/start <code>` is the single exception, because that is how
 * a person without a row is supposed to arrive.
 */

import type { Bot, Context } from 'grammy';
import type { Invite, Lang, User } from '../users/user.model';
import { INVITE_TTL_MS } from '../users/user.model';
import { generateInviteCode, inviteLink, isWellFormedCode } from '../users/invite-code';
import {
  parseCommand, parseDeposit, parseLang, parseLimitPct, parseOnOff, parseRiskPct,
  DEPOSIT_MAX, DEPOSIT_MIN, LIMIT_MAX, LIMIT_MIN, RISK_MAX, RISK_MIN, type ParseResult,
} from '../users/settings';
import type { ConsumeResult, SettingsPatch } from '../users/pg/users.repo';
import * as T from './templates/texts';

export interface UsersPort {
  findByTgUserId(tgUserId: number): Promise<User | null>;
  consumeInvite(code: string, tgUserId: number, chatId: number, now: Date): Promise<ConsumeResult>;
  listUsers(): Promise<User[]>;
  updateSettings(userId: number, patch: SettingsPatch): Promise<User | null>;
  createInvite(code: string, createdBy: number, expiresAt: Date): Promise<Invite>;
  setChatId(userId: number, chatId: number): Promise<void>;
}

/**
 * IB-029 — issuing a dashboard login link. Optional so the bot still works with no web
 * surface configured, and so IB-021's specs need not know about the dashboard.
 */
export interface WebAuthPort {
  /** The full login URL, or null when WEB_BASE_URL is unset. */
  createLoginLink(userId: number): Promise<string | null>;
  loginTokenTtlMs: number;
}

export interface HandlerDeps {
  users: UsersPort;
  web?: WebAuthPort;
  botUsername: string;
  now?: () => Date;
  inviteTtlMs?: number;
  logger?: { warn: (message: string) => void };
}

/** Telegram splits above 4096 characters; a long `/users` list must not vanish. */
export const TELEGRAM_MAX_CHARS = 4096;

export function chunk(text: string, max = TELEGRAM_MAX_CHARS): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  for (const line of text.split('\n')) {
    const last = parts[parts.length - 1];
    if (last !== undefined && last.length + 1 + line.length <= max) parts[parts.length - 1] = `${last}\n${line}`;
    else parts.push(line.slice(0, max));
  }
  return parts;
}

export function registerHandlers(bot: Bot, deps: HandlerDeps): void {
  const now = deps.now ?? (() => new Date());
  const ttl = deps.inviteTtlMs ?? INVITE_TTL_MS;

  const reply = async (ctx: Context, texts: T.Texts, lang: Lang): Promise<void> => {
    for (const part of chunk(T.pick(texts, lang))) {
      await ctx.reply(part, { link_preview_options: { is_disabled: true } });
    }
  };

  bot.on('message:text', async (ctx) => {
    const tgUserId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (tgUserId === undefined || chatId === undefined) return;

    const parsed = parseCommand(ctx.message.text);
    const user = await deps.users.findByTgUserId(tgUserId);

    // /start <code> is the one door open to someone with no row
    if (parsed?.command === 'start') {
      await handleStart(ctx, parsed.args[0], user, tgUserId, chatId);
      return;
    }

    // §8.6: anyone else without a row gets one line, whatever they typed
    if (!user || user.disabled) {
      await reply(ctx, T.UNKNOWN_USER, 'ru');
      return;
    }
    if (user.chatId !== chatId) await deps.users.setChatId(user.id, chatId);
    if (!parsed) return; // a member's plain chatter is not an error; stage 1 has no chat agent

    await handleMemberCommand(ctx, parsed.command, parsed.args, user);
  });

  async function handleStart(ctx: Context, code: string | undefined, user: User | null, tgUserId: number, chatId: number): Promise<void> {
    if (user && !user.disabled) {
      if (user.chatId !== chatId) await deps.users.setChatId(user.id, chatId);
      await reply(ctx, T.ALREADY_MEMBER, user.lang);
      return;
    }
    // a malformed code never reaches the database: it cannot be one we issued
    if (!code || !isWellFormedCode(code)) {
      await reply(ctx, code ? T.INVITE_REFUSED : T.UNKNOWN_USER, 'ru');
      return;
    }

    const result = await deps.users.consumeInvite(code, tgUserId, chatId, now());
    if (result.kind === 'refused') {
      await reply(ctx, T.INVITE_REFUSED, 'ru');
      return;
    }
    if (result.kind === 'already_member') {
      await reply(ctx, T.ALREADY_MEMBER, result.user.lang);
      return;
    }
    await reply(ctx, T.welcome(ctx.from?.first_name ?? null), result.user.lang);
  }

  async function handleMemberCommand(ctx: Context, command: string, args: string[], user: User): Promise<void> {
    const lang = user.lang;

    const applyNumber = async (
      parsed: ParseResult<number>, field: string, patch: (v: number) => SettingsPatch,
      min: number, max: number, usage: string, format: (v: number) => string,
    ): Promise<void> => {
      if (!parsed.ok) {
        await reply(ctx, parsed.reason === 'missing' ? T.missingArgument(usage) : T.badNumber(field, min, max, usage), lang);
        return;
      }
      const updated = await deps.users.updateSettings(user.id, patch(parsed.value));
      await reply(ctx, T.saved(field, format(parsed.value)), updated?.lang ?? lang);
    };

    switch (command) {
      case 'start':
        return;
      case 'settings':
        await reply(ctx, T.settings(user), lang);
        return;
      case 'deposit':
        await applyNumber(parseDeposit(args[0]), 'deposit', (v) => ({ deposit: v }), DEPOSIT_MIN, DEPOSIT_MAX, '/deposit 1000', (v) => `${v} USDT`);
        return;
      case 'risk':
        await applyNumber(parseRiskPct(args[0]), 'risk', (v) => ({ riskPct: v }), RISK_MIN, RISK_MAX, '/risk 1', (v) => `${v}%`);
        return;
      case 'limit':
        await applyNumber(parseLimitPct(args[0]), 'limit', (v) => ({ dailyLossLimitPct: v }), LIMIT_MIN, LIMIT_MAX, '/limit 3', (v) => `${v}%`);
        return;
      case 'lang': {
        const parsed = parseLang(args[0]);
        if (!parsed.ok) { await reply(ctx, T.BAD_LANG, lang); return; }
        await deps.users.updateSettings(user.id, { lang: parsed.value });
        // answered in the NEW language: the confirmation is the first proof it took effect
        await reply(ctx, T.saved('lang', parsed.value), parsed.value);
        return;
      }
      case 'dex': {
        const parsed = parseOnOff(args[0]);
        if (!parsed.ok) { await reply(ctx, T.BAD_ON_OFF, lang); return; }
        await deps.users.updateSettings(user.id, { dexAlerts: parsed.value });
        await reply(ctx, T.saved('dex', parsed.value ? 'on' : 'off'), lang);
        return;
      }
      case 'calendar': {
        // IB-062: bare /calendar toggles; /calendar on|off sets
        let value = !user.calendarAlerts;
        if (args[0] !== undefined) {
          const parsed = parseOnOff(args[0]);
          if (!parsed.ok) { await reply(ctx, T.BAD_ON_OFF, lang); return; }
          value = parsed.value;
        }
        await deps.users.updateSettings(user.id, { calendarAlerts: value });
        await reply(ctx, T.calendarToggled(value), lang);
        return;
      }
      case 'invite': {
        if (user.role !== 'admin') { await reply(ctx, T.ADMIN_ONLY, lang); return; }
        const code = generateInviteCode();
        const expiresAt = new Date(now().getTime() + ttl);
        await deps.users.createInvite(code, user.id, expiresAt);
        await reply(ctx, T.inviteCreated(inviteLink(deps.botUsername, code), expiresAt), lang);
        return;
      }
      case 'web': {
        // §4: refuse rather than send a link to nowhere
        const link = deps.web ? await deps.web.createLoginLink(user.id) : null;
        if (!link) { await reply(ctx, T.WEB_NOT_CONFIGURED, lang); return; }

        // IB-BUG-008: sent as HTML with an inline button, because Telegram does not auto-link a
        // URL with no TLD and the user could not tap it. Three routes to the same ONE token —
        // button, anchor, bare URL — so a client that renders none of the first two still
        // works, and single use is unaffected.
        //
        // Measured 2026-10-07: Telegram REJECTS `localhost` in a button ("Wrong HTTP URL") and
        // accepts `127.0.0.1` in both forms, which is why WEB_BASE_URL uses the latter. One
        // probe per variant — a note, not a rule.
        const minutes = Math.round((deps.web as WebAuthPort).loginTokenTtlMs / 60_000);
        const text = T.pick(T.webLink(link, minutes), lang);
        try {
          await ctx.reply(text, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            reply_markup: { inline_keyboard: [[{ text: T.pick(T.WEB_BUTTON, lang), url: link }]] },
          });
        } catch (error) {
          // Telegram rejects some URLs in buttons (BUTTON_URL_INVALID) and may refuse a
          // host it does not consider a URL at all. Falling back to the plain text keeps the
          // person able to copy the link rather than getting nothing; the failure is logged
          // because it is the kind of thing that should be fixed, not silently absorbed.
          deps.logger?.warn(`/web: Telegram refused the rich message, falling back to plain text: ${(error as Error).message}`);
          await reply(ctx, T.webLinkPlain(link, minutes), lang);
        }
        return;
      }
      case 'users': {
        if (user.role !== 'admin') { await reply(ctx, T.ADMIN_ONLY, lang); return; }
        const rows = await deps.users.listUsers();
        await reply(ctx, T.userList(rows), lang);
        return;
      }
      default:
        await reply(ctx, T.UNKNOWN_COMMAND, lang);
    }
  }
}
