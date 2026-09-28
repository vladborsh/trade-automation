import { Bot } from 'grammy';
import { registerHandlers, chunk, type UsersPort } from '../../src/delivery/bot-handlers';
import type { User } from '../../src/users/user.model';
import * as T from '../../src/delivery/templates/texts';

/**
 * IB-021 — the handlers, driven through real grammY `Update` objects.
 *
 * `botInfo` is supplied so the Bot never calls `getMe`, and an API transformer captures outgoing
 * calls instead of performing them: the routing, the access rule and the replies are exercised
 * for real with no network and no database. The spec network guard would fail this file
 * otherwise, which is the point.
 */

const BOT_INFO = {
  id: 42, is_bot: true as const, first_name: 'Insight', username: 'insight_test_bot',
  can_join_groups: true as const, can_read_all_group_messages: false as const,
  supports_inline_queries: false as const, can_connect_to_business: false as const,
  has_main_web_app: false as const, has_topics_enabled: false as const,
  allows_users_to_create_topics: false as const, can_manage_bots: false as const,
  supports_join_request_queries: false as const,
};

const member: User = {
  id: 2, tgUserId: 222, chatId: 222, role: 'member', lang: 'ru', deposit: null, riskPct: 1,
  dailyLossLimitPct: null, dexAlerts: false, invitedBy: 1, disabled: false, createdAt: new Date('2026-09-01'),
};
const admin: User = { ...member, id: 1, tgUserId: 111, chatId: 111, role: 'admin' };

const CODE = 'abcdefghjkmnpqrs'; // 16 chars from the code alphabet

function harness(over: Partial<UsersPort> = {}, users: Record<number, User> = {}) {
  const sent: string[] = [];
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const patches: Array<{ userId: number; patch: Record<string, unknown> }> = [];
  const invites: Array<{ code: string; createdBy: number; expiresAt: Date }> = [];

  const port: UsersPort = {
    findByTgUserId: async (id) => users[id] ?? null,
    consumeInvite: async () => ({ kind: 'refused' }),
    listUsers: async () => Object.values(users),
    updateSettings: async (userId, patch) => { patches.push({ userId, patch: patch as Record<string, unknown> }); return users[member.tgUserId] ?? null; },
    createInvite: async (code, createdBy, expiresAt) => { invites.push({ code, createdBy, expiresAt }); return { code, createdBy, createdAt: new Date(), expiresAt, usedBy: null, usedAt: null }; },
    setChatId: async () => {},
    ...over,
  };

  const bot = new Bot('123:FAKE', { botInfo: BOT_INFO });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === 'sendMessage') sent.push(String((payload as { text: string }).text));
    return { ok: true, result: { message_id: calls.length } } as never;
  });
  registerHandlers(bot, { users: port, botUsername: 'insight_test_bot', now: () => new Date('2026-09-28T12:00:00Z') });
  return { bot, sent, calls, patches, invites };
}

let updateId = 0;
const text = (from: number, body: string) => ({
  update_id: ++updateId,
  message: {
    message_id: ++updateId, date: Math.floor(Date.UTC(2026, 8, 28) / 1000), text: body,
    chat: { id: from, type: 'private' as const, first_name: 'X' },
    from: { id: from, is_bot: false, first_name: 'X' },
  },
});

describe('the access rule (§8.6)', () => {
  it('an unknown user gets ONE line and nothing else, whatever they type', async () => {
    const h = harness();
    for (const body of ['/settings', '/users', '/invite', 'hello', '/deposit 1000']) {
      await h.bot.handleUpdate(text(999, body) as never);
    }
    expect(h.sent).toHaveLength(5);
    for (const s of h.sent) expect(s).toBe(T.UNKNOWN_USER.ru);
  });

  it('a disabled member is treated as unknown, not as a member', async () => {
    const h = harness({}, { 222: { ...member, disabled: true } });
    await h.bot.handleUpdate(text(222, '/settings') as never);
    expect(h.sent).toEqual([T.UNKNOWN_USER.ru]);
  });

  it('a member\'s plain chatter gets no reply at all — stage 1 has no chat agent', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, 'доброе утро') as never);
    expect(h.sent).toEqual([]);
  });
});

describe('/start', () => {
  it('a valid code creates the member and welcomes them', async () => {
    const h = harness({ consumeInvite: async () => ({ kind: 'joined', user: member }) });
    await h.bot.handleUpdate(text(222, `/start ${CODE}`) as never);
    expect(h.sent[0]).toContain('доступ открыт');
  });

  it('a wrong, used or expired code all give the SAME refusal', async () => {
    const h = harness({ consumeInvite: async () => ({ kind: 'refused' }) });
    await h.bot.handleUpdate(text(333, `/start ${CODE}`) as never);
    expect(h.sent).toEqual([T.INVITE_REFUSED.ru]);
  });

  it('a malformed code never reaches the database', async () => {
    let asked = 0;
    const h = harness({ consumeInvite: async () => { asked++; return { kind: 'refused' }; } });
    await h.bot.handleUpdate(text(333, '/start ../../etc/passwd') as never);
    expect(asked).toBe(0);
    expect(h.sent).toEqual([T.INVITE_REFUSED.ru]);
  });

  it('a bare /start from a stranger reveals nothing', async () => {
    const h = harness();
    await h.bot.handleUpdate(text(333, '/start') as never);
    expect(h.sent).toEqual([T.UNKNOWN_USER.ru]);
  });

  it('an existing member re-opening their link is told so, not re-created', async () => {
    let consumed = 0;
    const h = harness({ consumeInvite: async () => { consumed++; return { kind: 'refused' }; } }, { 222: member });
    await h.bot.handleUpdate(text(222, `/start ${CODE}`) as never);
    expect(consumed).toBe(0);
    expect(h.sent).toEqual([T.ALREADY_MEMBER.ru]);
  });
});

describe('member settings', () => {
  it('/settings shows the current values', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, '/settings') as never);
    expect(h.sent[0]).toContain('Ваши настройки');
    expect(h.sent[0]).toContain('не задан'); // deposit
  });

  it('/deposit 1000 is stored', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, '/deposit 1000') as never);
    expect(h.patches).toEqual([{ userId: 2, patch: { deposit: 1000 } }]);
    expect(h.sent[0]).toContain('1000 USDT');
  });

  it('/risk 100 is refused with the accepted range, and nothing is written', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, '/risk 100') as never);
    expect(h.patches).toEqual([]);
    expect(h.sent[0]).toContain('0.1');
    expect(h.sent[0]).toContain('10');
  });

  it('/deposit with no value explains instead of erroring', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, '/deposit') as never);
    expect(h.patches).toEqual([]);
    expect(h.sent[0]).toContain('/deposit 1000');
  });

  it('/lang en is confirmed IN ENGLISH — the reply is the proof it took', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, '/lang en') as never);
    expect(h.patches).toEqual([{ userId: 2, patch: { lang: 'en' } }]);
    expect(h.sent[0]).toBe(T.saved('lang', 'en').en);
  });

  it('/dex on stores a boolean, not the string', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, '/dex вкл') as never);
    expect(h.patches).toEqual([{ userId: 2, patch: { dexAlerts: true } }]);
  });

  it('an unknown command from a MEMBER is answered, unlike a stranger\'s', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, '/nonsense') as never);
    expect(h.sent).toEqual([T.UNKNOWN_COMMAND.ru]);
  });
});

describe('admin commands', () => {
  it('/invite is refused for a member and no code is created', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, '/invite') as never);
    expect(h.invites).toEqual([]);
    expect(h.sent).toEqual([T.ADMIN_ONLY.ru]);
  });

  it('/invite gives the admin a single-use link expiring in 7 days', async () => {
    const h = harness({}, { 111: admin });
    await h.bot.handleUpdate(text(111, '/invite') as never);
    expect(h.invites).toHaveLength(1);
    expect(h.invites[0].expiresAt.toISOString()).toBe('2026-10-05T12:00:00.000Z');
    expect(h.sent[0]).toContain(`https://t.me/insight_test_bot?start=${h.invites[0].code}`);
  });

  it('/users is refused for a member', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, '/users') as never);
    expect(h.sent).toEqual([T.ADMIN_ONLY.ru]);
  });

  it('/users lists members for the admin', async () => {
    const h = harness({}, { 111: admin, 222: member });
    await h.bot.handleUpdate(text(111, '/users') as never);
    expect(h.sent[0]).toContain('Участники (2)');
    expect(h.sent[0]).toContain('111');
    expect(h.sent[0]).toContain('222');
  });
});

describe('chunk', () => {
  it('splits above Telegram\'s 4096 limit so a long list is not silently lost', () => {
    const line = 'x'.repeat(100);
    const parts = chunk(Array.from({ length: 80 }, () => line).join('\n'));
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4096);
  });

  it('leaves a short message alone', () => {
    expect(chunk('hello')).toEqual(['hello']);
  });
});
