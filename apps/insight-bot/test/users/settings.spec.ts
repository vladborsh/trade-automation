import {
  LIMIT_MAX, LIMIT_MIN, parseCommand, parseDeposit, parseLang, parseLimitPct, parseNumber,
  parseOnOff, parseRiskPct, RISK_MAX, RISK_MIN,
} from '../../src/users/settings';

/**
 * IB-021 — these values feed position sizing and the daily loss limit, so a silently
 * mis-parsed number is a sizing error, not a cosmetic one.
 */

describe('parseNumber', () => {
  it('accepts the shapes a phone keyboard produces', () => {
    expect(parseNumber('1000')).toEqual({ ok: true, value: 1000 });
    expect(parseNumber(' 1000 ')).toEqual({ ok: true, value: 1000 });
    expect(parseNumber('1 000')).toEqual({ ok: true, value: 1000 });
    expect(parseNumber('1_000')).toEqual({ ok: true, value: 1000 });
    expect(parseNumber('1.5')).toEqual({ ok: true, value: 1.5 });
    expect(parseNumber('1,5')).toEqual({ ok: true, value: 1.5 }); // Russian decimal comma
  });

  it('refuses a string with BOTH separators rather than guessing the locale', () => {
    // '1,234.5' is 1234.5 to one reader and nonsense to another; guessing is a sizing error
    expect(parseNumber('1,234.5')).toEqual({ ok: false, reason: 'not_a_number' });
  });

  it('refuses junk instead of coercing it', () => {
    for (const bad of ['', '   ', 'abc', '1abc', '--5', '1.2.3', 'NaN', 'Infinity', '1e5']) {
      expect(parseNumber(bad).ok).toBe(false);
    }
  });

  it('an empty value is "missing", which the caller answers differently from junk', () => {
    expect(parseNumber(undefined)).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('range checks', () => {
  it('risk is bounded — a fat-fingered /risk 100 must not size the whole deposit', () => {
    expect(parseRiskPct('1')).toEqual({ ok: true, value: 1 });
    expect(parseRiskPct('100')).toEqual({ ok: false, reason: 'out_of_range', min: RISK_MIN, max: RISK_MAX });
    expect(parseRiskPct('0')).toEqual({ ok: false, reason: 'out_of_range', min: RISK_MIN, max: RISK_MAX });
    expect(parseRiskPct('-1')).toMatchObject({ ok: false, reason: 'out_of_range' });
  });

  it('the daily loss limit is bounded too', () => {
    expect(parseLimitPct('3')).toEqual({ ok: true, value: 3 });
    expect(parseLimitPct('0.1')).toEqual({ ok: false, reason: 'out_of_range', min: LIMIT_MIN, max: LIMIT_MAX });
  });

  it('deposit rejects zero and negatives', () => {
    expect(parseDeposit('1000')).toEqual({ ok: true, value: 1000 });
    expect(parseDeposit('0')).toMatchObject({ ok: false, reason: 'out_of_range' });
    expect(parseDeposit('-100')).toMatchObject({ ok: false, reason: 'out_of_range' });
  });
});

describe('parseLang / parseOnOff', () => {
  it('takes the two languages, case-insensitively', () => {
    expect(parseLang('ru')).toEqual({ ok: true, value: 'ru' });
    expect(parseLang('EN')).toEqual({ ok: true, value: 'en' });
    expect(parseLang('de')).toMatchObject({ ok: false });
  });

  it('understands on/off in both languages, since the prose is Russian', () => {
    for (const on of ['on', 'ON', 'вкл', 'да', '1', 'true']) expect(parseOnOff(on)).toEqual({ ok: true, value: true });
    for (const off of ['off', 'выкл', 'нет', '0', 'false']) expect(parseOnOff(off)).toEqual({ ok: true, value: false });
    expect(parseOnOff('maybe')).toMatchObject({ ok: false });
  });
});

describe('parseCommand', () => {
  it('splits a command and its arguments', () => {
    expect(parseCommand('/deposit 1000')).toEqual({ command: 'deposit', args: ['1000'] });
    expect(parseCommand('/settings')).toEqual({ command: 'settings', args: [] });
    expect(parseCommand('  /risk   1.5  ')).toEqual({ command: 'risk', args: ['1.5'] });
  });

  it('strips the @botname a group chat appends', () => {
    expect(parseCommand('/invite@insight_test_bot')).toEqual({ command: 'invite', args: [] });
  });

  it('is case-insensitive on the command, since phones capitalise', () => {
    expect(parseCommand('/Settings')).toEqual({ command: 'settings', args: [] });
  });

  it('plain text is not a command', () => {
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('/')).toBeNull();
  });
});
