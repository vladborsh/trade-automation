import { vi } from 'vitest';
import { PositionToolsStore, type PositionToolsDeps } from './position-tools.store';

function setup(over: Partial<PositionToolsDeps> = {}) {
  let n = 0;
  const deps: PositionToolsDeps = {
    lastClose: () => 100,
    anchorTime: () => 5_000,
    precision: () => 2,
    activated: vi.fn(),
    hint: vi.fn(),
    newId: () => `t${++n}`,
    ...over,
  };
  return { store: new PositionToolsStore(deps), deps };
}

describe('PositionToolsStore (design §9.1, decision 29)', () => {
  it('B/S create a draft at the pointer price, or the last close off-chart; the newest is the active one', () => {
    const { store, deps } = setup();
    store.create('long'); // off-chart → last close → market
    store.pointerPrice.set(98);
    store.create('long'); // at the pointer → limit
    expect(store.tools().map((t) => [t.id, t.mode, t.entry, t.active])).toEqual([
      ['t1', 'market', 100, false],
      ['t2', 'limit', 98, true],
    ]);
    expect(store.active()?.id).toBe('t2');
    expect(deps.activated).toHaveBeenCalledTimes(2);
  });

  it('T-050: a draft is anchored at the bar under the pointer — never later than the last bar — or at the last bar off-chart', () => {
    const { store } = setup(); // the last bar opens at 5 000
    store.create('long');
    store.pointerTime.set(3_000); // the pointer over an older bar
    store.create('long');
    store.pointerTime.set(9_000); // over the empty space right of the last bar
    store.create('short');
    expect(store.tools().map((t) => t.anchorTime)).toEqual([5_000, 3_000, 5_000]);
  });

  it('clicking a tool activates it; deactivate clears it (another panel took over)', () => {
    const { store } = setup();
    store.create('long');
    store.create('short');
    store.apply({ type: 'activate', id: 't1' });
    expect(store.active()?.id).toBe('t1');
    store.deactivate();
    expect(store.active()).toBeNull();
  });

  it('Esc removes only the active draft', () => {
    const { store } = setup();
    store.create('long');
    store.create('short');
    expect(store.removeActiveDraft()).toBe(true);
    expect(store.tools().map((t) => t.id)).toEqual(['t1']);
    expect(store.removeActiveDraft()).toBe(false); // nothing active now
    expect(store.tools()).toHaveLength(1);
  });

  it('drag updates replace the tool but keep its active flag; hints are forwarded', () => {
    const { store, deps } = setup();
    const t = store.create('long')!;
    store.apply({ type: 'update', tool: { ...t, sl: 99, active: false }, final: true });
    expect(store.tools()[0]).toMatchObject({ sl: 99, active: true });
    store.apply({ type: 'hint', message: 'nope' });
    expect(deps.hint).toHaveBeenCalledWith('nope');
  });

  it('a market draft follows the last close keeping its distances; a limit stays', () => {
    const { store } = setup();
    store.create('long'); // market at 100, sl 99.5, tp 101
    store.pointerPrice.set(98);
    store.create('long'); // limit 98
    store.followLastClose(100.4);
    expect(store.tools().map((t) => [t.mode, t.entry, t.sl, t.tp])).toEqual([
      ['market', 100.4, 99.9, 101.4],
      ['limit', 98, 97.51, 98.98],
    ]);
  });

  it('before the panel has a price: a hint, no draft', () => {
    const { store, deps } = setup({ lastClose: () => null });
    expect(store.create('long')).toBeNull();
    expect(deps.hint).toHaveBeenCalledWith('No price on this panel yet.');
    expect(store.tools()).toEqual([]);
  });
});
