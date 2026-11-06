import { Bot } from 'grammy';
import { registerHandlers, chunk, type UsersPort } from '../../src/delivery/bot-handlers';
import type { User } from '../../src/users/user.model';
import * as T from '../../src/delivery/templates/texts';
import { oiAlertsToggled } from '../../src/delivery/templates/oi-divergence.texts';
import { newInvite, settingsPatchFromWeb } from '../../src/users/members';
import { CustomLevels } from '../../src/alerts/levels/custom-levels';
import { MemoryCustomLevels } from '../alerts/levels/custom-levels.fixtures';

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
  dailyLossLimitPct: null, dexAlerts: false, calendarAlerts: true, oiAlerts: false, liqAlerts: false, fundingAlerts: false, levelAlerts: false, invitedBy: 1, disabled: false, createdAt: new Date('2026-09-01'),
};
const admin: User = { ...member, id: 1, tgUserId: 111, chatId: 111, role: 'admin' };

const CODE = 'abcdefghjkmnpqrs'; // 16 chars from the code alphabet

function harness(over: Partial<UsersPort> = {}, users: Record<number, User> = {}, oi: { membersVisible: boolean } | null = null, levels: CustomLevels | null = null) {
  const sent: string[] = [];
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const patches: Array<{ userId: number; patch: Record<string, unknown> }> = [];
  const invites: Array<{ code: string; createdBy: number; expiresAt: Date }> = [];

  const port: UsersPort = {
    findByTgUserId: async (id) => users[id] ?? null,
    consumeInvite: async () => ({ kind: 'refused' }),
    listUsers: async () => Object.values(users),
    updateSettings: async (userId, patch) => { patches.push({ userId, patch: patch as Record<string, unknown> }); return users[member.tgUserId] ?? null; },
    issueInvite: async (createdBy, at, ttlMs) => { const { code, expiresAt } = newInvite(at, ttlMs); invites.push({ code, createdBy, expiresAt }); return { code, createdBy, createdAt: at, expiresAt, usedBy: null, usedAt: null }; },
    setChatId: async () => {},
    ...over,
  };

  let web: { createCredentialsLink: (userId: number) => Promise<string | null>; hasCredentials?: boolean; siteUrl?: string | null; loginTokenTtlMs: number } | undefined;
  let failNext: string | null = null;
  const bot = new Bot('123:FAKE', { botInfo: BOT_INFO });
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === 'sendMessage' && failNext !== null) {
      const message = failNext;
      failNext = null; // only the rich attempt fails; the fallback must get through
      throw new Error(message);
    }
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === 'sendMessage') sent.push(String((payload as { text: string }).text));
    return { ok: true, result: { message_id: calls.length } } as never;
  });
  registerHandlers(bot, {
    users: port, botUsername: 'insight_test_bot', now: () => new Date('2026-09-28T12:00:00Z'),
    ...(oi ? { oiAlerts: { membersVisible: async () => oi.membersVisible } } : {}),
    ...(levels ? { customLevels: levels } : {}),
    web: {
      createCredentialsLink: (id) => (web ? web.createCredentialsLink(id) : Promise.resolve(null)),
      hasCredentials: async () => web?.hasCredentials ?? false,
      get siteUrl() { return web?.siteUrl ?? null; },
      get loginTokenTtlMs() { return web?.loginTokenTtlMs ?? 0; },
    },
  });
  return {
    bot, sent, calls, patches, invites,
    setWeb: (w: typeof web) => { web = w; },
    failNextSendWith: (message: string) => { failNext = message; },
  };
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
    expect(h.sent[0]).toContain('Календарь США: включён');
    expect(h.sent[0]).not.toContain('/deposit');
  });

  it.each(['/deposit 1000', '/deposit', '/risk 1', '/limit 3', '/dex on'])(
    'WD-013: %s is gone — a member gets UNKNOWN_COMMAND and NOTHING is written',
    async (body) => {
      const h = harness({}, { 222: member });
      await h.bot.handleUpdate(text(222, body) as never);
      expect(h.patches).toEqual([]);
      expect(h.sent).toEqual([T.UNKNOWN_COMMAND.ru]);
    },
  );

  it('/lang en is confirmed IN ENGLISH — the reply is the proof it took', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, '/lang en') as never);
    expect(h.patches).toEqual([{ userId: 2, patch: { lang: 'en' } }]);
    expect(h.sent[0]).toBe(T.saved('lang', 'en').en);
  });

  it('/calendar (IB-062) toggles, and /calendar on|off sets', async () => {
    const h = harness({}, { 222: member, 223: { ...member, id: 3, tgUserId: 223, chatId: 223, calendarAlerts: false } });
    await h.bot.handleUpdate(text(222, '/calendar') as never);
    await h.bot.handleUpdate(text(223, '/calendar') as never);
    await h.bot.handleUpdate(text(222, '/calendar on') as never);
    expect(h.patches).toEqual([
      { userId: 2, patch: { calendarAlerts: false } },
      { userId: 3, patch: { calendarAlerts: true } },
      { userId: 2, patch: { calendarAlerts: true } },
    ]);
    expect(h.sent).toEqual([T.calendarToggled(false).ru, T.calendarToggled(true).ru, T.calendarToggled(true).ru]);
  });

  it('/calendar with a word it does not know changes nothing', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, '/calendar maybe') as never);
    expect(h.patches).toEqual([]);
    expect(h.sent).toEqual([T.BAD_ON_OFF.ru]);
  });

  it('/settings shows the calendar line', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, '/settings') as never);
    expect(h.sent[0]).toContain('Календарь США: включён');
    expect(h.sent[0]).toContain('/calendar');
  });

  it('IB-112 /oialerts: hidden from a member until members_visible — answered like an unknown command, nothing written', async () => {
    const h = harness({}, { 222: member }, { membersVisible: false });
    await h.bot.handleUpdate(text(222, '/oialerts on') as never);
    await h.bot.handleUpdate(text(222, '/settings') as never);
    expect(h.patches).toEqual([]);
    expect(h.sent[0]).toBe(T.UNKNOWN_COMMAND.ru);
    expect(h.sent[1]).not.toContain('Сигналы OI');
    expect(h.sent[1]).not.toContain('/oialerts');
  });

  it('IB-112 /oialerts: visible to members → toggles and sets like /calendar; /settings shows the line', async () => {
    const h = harness({}, { 222: member }, { membersVisible: true });
    await h.bot.handleUpdate(text(222, '/oialerts') as never);
    await h.bot.handleUpdate(text(222, '/oialerts off') as never);
    await h.bot.handleUpdate(text(222, '/oialerts maybe') as never);
    expect(h.patches).toEqual([{ userId: 2, patch: { oiAlerts: true } }, { userId: 2, patch: { oiAlerts: false } }]);
    expect(h.sent).toEqual([oiAlertsToggled(true).ru, oiAlertsToggled(false).ru, T.BAD_ON_OFF.ru]);
    await h.bot.handleUpdate(text(222, '/settings') as never);
    expect(h.sent[3]).toContain('Сигналы OI: выключены');
    expect(h.sent[3]).toContain('/oialerts');
  });

  it('IB-112 /oialerts: an admin always has it, members_visible or not; no visibility port at all hides it from members', async () => {
    const h = harness({}, { 111: admin, 222: member });
    await h.bot.handleUpdate(text(111, '/oialerts on') as never);
    await h.bot.handleUpdate(text(222, '/oialerts on') as never);
    expect(h.patches).toEqual([{ userId: 1, patch: { oiAlerts: true } }]);
    expect(h.sent[1]).toBe(T.UNKNOWN_COMMAND.ru);
  });

  it('an unknown command from a MEMBER is answered, unlike a stranger\'s', async () => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, '/nonsense') as never);
    expect(h.sent).toEqual([T.UNKNOWN_COMMAND.ru]);
  });
});

describe('/password — the credentials link (IB-078 P1, P2)', () => {
  const LINK = 'https://dash.example.com/set-password?t=abc';

  it('sends a single-use SET-UP link to a member with no login, and says how long it lasts', async () => {
    const h = harness({}, { 222: member });
    h.setWeb({ createCredentialsLink: async () => LINK, hasCredentials: false, loginTokenTtlMs: 600_000 });
    await h.bot.handleUpdate(text(222, '/password') as never);
    expect(h.sent[0]).toContain(LINK);
    expect(h.sent[0]).toContain('10');
    expect(h.sent[0]).toContain('Задать логин и пароль');
    const markup = h.calls.find((c) => c.method === 'sendMessage')?.payload['reply_markup'] as { inline_keyboard: Array<Array<{ text: string; url: string }>> };
    expect(markup.inline_keyboard[0][0]).toEqual({ text: T.credentialsButton(false).ru, url: LINK });
  });

  it('says RESET to a member who already has a login', async () => {
    const h = harness({}, { 222: member });
    h.setWeb({ createCredentialsLink: async () => LINK, hasCredentials: true, loginTokenTtlMs: 600_000 });
    await h.bot.handleUpdate(text(222, '/password') as never);
    expect(h.sent[0]).toContain('Сброс пароля');
    const markup = h.calls.find((c) => c.method === 'sendMessage')?.payload['reply_markup'] as { inline_keyboard: Array<Array<{ text: string }>> };
    expect(markup.inline_keyboard[0][0].text).toBe(T.credentialsButton(true).ru);
  });

  it('IB-BUG-008: HTML with a tappable anchor AND an inline button, ONE token across them', async () => {
    const h = harness({}, { 222: member });
    const url = 'http://127.0.0.1:3005/set-password?t=abc';
    h.setWeb({ createCredentialsLink: async () => url, loginTokenTtlMs: 600_000 });
    await h.bot.handleUpdate(text(222, '/password') as never);

    const call = h.calls.find((c) => c.method === 'sendMessage');
    expect(call?.payload['parse_mode']).toBe('HTML');
    expect(String(call?.payload['text'])).toContain(`<a href="${url}">`);
    expect(String(call?.payload['text'])).toContain(url); // bare URL still underneath
    const tokens = String(call?.payload['text']).match(/t=([A-Za-z0-9_-]+)/g) ?? [];
    expect(new Set(tokens).size).toBe(1);
  });

  it('IB-BUG-008: falls back to plain text when Telegram refuses the rich message', async () => {
    const h = harness({}, { 222: member });
    h.setWeb({ createCredentialsLink: async () => 'http://localhost:3005/set-password?t=abc', loginTokenTtlMs: 600_000 });
    h.failNextSendWith('Bad Request: BUTTON_URL_INVALID');
    await h.bot.handleUpdate(text(222, '/password') as never);
    const last = h.sent[h.sent.length - 1];
    expect(last).toContain('http://localhost:3005/set-password?t=abc');
    expect(last).not.toContain('<a href');
  });

  it('escapes HTML so a URL can never break the markup', () => {
    expect(T.escapeHtml('a&b<c>')).toBe('a&amp;b&lt;c&gt;');
  });

  it('refuses when the dashboard is not configured, rather than sending a link to nowhere', async () => {
    const h = harness({}, { 222: member });
    h.setWeb({ createCredentialsLink: async () => null, loginTokenTtlMs: 600_000 });
    await h.bot.handleUpdate(text(222, '/password') as never);
    expect(h.sent).toEqual([T.WEB_NOT_CONFIGURED.ru]);
  });

  it('is unavailable to a stranger, like everything else', async () => {
    const h = harness();
    let issued = 0;
    h.setWeb({ createCredentialsLink: async () => { issued++; return 'https://x/set-password?t=y'; }, loginTokenTtlMs: 600_000 });
    await h.bot.handleUpdate(text(999, '/password') as never);
    expect(h.sent).toEqual([T.UNKNOWN_USER.ru]);
    expect(issued).toBe(0);
  });
});

describe('/start <code> — a new member gets the set-up link right away (IB-078 P2)', () => {
  it('welcome, then the credentials link', async () => {
    const h = harness({ consumeInvite: async () => ({ kind: 'joined', user: member }) });
    h.setWeb({ createCredentialsLink: async () => 'https://d.example.com/set-password?t=abc', loginTokenTtlMs: 600_000 });
    await h.bot.handleUpdate(text(222, `/start ${CODE}`) as never);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[0]).toBe(T.pick(T.welcome('X'), member.lang));
    expect(h.sent[1]).toContain('https://d.example.com/set-password?t=abc');
  });

  it('without a configured site: the welcome alone, as before', async () => {
    const h = harness({ consumeInvite: async () => ({ kind: 'joined', user: member }) });
    h.setWeb({ createCredentialsLink: async () => null, loginTokenTtlMs: 600_000 });
    await h.bot.handleUpdate(text(222, `/start ${CODE}`) as never);
    expect(h.sent).toEqual([T.pick(T.welcome('X'), member.lang)]);
  });
});

describe('/web — no longer a way in (IB-078 P2)', () => {
  it('answers with the site address and the /password hint, and issues NO link', async () => {
    const h = harness({}, { 222: member });
    let issued = 0;
    h.setWeb({ createCredentialsLink: async () => { issued++; return 'x'; }, siteUrl: 'https://dash.example.com', loginTokenTtlMs: 600_000 });
    await h.bot.handleUpdate(text(222, '/web') as never);
    expect(h.sent).toEqual([T.webHint('https://dash.example.com').ru]);
    expect(h.sent[0]).toContain('/password');
    expect(issued).toBe(0);
  });

  it('says the site is not configured when it is not', async () => {
    const h = harness({}, { 222: member });
    h.setWeb({ createCredentialsLink: async () => null, siteUrl: null, loginTokenTtlMs: 600_000 });
    await h.bot.handleUpdate(text(222, '/web') as never);
    expect(h.sent).toEqual([T.WEB_NOT_CONFIGURED.ru]);
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

describe('IB-128 /level — the owner\'s custom levels, admins only', () => {
  it('a member is refused and nothing is added', async () => {
    const store = new MemoryCustomLevels();
    const h = harness({}, { 222: member }, null, new CustomLevels(store));
    await h.bot.handleUpdate(text(222, '/level BTC 72000') as never);
    await h.bot.handleUpdate(text(222, '/level del 1') as never);
    await h.bot.handleUpdate(text(222, '/level') as never);
    expect(h.sent).toEqual([T.ADMIN_ONLY.ru, T.ADMIN_ONLY.ru, T.ADMIN_ONLY.ru]);
    expect(store.rows).toEqual([]);
  });

  it('the admin adds, gets the level and its id back in their language, and deletes it', async () => {
    const store = new MemoryCustomLevels();
    const h = harness({}, { 111: { ...admin, lang: 'en' } }, null, new CustomLevels(store));
    await h.bot.handleUpdate(text(111, '/level BTC 72000') as never);
    expect(h.sent[0]).toBe('Level added: #1 BTC 72,000\nDelete: /level del 1');
    expect(store.rows[0]).toMatchObject({ symbol: 'BTCUSDT', price: 72_000, createdBy: 1 });
    await h.bot.handleUpdate(text(111, '/level del 1') as never);
    expect(h.sent[1]).toBe('Level deleted: #1 BTC 72,000');
    expect(store.rows[0].deleted).toBe(true);
  });

  it('without the database /level does not exist', async () => {
    const h = harness({}, { 111: admin });
    await h.bot.handleUpdate(text(111, '/level BTC 72000') as never);
    expect(h.sent).toEqual([T.UNKNOWN_COMMAND.ru]);
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

describe('IB-035 — the site\'s settings PATCH accepts and refuses exactly what /lang and /calendar do', () => {
  // The bot hands its parser ONE token (the command's first argument), so parity is over single
  // tokens. A JSON value with a space inside ("en extra") is refused on the site, where the bot
  // would read only "en": stated, not hidden.
  const LANGS = ['en', 'EN', 'ru', 'Ru', 'de', 'english', 'рус', '1'];
  const SWITCHES = ['on', 'ON', 'off', 'вкл', 'выкл', 'да', 'нет', 'yes', 'no', '1', '0', 'true', 'false', 'maybe', 'enable', '2'];

  it.each(LANGS)('/lang %s — same verdict and same value on both paths', async (value) => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, `/lang ${value}`) as never);
    const bot = h.patches.length === 1 ? { ok: true, lang: h.patches[0].patch.lang } : { ok: false };
    const web = settingsPatchFromWeb({ lang: value });
    expect(web.ok ? { ok: true, lang: web.patch.lang } : { ok: false }).toEqual(bot);
  });

  it.each(SWITCHES)('/calendar %s — same verdict and same value on both paths', async (value) => {
    const h = harness({}, { 222: member });
    await h.bot.handleUpdate(text(222, `/calendar ${value}`) as never);
    const bot = h.patches.length === 1 ? { ok: true, on: h.patches[0].patch.calendarAlerts } : { ok: false };
    const web = settingsPatchFromWeb({ calendarAlerts: value });
    expect(web.ok ? { ok: true, on: web.patch.calendarAlerts } : { ok: false }).toEqual(bot);
  });

  it('a JSON boolean on the site means what /calendar true|false means in the bot', async () => {
    for (const [flag, word] of [[true, 'true'], [false, 'false']] as const) {
      const h = harness({}, { 222: member });
      await h.bot.handleUpdate(text(222, `/calendar ${word}`) as never);
      const web = settingsPatchFromWeb({ calendarAlerts: flag });
      expect(web.ok && web.patch.calendarAlerts).toBe(h.patches[0].patch.calendarAlerts);
    }
  });

  it('the parity table is not vacuous: each path both accepts and refuses something', () => {
    const verdicts = [...LANGS.map((v) => settingsPatchFromWeb({ lang: v }).ok), ...SWITCHES.map((v) => settingsPatchFromWeb({ calendarAlerts: v }).ok)];
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });
});
