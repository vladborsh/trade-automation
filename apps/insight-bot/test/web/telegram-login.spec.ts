import { createHash, createHmac } from 'crypto';
import {
  TELEGRAM_LOGIN_MAX_AGE_MS, TELEGRAM_LOGIN_MAX_FUTURE_SKEW_MS, telegramDataCheckString, verifyTelegramLogin,
} from '../../src/web/auth/telegram-login';

/**
 * IB-072 / design M2 — the Telegram Login Widget check.
 *
 * The vector is BUILT HERE from a fake token, by the documented algorithm written out inline
 * (https://core.telegram.org/widgets/login#checking-authorization), not copied from a web page:
 * a "reference" hash from a search result would only prove we agree with whoever posted it.
 * The inline construction is deliberately independent of the module's helpers, so a bug in
 * `telegramDataCheckString` cannot sign its own vector.
 */
const FAKE_TOKEN = '123456:AAFakeTokenForSpecsOnly_xxxxxxxxxxxxxxx';
const AUTH_DATE = 1_793_000_000; // seconds
const NOW = AUTH_DATE * 1000 + 30_000;

type Payload = Record<string, string | number>;

/** Telegram's algorithm, spelled out by hand. */
function sign(fields: Payload, token = FAKE_TOKEN): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHash('sha256').update(token).digest(); // raw bytes, not hex
  return createHmac('sha256', secret).update(dataCheckString).digest('hex');
}

const fields: Payload = {
  id: 987654321, first_name: 'Ann', last_name: 'Lee', username: 'ann_lee',
  photo_url: 'https://t.me/i/userpic/320/ann.jpg', auth_date: AUTH_DATE,
};
const signed = (f: Payload = fields, token = FAKE_TOKEN): Payload => ({ ...f, hash: sign(f, token) });

describe('verifyTelegramLogin — signature', () => {
  it('a payload signed by the algorithm with this token is valid', () => {
    expect(verifyTelegramLogin(signed(), FAKE_TOKEN, NOW)).toEqual({ ok: true, tgUserId: 987654321 });
  });

  it('the minimal payload (no optional fields) is valid', () => {
    const minimal = { id: 5, first_name: 'Bo', auth_date: AUTH_DATE };
    expect(verifyTelegramLogin(signed(minimal), FAKE_TOKEN, NOW)).toEqual({ ok: true, tgUserId: 5 });
  });

  it.each(Object.keys(fields))('tampering with %s makes it invalid', (key) => {
    const p = signed();
    const v = p[key];
    p[key] = typeof v === 'number' ? v + 1 : `${v}x`;
    expect(verifyTelegramLogin(p, FAKE_TOKEN, NOW)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('dropping an optional field that was signed makes it invalid', () => {
    const p = signed();
    delete p.username;
    expect(verifyTelegramLogin(p, FAKE_TOKEN, NOW)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('a payload signed with ANOTHER bot token is invalid', () => {
    expect(verifyTelegramLogin(signed(fields, '999:OtherBot'), FAKE_TOKEN, NOW)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('the MINI-APP key (HMAC("WebAppData", token)) is invalid — the likely copy-paste error', () => {
    const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
    const webAppSecret = createHmac('sha256', 'WebAppData').update(FAKE_TOKEN).digest();
    const hash = createHmac('sha256', webAppSecret).update(dcs).digest('hex');
    expect(verifyTelegramLogin({ ...fields, hash }, FAKE_TOKEN, NOW)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('a hex-encoded secret (instead of raw SHA-256 bytes) is invalid', () => {
    const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
    const hexSecret = createHash('sha256').update(FAKE_TOKEN).digest('hex');
    const hash = createHmac('sha256', hexSecret).update(dcs).digest('hex');
    expect(verifyTelegramLogin({ ...fields, hash }, FAKE_TOKEN, NOW)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('an UNKNOWN extra field takes part in the signature (Telegram may add fields)', () => {
    const withExtra = { ...fields, allows_future_thing: 'yes' };
    const p = signed(withExtra);
    expect(verifyTelegramLogin(p, FAKE_TOKEN, NOW)).toEqual({ ok: true, tgUserId: 987654321 });
    // and it is really signed: changing it breaks the hash, removing it too
    expect(verifyTelegramLogin({ ...p, allows_future_thing: 'no' }, FAKE_TOKEN, NOW).ok).toBe(false);
    const { allows_future_thing: _gone, ...without } = p;
    expect(verifyTelegramLogin(without, FAKE_TOKEN, NOW).ok).toBe(false);
  });

  it('an extra field ADDED after signing is invalid (it is not ignored)', () => {
    expect(verifyTelegramLogin({ ...signed(), role: 'admin' }, FAKE_TOKEN, NOW)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('a hash of the wrong length or in upper case is invalid, not a crash', () => {
    const p = signed();
    expect(verifyTelegramLogin({ ...p, hash: 'abc' }, FAKE_TOKEN, NOW)).toEqual({ ok: false, reason: 'bad_hash' });
    expect(verifyTelegramLogin({ ...p, hash: String(p.hash).toUpperCase() }, FAKE_TOKEN, NOW)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('an empty bot token never validates anything', () => {
    expect(verifyTelegramLogin(signed(fields, ''), '', NOW)).toEqual({ ok: false, reason: 'bad_hash' });
  });
});

describe('verifyTelegramLogin — freshness', () => {
  it('exactly 10 minutes old is still valid', () => {
    expect(verifyTelegramLogin(signed(), FAKE_TOKEN, AUTH_DATE * 1000 + TELEGRAM_LOGIN_MAX_AGE_MS).ok).toBe(true);
  });

  it('older than 10 minutes is expired', () => {
    expect(verifyTelegramLogin(signed(), FAKE_TOKEN, AUTH_DATE * 1000 + TELEGRAM_LOGIN_MAX_AGE_MS + 1000))
      .toEqual({ ok: false, reason: 'expired' });
  });

  it('up to 60 s in the future is tolerated as clock skew', () => {
    expect(verifyTelegramLogin(signed(), FAKE_TOKEN, AUTH_DATE * 1000 - TELEGRAM_LOGIN_MAX_FUTURE_SKEW_MS).ok).toBe(true);
  });

  it('more than 60 s in the future is refused', () => {
    expect(verifyTelegramLogin(signed(), FAKE_TOKEN, AUTH_DATE * 1000 - TELEGRAM_LOGIN_MAX_FUTURE_SKEW_MS - 1000))
      .toEqual({ ok: false, reason: 'future' });
  });

  it('freshness is checked only on a VALID signature — a forged auth_date gets bad_hash', () => {
    const p = { ...signed(), auth_date: AUTH_DATE - 3600 };
    expect(verifyTelegramLogin(p, FAKE_TOKEN, NOW)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('the window constants are the ones the design names', () => {
    expect(TELEGRAM_LOGIN_MAX_AGE_MS).toBe(10 * 60 * 1000);
    expect(TELEGRAM_LOGIN_MAX_FUTURE_SKEW_MS).toBe(60 * 1000);
  });
});

describe('telegramDataCheckString', () => {
  it('sorts by key, excludes hash, joins key=value with \\n', () => {
    expect(telegramDataCheckString({ b: 2, hash: 'h', a: 'x', c: 'y' })).toBe('a=x\nb=2\nc=y');
  });
});
