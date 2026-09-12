import { ChartSyncService, sameRange } from './chart-sync.service';

describe('sameRange', () => {
  it('is false when either range is null', () => {
    expect(sameRange(null, { from: 1, to: 2 }, 1)).toBe(false);
    expect(sameRange({ from: 1, to: 2 }, null, 1)).toBe(false);
    expect(sameRange(null, null, 1)).toBe(false);
  });

  it('is true when both ends are within epsilon', () => {
    expect(sameRange({ from: 100, to: 200 }, { from: 101, to: 199 }, 2)).toBe(true);
  });

  it('is false when either end drifts past epsilon', () => {
    expect(sameRange({ from: 100, to: 200 }, { from: 105, to: 200 }, 2)).toBe(false);
    expect(sameRange({ from: 100, to: 200 }, { from: 100, to: 210 }, 2)).toBe(false);
  });
});

describe('ChartSyncService', () => {
  it('starts with no range and no origin', () => {
    const sync = new ChartSyncService();
    expect(sync.range()).toBeNull();
    expect(sync.origin()).toBeNull();
  });

  it('propose sets the range and records the proposing panel as origin', () => {
    const sync = new ChartSyncService();
    sync.propose('panel-a', { from: 1000, to: 2000 }, 30);
    expect(sync.range()).toEqual({ from: 1000, to: 2000 });
    expect(sync.origin()).toBe('panel-a');
  });

  it('a later proposal from a different panel overwrites the range and origin (latest gesture wins)', () => {
    const sync = new ChartSyncService();
    sync.propose('panel-a', { from: 1000, to: 2000 }, 30);
    sync.propose('panel-b', { from: 1500, to: 2500 }, 30);
    expect(sync.range()).toEqual({ from: 1500, to: 2500 });
    expect(sync.origin()).toBe('panel-b');
  });

  it('drift guard: a proposal within epsilon of the current range is dropped, even from a different panel', () => {
    const sync = new ChartSyncService();
    sync.propose('panel-a', { from: 1000, to: 2000 }, 30);
    sync.propose('panel-b', { from: 1010, to: 1990 }, 30); // within epsilon on both ends
    expect(sync.range()).toEqual({ from: 1000, to: 2000 });
    expect(sync.origin()).toBe('panel-a'); // unchanged — the proposal was dropped
  });

  it('a proposal past epsilon from a different panel is accepted', () => {
    const sync = new ChartSyncService();
    sync.propose('panel-a', { from: 1000, to: 2000 }, 30);
    sync.propose('panel-b', { from: 1100, to: 2000 }, 30); // 100s drift > 30s epsilon
    expect(sync.range()).toEqual({ from: 1100, to: 2000 });
    expect(sync.origin()).toBe('panel-b');
  });

  it('reset clears both range and origin', () => {
    const sync = new ChartSyncService();
    sync.propose('panel-a', { from: 1000, to: 2000 }, 30);
    sync.reset();
    expect(sync.range()).toBeNull();
    expect(sync.origin()).toBeNull();
  });
});
