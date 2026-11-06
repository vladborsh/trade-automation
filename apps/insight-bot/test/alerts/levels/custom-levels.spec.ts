import { CUSTOM_LEVELS_PER_COIN_MAX, CUSTOM_LEVEL_NOTE_MAX, WebCustomLevelsResponseSchema } from '@trade-automation/contracts';
import { CustomLevelError, CustomLevels, onlyExceptions, parseLevelCommand } from '../../../src/alerts/levels/custom-levels';
import { handleLevelCommand } from '../../../src/delivery/level-command';
import { MemoryCustomLevels } from './custom-levels.fixtures';

/** IB-128 (design §4 P9) — the `/level` command's parsing, the service's rules, and the command end to end. */

describe('IB-128 parseLevelCommand', () => {
  it('a bare /level lists', () => expect(parseLevelCommand([])).toEqual({ kind: 'list' }));

  it('/level BTC 72000 adds; a note is the rest of the line', () => {
    expect(parseLevelCommand(['BTC', '72000'])).toEqual({ kind: 'add', ticker: 'BTC', price: 72_000, note: null });
    expect(parseLevelCommand(['trx', '0.3125', 'range', 'high'])).toEqual({ kind: 'add', ticker: 'trx', price: 0.3125, note: 'range high' });
  });

  it('the price: positive, a dot for decimals; a comma is refused, not guessed', () => {
    expect(parseLevelCommand(['BTC', '72,000'])).toEqual({ kind: 'error', reason: 'comma' });
    expect(parseLevelCommand(['BTC', '0,31'])).toEqual({ kind: 'error', reason: 'comma' });
    for (const bad of ['0', '-5', 'abc', '1e5', '72000.', '.5', 'Infinity', '0x10']) {
      expect(parseLevelCommand(['BTC', bad])).toEqual({ kind: 'error', reason: 'bad_price' });
    }
  });

  it('the ticker and the shape', () => {
    expect(parseLevelCommand(['BTC'])).toEqual({ kind: 'error', reason: 'usage' });
    expect(parseLevelCommand(['B', '1'])).toEqual({ kind: 'error', reason: 'usage' });
    expect(parseLevelCommand(['BTC/USDT', '1'])).toEqual({ kind: 'error', reason: 'usage' });
  });

  it('a note too long', () => {
    expect(parseLevelCommand(['BTC', '1', 'x'.repeat(CUSTOM_LEVEL_NOTE_MAX + 1)])).toEqual({ kind: 'error', reason: 'note_too_long' });
    expect(parseLevelCommand(['BTC', '1', 'x'.repeat(CUSTOM_LEVEL_NOTE_MAX)]).kind).toBe('add');
  });

  it('/level del <id>', () => {
    expect(parseLevelCommand(['del', '12'])).toEqual({ kind: 'del', id: 12 });
    expect(parseLevelCommand(['DEL', '12'])).toEqual({ kind: 'del', id: 12 });
    for (const bad of [[], ['x'], ['0'], ['-1'], ['1.5'], ['1', '2']]) expect(parseLevelCommand(['del', ...bad])).toEqual({ kind: 'error', reason: 'bad_id' });
  });
});

describe('IB-128 CustomLevels', () => {
  it('switches are stored as the exceptions only', () => {
    expect(onlyExceptions({}, { sweep_above: false })).toEqual({ sweep_above: false });
    expect(onlyExceptions({ sweep_above: false }, { sweep_above: true })).toEqual({});
    expect(onlyExceptions({ sweep_above: false }, { breakout_up: true })).toEqual({ sweep_above: false });
  });

  it('add, list (effective switches), switch, delete — a deleted level leaves the list', async () => {
    const store = new MemoryCustomLevels();
    const svc = new CustomLevels(store);
    const l = await svc.add({ symbol: 'BTCUSDT', price: 72_000, note: 'range high', events: { sweep_below: false } }, 1);
    const list = WebCustomLevelsResponseSchema.parse(await svc.list());
    expect(list.levels).toEqual([{
      id: l.id, symbol: 'BTCUSDT', base: 'BTC', price: 72_000, note: 'range high', createdBy: 1, createdAt: 1,
      events: { breakout_up: true, breakout_down: true, sweep_above: true, sweep_below: false },
    }]);
    await svc.setEvents(l.id, { sweep_below: true, breakout_up: false });
    expect(store.rows[0].events).toEqual({ breakout_up: false });
    await svc.remove(l.id, 1);
    expect((await svc.list()).levels).toEqual([]);
    await expect(svc.remove(l.id, 1)).rejects.toMatchObject({ reason: 'not_found' });
    await expect(svc.setEvents(l.id, { breakout_up: true })).rejects.toBeInstanceOf(CustomLevelError);
  });

  it('a coin off the alert list, and a coin at its cap, are refused', async () => {
    const svc = new CustomLevels(new MemoryCustomLevels());
    await expect(svc.add({ symbol: 'DOGEUSDT', price: 1 }, 1)).rejects.toMatchObject({ reason: 'not_listed' });
    for (let i = 0; i < CUSTOM_LEVELS_PER_COIN_MAX; i++) await svc.add({ symbol: 'BTCUSDT', price: 1 + i }, 1);
    await expect(svc.add({ symbol: 'BTCUSDT', price: 99 }, 1)).rejects.toMatchObject({ reason: 'too_many' });
  });
});

describe('IB-128 /level (an admin; the role is the handler\'s, bot-handlers.spec)', () => {
  it('adds by base and answers with the level and its id; lists; deletes', async () => {
    const svc = new CustomLevels(new MemoryCustomLevels());
    const added = await handleLevelCommand(svc, ['btc', '72000', 'range', 'high'], 1);
    expect(added.ru).toBe('Уровень добавлен: #1 BTC 72\u00a0000 — range high\nУдалить: /level del 1');
    expect(added.en).toBe('Level added: #1 BTC 72,000 — range high\nDelete: /level del 1');
    expect((await handleLevelCommand(svc, ['TRXUSDT', '0.3125'], 1)).en).toContain('#2 TRX 0.3125');
    expect((await handleLevelCommand(svc, [], 1)).en).toBe('Custom levels:\n#1 BTC 72,000 — range high\n#2 TRX 0.31250\nDelete: /level del <id>');
    expect((await handleLevelCommand(svc, ['del', '1'], 1)).ru).toBe('Уровень удалён: #1 BTC 72\u00a0000 — range high');
    expect((await handleLevelCommand(svc, ['del', '1'], 1)).en).toBe('No active level with that id');
    expect((await handleLevelCommand(svc, [], 1)).en).not.toContain('#1');
  });

  it('errors answer in words: unknown coin, comma, usage; an empty list says how to add', async () => {
    const svc = new CustomLevels(new MemoryCustomLevels());
    expect((await handleLevelCommand(svc, [], 1)).en).toBe('No custom levels. Add one: /level BTC 72000');
    expect((await handleLevelCommand(svc, ['DOGE', '1'], 1)).en).toBe('That coin is not on the alert list (/admin/alerts)');
    expect((await handleLevelCommand(svc, ['BTC', '72,5'], 1)).ru).toContain('точкой');
    expect((await handleLevelCommand(svc, ['BTC'], 1)).en).toContain('Usage: /level BTC 72000');
  });
});
