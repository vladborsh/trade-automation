import { adjacentTimeframe, replayKeyAction } from './replay-keys';

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
