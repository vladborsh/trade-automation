import { parseCommand, parseLang, parseOnOff } from '../../src/users/settings';

/**
 * IB-021 — what a member types into the bot. WD-013 deleted the number parsers (/deposit, /risk,
 * /limit) and their specs with those commands.
 */

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
    expect(parseCommand('/lang en')).toEqual({ command: 'lang', args: ['en'] });
    expect(parseCommand('/settings')).toEqual({ command: 'settings', args: [] });
    expect(parseCommand('  /calendar   off  ')).toEqual({ command: 'calendar', args: ['off'] });
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
