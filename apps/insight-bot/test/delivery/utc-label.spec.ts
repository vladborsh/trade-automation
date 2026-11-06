import * as T from '../../src/delivery/templates/texts';
import { utcTime } from '../../src/delivery/templates/level-alerts.texts';
import { utcHhmm } from '../../src/delivery/templates/liq-alerts.texts';
import { UTC_LABEL, utc } from '../../src/delivery/templates/utc-label';

/**
 * IB-152 (owner ruling A): every time a Telegram message prints names its zone. The bot runs in UTC
 * (main.ts), so the label is «UTC», from one helper. Each template that prints a time is listed here;
 * the formats themselves are unchanged (their own specs still pin them).
 */
describe('the zone label on every Telegram time (IB-152)', () => {
  const AT = Date.UTC(2026, 10, 6, 15, 6);

  it('the helper appends the one label', () => {
    expect(UTC_LABEL).toBe('UTC');
    expect(utc('15:06')).toBe('15:06 UTC');
  });

  it('liquidation T0, level times, the calendar line and the invite expiry carry it', () => {
    expect(utcHhmm(AT)).toBe('15:06 UTC');
    expect(utcTime(AT, 'ru')).toBe('6 ноя 15:06 UTC');
    expect(T.calendarTime(AT, 'en')).toBe('15:06 UTC / 17:06 Kyiv');
    expect(T.pick(T.inviteCreated('https://x/i/abc', new Date(AT)), 'en')).toBe('Single-use link, valid until 2026-11-06 15:06 UTC:\nhttps://x/i/abc');
  });

  it('/users: the sign-up date, the one time that had no zone, now names it', () => {
    const text = T.pick(T.userList([{ tgUserId: 111, role: 'admin', disabled: false, createdAt: new Date('2026-09-01T00:00:00Z') }]), 'en');
    expect(text).toBe('Members (1):\n• 111 — admin, 2026-09-01 UTC');
  });
});
