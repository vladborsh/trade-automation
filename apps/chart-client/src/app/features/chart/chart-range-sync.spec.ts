import { vi } from 'vitest';
import type { IChartApi } from 'lightweight-charts';
import { ChartRangeSync, type RangeSyncHost } from './chart-range-sync';
import { ChartSyncService } from './chart-sync.service';

const TF = 300;
const TIMES = [0, 300, 600, 900, 1200]; // five 5m bars

function setup(overrides: Partial<RangeSyncHost> = {}) {
  let logical: { from: number; to: number } | null = { from: 0, to: 4 };
  const timeScale = {
    setVisibleLogicalRange: vi.fn((r: { from: number; to: number }) => void (logical = r)),
    getVisibleLogicalRange: vi.fn(() => logical),
  };
  const chart = { timeScale: () => timeScale } as unknown as IChartApi;
  const sync = new ChartSyncService();
  const propose = vi.spyOn(sync, 'propose');
  const host: RangeSyncHost = {
    chart: () => chart,
    panelId: () => 'btc',
    timesSec: () => TIMES,
    tfSec: () => TF,
    renderedCount: () => TIMES.length,
    resizing: () => false,
    ...overrides,
  };
  return { rs: new ChartRangeSync(host, sync), sync, propose, timeScale };
}

/** Runs the next-frame read-back synchronously. */
function frames() {
  const queue: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (queue.push(cb), queue.length));
  return () => queue.splice(0).forEach((cb) => cb(0));
}

describe('ChartRangeSync (moved out of ChartComponent unchanged)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Follow applies another panel\'s range on this panel\'s logical axis, never its own', () => {
    frames();
    const { rs, timeScale } = setup();
    rs.follow({ from: 300, to: 900 }, 'btc');
    expect(timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
    rs.follow({ from: 300, to: 900 }, 'eth');
    expect(timeScale.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 1, to: 3 });
    rs.follow(null, 'eth');
    expect(timeScale.setVisibleLogicalRange).toHaveBeenCalledTimes(1);
  });

  it('an applied range does not echo back as a proposal — until the next-frame read-back, then only a real change does', () => {
    const flush = frames();
    const { rs, propose } = setup();
    rs.noteGesture();
    rs.follow({ from: 300, to: 900 }, 'eth');
    rs.drive(300, 900); // the library's echo of our own apply, same frame
    expect(propose).not.toHaveBeenCalled();
    flush();
    rs.drive(310, 910); // a bar-grid snap within half a bar
    expect(propose).not.toHaveBeenCalled();
    rs.drive(600, 1200); // a real user move
    expect(propose).toHaveBeenCalledWith('btc', { from: 600, to: 1200 }, TF / 2);
  });

  it('Drive never proposes while the container is resizing', () => {
    const { rs, propose } = setup({ resizing: () => true });
    rs.noteGesture();
    rs.drive(600, 1200);
    expect(propose).not.toHaveBeenCalled();
  });

  it('does nothing before the panel has data, and swallows a range the library rejects', () => {
    frames();
    const empty = setup({ renderedCount: () => 0 });
    empty.rs.follow({ from: 300, to: 900 }, 'eth');
    expect(empty.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();

    const rejecting = setup();
    rejecting.rs.noteGesture();
    rejecting.timeScale.setVisibleLogicalRange.mockImplementation(() => {
      throw new Error('out of range');
    });
    expect(() => rejecting.rs.follow({ from: 300, to: 900 }, 'eth')).not.toThrow();
    rejecting.rs.drive(600, 1200); // the guard was released: a real change still proposes
    expect(rejecting.propose).toHaveBeenCalled();
  });

  it('first data joins an existing shared range (§11.3 rule 2)', () => {
    frames();
    const { rs, sync, timeScale } = setup();
    sync.propose('eth', { from: 600, to: 1200 }, TF / 2);
    rs.joinOnFirstData(true);
    expect(timeScale.setVisibleLogicalRange).toHaveBeenLastCalledWith({ from: 2, to: 4 });
  });

  it('a prepend keeps the visible edge TIMES, not the logical indices', () => {
    const { rs, timeScale } = setup();
    timeScale.getVisibleLogicalRange.mockReturnValue({ from: 2, to: 4 }); // 600..1200
    const newTimes = [-600, -300, ...TIMES]; // two older bars prepended
    rs.withPreservedRangeOnPrepend(true, newTimes, () => undefined);
    expect(timeScale.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 4, to: 6 });
  });
});

describe('ChartRangeSync first-data seeding (BUG-007)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('first data before any gesture seeds its autofit window and never proposes it', () => {
    frames();
    const { rs, sync, propose, timeScale } = setup();
    rs.joinOnFirstData(true);
    expect(sync.range()).toEqual({ from: 0, to: 1200 });
    expect(sync.origin()).toBe('btc');
    rs.drive(0, 1200); // the autofit's own range-change echo
    expect(propose).not.toHaveBeenCalled();
    expect(timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
  });

  it('a staler seed loses to the standing one and joins it', () => {
    frames();
    const { rs, sync, propose, timeScale } = setup();
    sync.seed('eth', { from: 1200, to: 1500 }); // fresher than btc's autofit (to 1200)
    rs.joinOnFirstData(true);
    expect(sync.origin()).toBe('eth');
    expect(timeScale.setVisibleLogicalRange).toHaveBeenLastCalledWith({ from: 4, to: 5 });
    rs.drive(0, 1200); // the autofit echo, while the join is being applied
    expect(propose).not.toHaveBeenCalled();
  });

  it('before any gesture, a library-driven change refines the seed on its own panel and never proposes', () => {
    frames();
    const { rs, sync, propose } = setup();
    rs.joinOnFirstData(true);
    rs.drive(300, 1200); // the autofit re-fitting once the price axis has its width
    expect(propose).not.toHaveBeenCalled();
    expect(sync.range()).toEqual({ from: 300, to: 1200 });
    expect(sync.origin()).toBe('btc');
  });

  it('before any gesture, a library-driven change on another panel goes back to the shared range', () => {
    frames();
    const { rs, sync, propose, timeScale } = setup();
    sync.seed('eth', { from: 600, to: 1200 });
    rs.drive(0, 1200);
    expect(propose).not.toHaveBeenCalled();
    expect(sync.origin()).toBe('eth');
    expect(timeScale.setVisibleLogicalRange).toHaveBeenLastCalledWith({ from: 2, to: 4 });
  });

  it('a gesture on the panel, or a grid already user-driven, makes its changes propose again', () => {
    frames();
    const gestured = setup();
    gestured.sync.seed('eth', { from: 600, to: 1200 });
    gestured.rs.noteGesture();
    gestured.rs.drive(0, 900);
    expect(gestured.propose).toHaveBeenCalledWith('btc', { from: 0, to: 900 }, TF / 2);

    const driven = setup();
    driven.sync.propose('eth', { from: 600, to: 1200 }, TF / 2);
    driven.propose.mockClear();
    driven.rs.drive(0, 900);
    expect(driven.propose).toHaveBeenCalledWith('btc', { from: 0, to: 900 }, TF / 2);
  });

  it('an append or a still-empty series never seeds', () => {
    const { rs, sync } = setup();
    rs.joinOnFirstData(false);
    expect(sync.range()).toBeNull();
    const empty = setup({ renderedCount: () => 0 });
    empty.rs.joinOnFirstData(true);
    expect(empty.sync.range()).toBeNull();
  });
});
