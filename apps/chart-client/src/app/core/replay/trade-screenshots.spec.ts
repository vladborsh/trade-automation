import { vi } from 'vitest';
import type { FillEvent, Order } from '@trade-automation/contracts';
import type { ScreenshotJob } from './screenshot-upload.queue';
import { TradeScreenshots } from './trade-screenshots';

const exit = (orderId: string): FillEvent => ({ orderId, kind: 'exit', time: 0, price: 1, reason: 'stop', resolution: '1m' }) as FillEvent;
const fill = (orderId: string): FillEvent => ({ orderId, kind: 'fill', time: 0, price: 1, resolution: '1m' }) as FillEvent;

function setup(opts: { panels?: string[]; session?: string | null } = {}) {
  const jobs: ScreenshotJob[] = [];
  const taken: string[] = [];
  const panels = opts.panels ?? ['btc', 'eth'];
  const shots = new TradeScreenshots({
    sessionId: () => (opts.session === undefined ? 's1' : opts.session),
    captureOf: (panelId) => (panels.includes(panelId) ? () => ({ panelId }) as unknown as HTMLCanvasElement : null),
    enqueue: (j) => jobs.push(j),
    capture: (take) => {
      const panelId = (take() as unknown as { panelId: string }).panelId;
      taken.push(panelId);
      return Promise.resolve(new Blob([panelId]));
    },
  });
  return { shots, jobs, taken };
}

describe('TradeScreenshots (§9.2, decisions 6 and 27)', () => {
  it('entry: taken at once from the order panel, uploaded only once the order id exists', () => {
    const { shots, jobs, taken } = setup();
    const png = shots.captureEntry('eth');
    expect(taken).toEqual(['eth']); // synchronous: before the place request is pushed
    expect(jobs).toEqual([]);
    shots.entryPlaced('o1', png);
    expect(jobs).toEqual([{ sessionId: 's1', orderId: 'o1', kind: 'entry', png }]);
  });

  it('entry without a chart (collapsed panel): nothing taken, nothing uploaded', () => {
    const { shots, jobs } = setup({ panels: [] });
    const png = shots.captureEntry('btc');
    expect(png).toBeNull();
    shots.entryPlaced('o1', png);
    expect(jobs).toEqual([]);
  });

  it('a coalesced response with two exits gives two exit pictures — a stop-out while stepping fast is never missed', () => {
    const { shots, jobs, taken } = setup();
    const panelOf = (id: string) => ({ o1: 'btc', o2: 'eth' })[id];
    shots.exits([fill('o3'), exit('o1'), exit('o2')], panelOf);
    expect(jobs.map((j) => [j.orderId, j.kind])).toEqual([
      ['o1', 'exit'],
      ['o2', 'exit'],
    ]);
    expect(taken).toEqual(['btc', 'eth']); // each from its own panel; fills are not pictures
  });

  it('an exit whose panel is unknown or has no chart is skipped, the others still taken', () => {
    const { shots, jobs } = setup({ panels: ['btc'] });
    shots.exits([exit('o1'), exit('o2'), exit('o3')], (id) => ({ o1: 'btc', o2: 'eth' })[id]);
    expect(jobs.map((j) => j.orderId)).toEqual(['o1']);
  });

  it('a manual close is an exit picture; a close answer that is not closed is not', () => {
    const { shots, jobs } = setup();
    shots.closed({ id: 'o1', panelId: 'btc', status: 'closed' } as Order);
    shots.closed({ id: 'o2', panelId: 'btc', status: 'open' } as Order);
    expect(jobs.map((j) => [j.orderId, j.kind])).toEqual([['o1', 'exit']]);
  });

  it('nothing is uploaded without a session', () => {
    const { shots, jobs } = setup({ session: null });
    shots.exits([exit('o1')], () => 'btc');
    expect(jobs).toEqual([]);
  });
});
