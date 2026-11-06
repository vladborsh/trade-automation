import { BinanceWeightTracker } from '../../../src/venues/binance/binance-weight.tracker';
import { SpendsWeightAs, currentWeightCaller, withWeightCaller } from '../../../src/venues/binance/weight-caller';
import { MetricsService } from '../../../src/ops/metrics.service';

/**
 * IB-147 — what the Binance weight is spent ON: every booked call carries the caller whose work it is, through the
 * whole async chain (a shared client like `candles.service` books for whoever called it), and `/metrics` shows the
 * cumulative weight per caller.
 */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('IB-147 weight per caller', () => {
  it('a call outside any caller is booked as unattributed; inside, to the caller — across awaits and timers', async () => {
    const w = new BinanceWeightTracker();
    w.recordCall(1, 0);
    await withWeightCaller('positioning', async () => {
      await tick();
      w.recordCall(10, 1);
      await new Promise<void>((r) => setTimeout(() => { w.recordCall(10, 2); r(); }, 1));
    });
    expect(Object.fromEntries(w.spentByCaller())).toEqual({ unattributed: 1, positioning: 20 });
  });

  it('two callers at once keep their own counts; the innermost caller wins; an explicit caller wins over the context', async () => {
    const w = new BinanceWeightTracker();
    await Promise.all([
      withWeightCaller('level_alerts', async () => { await tick(); w.recordCall(1, 0); await tick(); w.recordCall(1, 0); }),
      withWeightCaller('chart', async () => { await tick(); w.recordCall(10, 0); }),
      withWeightCaller('insights', () => withWeightCaller('positioning', async () => { await tick(); w.recordCall(5, 0); })),
      withWeightCaller('chart', async () => { w.recordCall(1, 0, 'exchange_info'); }),
    ]);
    expect(Object.fromEntries(w.spentByCaller())).toEqual({ level_alerts: 2, chart: 10, positioning: 5, exchange_info: 1 });
  });

  it('the counter only grows (it is since start); the trailing minute is unchanged by it', () => {
    const w = new BinanceWeightTracker();
    withWeightCaller('chart', () => w.recordCall(10, 0));
    expect(w.used1m(1)).toBe(10);
    expect(w.used1m(61_000)).toBe(0); // the minute passed
    expect(w.spentByCaller().get('chart')).toBe(10); // the total did not
  });

  it('@SpendsWeightAs books the method\'s whole chain to its caller, and returns what the method returns', async () => {
    const w = new BinanceWeightTracker();
    class Loop {
      @SpendsWeightAs('oi_alerts')
      async tick(n: number): Promise<number> {
        await tick();
        w.recordCall(n, 0);
        return currentWeightCaller() === 'oi_alerts' ? n * 2 : -1;
      }
    }
    expect(await new Loop().tick(3)).toBe(6);
    expect(currentWeightCaller()).toBe('unattributed'); // nothing leaks out of the call
    expect(Object.fromEntries(w.spentByCaller())).toEqual({ oi_alerts: 3 });
  });

  it('/metrics: ib_binance_weight_spent_by_caller{caller} from the tracker', async () => {
    const w = new BinanceWeightTracker();
    withWeightCaller('positioning', () => w.recordCall(300, 0));
    withWeightCaller('chart', () => w.recordCall(9, 0));
    const metrics = new MetricsService({ snapshot: () => [] } as never);
    metrics.setBinanceSpentSource(() => w.spentByCaller());
    const text = await metrics.registry.metrics();
    expect(text).toContain('ib_binance_weight_spent_by_caller{caller="positioning"} 300');
    expect(text).toContain('ib_binance_weight_spent_by_caller{caller="chart"} 9');
  });
});
