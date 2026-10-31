import { WEB_AUTH_ERROR_CODES, WebTelegramLoginRequestSchema } from '../src/insight/auth';

/**
 * IB-072 — the widget payload contract. The property that matters is that unknown fields
 * survive parsing: Telegram signs every field it sends, so stripping one breaks every login.
 */
const base = {
  id: 123456789, first_name: 'Ann', auth_date: 1_793_000_000,
  hash: 'a'.repeat(64),
};

describe('WebTelegramLoginRequest', () => {
  it('accepts the minimal widget payload', () => {
    expect(WebTelegramLoginRequestSchema.parse(base)).toEqual(base);
  });

  it('KEEPS an unknown field — it is part of what Telegram signed', () => {
    const withExtra = { ...base, username: 'ann', photo_url: 'https://t.me/i/u.jpg', some_new_field: 'x', n: 5 };
    expect(WebTelegramLoginRequestSchema.parse(withExtra)).toEqual(withExtra);
  });

  it('refuses an unknown field that is not a string or number', () => {
    expect(WebTelegramLoginRequestSchema.safeParse({ ...base, nested: { a: 1 } }).success).toBe(false);
  });

  it('refuses a hash that is not 64 lower-case hex', () => {
    expect(WebTelegramLoginRequestSchema.safeParse({ ...base, hash: 'zz' }).success).toBe(false);
    expect(WebTelegramLoginRequestSchema.safeParse({ ...base, hash: 'A'.repeat(64) }).success).toBe(false);
  });

  it('refuses a payload without id or auth_date', () => {
    const { id: _id, ...noId } = base;
    const { auth_date: _d, ...noDate } = base;
    expect(WebTelegramLoginRequestSchema.safeParse(noId).success).toBe(false);
    expect(WebTelegramLoginRequestSchema.safeParse(noDate).success).toBe(false);
  });

  it('names NOT_A_MEMBER and TELEGRAM_LOGIN_UNAVAILABLE among the auth codes', () => {
    expect(WEB_AUTH_ERROR_CODES).toEqual(expect.arrayContaining(['NOT_A_MEMBER', 'TELEGRAM_LOGIN_UNAVAILABLE']));
  });
});
