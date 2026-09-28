import * as T from '../../src/delivery/templates/texts';
import type { Lang } from '../../src/users/user.model';

/**
 * IB-021 §8.6 — templates are pure functions with specs. Two rules carry weight beyond wording:
 * an unknown user learns nothing, and every text exists in both languages.
 */

const LANGS: Lang[] = ['ru', 'en'];

describe('the unknown user gets one line and nothing else (§8.6)', () => {
  it('is a single line in both languages', () => {
    for (const lang of LANGS) {
      const text = T.pick(T.UNKNOWN_USER, lang);
      expect(text.split('\n')).toHaveLength(1);
      expect(text.length).toBeLessThan(60);
    }
  });

  it('never leaks that invites, commands or an admin exist', () => {
    for (const lang of LANGS) {
      const text = T.pick(T.UNKNOWN_USER, lang).toLowerCase();
      for (const leak of ['invite', 'код', 'code', '/start', 'admin', 'админ', 'ссылк']) {
        expect(text).not.toContain(leak);
      }
    }
  });
});

describe('a refused invite is indistinguishable across causes', () => {
  it('wrong, used and expired all produce the SAME text', () => {
    // three different causes, one message: probing codes must yield no signal
    for (const lang of LANGS) {
      expect(T.pick(T.INVITE_REFUSED, lang)).toBe(T.INVITE_REFUSED[lang]);
      expect(T.pick(T.INVITE_REFUSED, lang).toLowerCase()).not.toMatch(/expired|used|истёк|использован/);
    }
  });
});

describe('every template has both languages and neither is empty', () => {
  const samples: Record<string, T.Texts> = {
    UNKNOWN_USER: T.UNKNOWN_USER,
    INVITE_REFUSED: T.INVITE_REFUSED,
    ALREADY_MEMBER: T.ALREADY_MEMBER,
    BAD_LANG: T.BAD_LANG,
    BAD_ON_OFF: T.BAD_ON_OFF,
    ADMIN_ONLY: T.ADMIN_ONLY,
    UNKNOWN_COMMAND: T.UNKNOWN_COMMAND,
    welcome: T.welcome('Vlad'),
    settings: T.settings({ deposit: 1000, riskPct: 1, dailyLossLimitPct: 3, dexAlerts: false, lang: 'ru' }),
    saved: T.saved('deposit', '1000'),
    badNumber: T.badNumber('risk', 0.1, 10, '/risk 1'),
    missingArgument: T.missingArgument('/deposit 1000'),
    inviteCreated: T.inviteCreated('https://t.me/b?start=x', new Date('2026-10-05T12:00:00Z')),
    userList: T.userList([{ tgUserId: 1, role: 'admin', disabled: false, createdAt: new Date('2026-09-01') }]),
  };

  it.each(Object.keys(samples))('%s is present and distinct in ru and en', (name) => {
    const texts = samples[name];
    for (const lang of LANGS) {
      expect(texts[lang]).toBeTruthy();
      expect(texts[lang].trim()).not.toBe('');
    }
    expect(texts.ru).not.toBe(texts.en); // an untranslated copy is a bug, not a shortcut
  });
});

describe('commands, codes and tickers stay English in both languages (§8.6)', () => {
  it('the Russian settings text still says /deposit, not a translated command', () => {
    const ru = T.pick(T.settings({ deposit: null, riskPct: 1, dailyLossLimitPct: null, dexAlerts: true, lang: 'ru' }), 'ru');
    expect(ru).toContain('/deposit');
    expect(ru).toContain('/risk');
    expect(ru).toContain('/lang');
  });
});

describe('settings text', () => {
  it('says "not set" rather than inventing a deposit', () => {
    const ru = T.pick(T.settings({ deposit: null, riskPct: 1, dailyLossLimitPct: null, dexAlerts: false, lang: 'ru' }), 'ru');
    expect(ru).toContain('не задан');
    expect(ru).not.toContain('0 USDT'); // a null deposit is not a zero deposit
  });

  it('shows the values it does have', () => {
    const en = T.pick(T.settings({ deposit: 12500.5, riskPct: 1.5, dailyLossLimitPct: 3, dexAlerts: true, lang: 'en' }), 'en');
    expect(en).toContain('12,500.5 USDT');
    expect(en).toContain('1.50%');
    expect(en).toContain('3%');
    expect(en).toContain('on');
  });
});

describe('badNumber', () => {
  it('names the accepted range and an example, not just "invalid"', () => {
    const ru = T.pick(T.badNumber('Риск', 0.1, 10, '/risk 1'), 'ru');
    expect(ru).toContain('0.1');
    expect(ru).toContain('10');
    expect(ru).toContain('/risk 1');
  });
});

describe('userList', () => {
  it('says plainly when there is nobody', () => {
    expect(T.pick(T.userList([]), 'ru')).toBe('Пока никого нет.');
  });

  it('marks a disabled member rather than hiding them', () => {
    const text = T.pick(T.userList([
      { tgUserId: 111, role: 'admin', disabled: false, createdAt: new Date('2026-09-01T00:00:00Z') },
      { tgUserId: 222, role: 'member', disabled: true, createdAt: new Date('2026-09-02T00:00:00Z') },
    ]), 'en');
    expect(text).toContain('Members (2)');
    expect(text).toContain('222 — member (disabled)');
  });
});
