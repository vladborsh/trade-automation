import { v4 as uuid } from 'uuid';
import { InstrumentId, Signal } from '@trade-automation/contracts';
import { SignalStrategy, StrategyContext } from '../../signal-strategy.port';

/**
 * architecture/live-signal-server.md §4.4 — "The scaffold ships one demo plug-in so the
 * pipeline can be exercised end to end... It is disabled by default, labelled `example-` in
 * its id, and must never be described anywhere as a strategy of this project. Its only job is
 * to prove the slot works."
 *
 * DEMO ONLY. Not a trading strategy of this project — see IDEAS-BACKLOG.md / RESEARCH-LOG.md
 * for the actual candidate strategies (currently both mid-pre-registration, neither shipped).
 */
export class ExampleCrossStrategy implements SignalStrategy {
  readonly id = 'example-cross';

  constructor(private readonly smaPeriod: number = 20) {}

  get requirements() {
    return {
      instruments: [] as InstrumentId[], // populated per-instrument by strategy-registry from config
      timeframe: '1m' as const,
      warmupBars: { '1m': this.smaPeriod + 1 },
    };
  }

  onCandle(ctx: StrategyContext): Signal[] {
    const bars = ctx.window('1m');
    if (bars.length < this.smaPeriod + 1) return [];

    const closes = bars.slice(-this.smaPeriod - 1).map((b) => b.close);
    const prevSma = average(closes.slice(0, this.smaPeriod));
    const currSma = average(closes.slice(1));
    const prevClose = closes[closes.length - 2];
    const currClose = closes[closes.length - 1];

    const crossedUp = prevClose <= prevSma && currClose > currSma;
    const crossedDown = prevClose >= prevSma && currClose < currSma;
    if (!crossedUp && !crossedDown) return [];

    const last = bars[bars.length - 1];
    return [
      {
        id: uuid(),
        strategyId: this.id,
        instrument: ctx.instrument.id,
        timeframe: '1m',
        time: last.openTime,
        kind: 'info',
        direction: 'flat',
        overlay: [
          {
            type: 'marker',
            time: last.openTime,
            position: crossedUp ? 'below' : 'above',
            shape: crossedUp ? 'arrowUp' : 'arrowDown',
            text: crossedUp ? 'cross up' : 'cross down',
          },
        ],
        meta: { crossedUp, smaPeriod: this.smaPeriod, sma: currSma },
      },
    ];
  }
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
