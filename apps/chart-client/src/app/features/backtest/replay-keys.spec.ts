import { adjacentTimeframe, keyAllowed, replayKeyAction, type ReplayKeyAction } from './replay-keys';

const key = (k: string, target: unknown = { tagName: 'BODY' }, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}) =>
  replayKeyAction({ key: k, target: target as EventTarget, altKey: false, ctrlKey: false, metaKey: false, ...mods });

describe('replayKeyAction (decision 37b)', () => {
  it('→ steps, [ and ] switch timeframe', () => {
    expect(key('ArrowRight')).toBe('step');
    expect(key('[')).toBe('finer');
    expect(key(']')).toBe('coarser');
    expect(key('ArrowLeft')).toBeNull(); // there is no step backwards (decision 37)
    expect(key('c')).toBeNull();
  });

  it('B / S place a long / short tool (either case), Esc cancels, Enter orders (T-022)', () => {
    expect([key('b'), key('B'), key('s'), key('S'), key('Escape'), key('Enter')]).toEqual(['long', 'long', 'short', 'short', 'cancel', 'order']);
    expect(key('s', undefined, { metaKey: true })).toBeNull(); // ⌘S / Ctrl+S stay the browser's
    expect(key('b', { tagName: 'INPUT' })).toBeNull();
  });

  it('is ignored while typing and with a modifier held', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) expect(key('ArrowRight', { tagName })).toBeNull();
    expect(key('ArrowRight', { tagName: 'DIV', isContentEditable: true })).toBeNull();
    expect(key('ArrowRight', undefined, { metaKey: true })).toBeNull();
    expect(key(']', undefined, { ctrlKey: true })).toBeNull();
  });
});

describe('adjacentTimeframe', () => {
  it('moves one step and clamps at the ends', () => {
    expect(adjacentTimeframe('5m', 'coarser')).toBe('15m');
    expect(adjacentTimeframe('5m', 'finer')).toBe('1m');
    expect(adjacentTimeframe('1m', 'finer')).toBe('1m');
    expect(adjacentTimeframe('1d', 'coarser')).toBe('1d');
  });
});

describe('keyAllowed', () => {
  const all: ReplayKeyAction[] = ['step', 'finer', 'coarser', 'long', 'short', 'cancel', 'order'];
  const allowed = (mode: { completed: boolean; viewOnly: boolean }) => all.filter((a) => keyAllowed(a, mode));

  it('a live session: every key', () => {
    expect(allowed({ completed: false, viewOnly: false })).toEqual(all);
  });

  it('a complete session: nothing', () => {
    expect(allowed({ completed: true, viewOnly: false })).toEqual([]);
  });

  it('viewing the past (§9.3): only the timeframe, even on a complete session — never a step, a tool or an order', () => {
    expect(allowed({ completed: false, viewOnly: true })).toEqual(['finer', 'coarser']);
    expect(allowed({ completed: true, viewOnly: true })).toEqual(['finer', 'coarser']);
  });
});
