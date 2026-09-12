import { v4 as uuid } from 'uuid';
import { Candle, InstrumentId, Signal, StrategyRequirements } from '@trade-automation/contracts';
import { SignalStrategy, StrategyContext, StrategyOutput } from '../../signal-strategy.port';
import { Evaluation, evaluate } from './vwap-band-reversal.evaluate';
import { VwapBandReversalParams, VwapBandReversalParamsSchema } from './vwap-band-reversal.params';
import { sliceWindows } from './vwap-band-reversal.windows';
import { isWithinEntryWindow } from './session';

const RESEARCH_AMBER = '#d29922';

/**
 * architecture/vwap-band-reversal-plugin.md §2 — a faithful, research-tier port of
 * cmc-bot-main's `VWapStrategy` mechanical trigger (knowledge/vwap-band-reversal-ict.md).
 * UNVALIDATED: Stage 1 of `research/cmc-bot-vwap/ARCHITECT-NOTE.md` has not run. This class
 * only assembles the window slices and the Signal/indicator wire shapes; all the actual
 * mechanic (VWAP band, iFVG, range, ATR, prior-hour sweep, stop/target) lives in the pure
 * `evaluate()` function so it can be parity-tested against the Researcher's TS<->Python
 * reproduction independent of the runner/cache plumbing.
 */
export class VwapBandReversalStrategy implements SignalStrategy {
  readonly id = 'vwap-band-reversal';
  readonly tier = 'research' as const;
  readonly displayName = 'VWAP band reversal (cmc-bot port)';
  readonly description =
    'Unvalidated. Port of the cmc-bot VWAP band-reversal mechanic; markers show where it fires, not trades.';

  constructor(private readonly params: VwapBandReversalParams) {}

  get requirements(): StrategyRequirements {
    return {
      instruments: [], // filled from strategies.yaml by the registry, as example-cross
      timeframe: '1m',
      warmupBars: { '1m': 1440 }, // CACHE DEPTH: a full UTC day (bias window) > the 12h main window
      minBars: { '1m': 1 }, // READINESS: evaluate as soon as one closed bar exists (§4)
      indicators: [
        {
          id: 'vwap-band',
          label: 'VWAP band (research, unvalidated)',
          scale: 'price',
          keys: [
            { key: 'vwap', label: 'VWAP', color: RESEARCH_AMBER },
            { key: 'vwapTop', label: 'VWAP +1σ', color: RESEARCH_AMBER, style: 'dashed' },
            { key: 'vwapBottom', label: 'VWAP -1σ', color: RESEARCH_AMBER, style: 'dashed' },
          ],
        },
      ],
    };
  }

  onCandle(ctx: StrategyContext): StrategyOutput {
    const now = ctx.now;
    const bars = ctx.window('1m');
    const { mainWindow, biasWindow } = sliceWindows(bars, now, this.params.mainWindowMinutes);

    const out = evaluate(mainWindow, biasWindow, now, {
      minVwapAtrRatio: this.params.minVwapAtrRatio,
      maxVwapAtrRatio: this.params.maxVwapAtrRatio,
      maxIfvgToAtrRatio: this.params.maxIfvgToAtrRatio,
      targetRr: this.params.targetRr,
      rangeBars: this.params.rangeBars,
      atrBars: this.params.atrBars,
    });

    const indicators: StrategyOutput['indicators'] =
      out.nBias > 0 && out.vwap !== undefined && out.vwapTop !== undefined && out.vwapBottom !== undefined
        ? [
            {
              seriesId: 'vwap-band',
              time: now,
              values: { vwap: out.vwap, vwapTop: out.vwapTop, vwapBottom: out.vwapBottom },
            },
          ]
        : [];

    const signal = this.buildSignal(ctx, mainWindow, out);
    return { signals: signal ? [signal] : [], indicators };
  }

  private buildSignal(ctx: StrategyContext, mainWindow: readonly Candle[], out: Evaluation): Signal | null {
    if (!out.sell && !out.buy) return null;
    // §2.4: "A Signal is emitted only if stop and target are finite and truthy" — the bot's
    // putOrder gate. n < 201 leaves stop/target undefined even though sell/buy read true.
    if (out.stop === undefined || out.target === undefined) return null;
    if (!Number.isFinite(out.stop) || !Number.isFinite(out.target)) return null;
    if (!out.stop || !out.target) return null;

    const entryWindow = this.params.entryWindow[ctx.instrument.id as InstrumentId];
    if (!entryWindow) return null; // boot-time validation already covers a missing window; defensive here too
    const zoned = ctx.clock.toZoned(ctx.now, this.params.sessionTimezone);
    if (!isWithinEntryWindow(ctx.now, zoned, entryWindow)) return null;

    const direction = out.sell ? 'short' : 'long';
    const level = out.sell ? out.prevHigh! : out.prevLow!;

    const overlay: Signal['overlay'] = [
      {
        type: 'marker',
        time: ctx.now,
        position: out.sell ? 'above' : 'below',
        shape: out.sell ? 'arrowDown' : 'arrowUp',
        color: RESEARCH_AMBER,
        text: 'research',
      },
    ];

    if (out.ifvgX !== undefined && out.ifvgLow !== undefined && out.ifvgHigh !== undefined) {
      const ifvgBar = mainWindow[out.ifvgX];
      if (ifvgBar) {
        overlay.push({
          type: 'rect',
          from: ifvgBar.openTime,
          to: ctx.now,
          top: out.ifvgHigh,
          bottom: out.ifvgLow,
          color: 'rgba(210, 153, 34, 0.25)',
          label: 'iFVG',
        });
      }
    }

    if (out.prevWindowStart !== undefined) {
      overlay.push({
        type: 'line',
        points: [
          { time: out.prevWindowStart, price: level },
          { time: ctx.now, price: level },
        ],
        style: 'dashed',
        label: out.sell ? 'prev-hour high' : 'prev-hour low',
      });
    }

    overlay.push(
      {
        type: 'line',
        points: [
          { time: ctx.now, price: out.stop },
          { time: ctx.now + 60 * 60_000, price: out.stop },
        ],
        color: '#f85149',
        style: 'dashed',
        label: 'stop',
      },
      {
        type: 'line',
        points: [
          { time: ctx.now, price: out.target },
          { time: ctx.now + 60 * 60_000, price: out.target },
        ],
        color: '#3fb950',
        style: 'dashed',
        label: 'target',
      },
    );

    const entryWindowLabel = `${this.params.entryWindow[ctx.instrument.id as InstrumentId]?.join('-')} ${this.params.sessionTimezone}`;

    return {
      id: uuid(),
      strategyId: this.id,
      instrument: ctx.instrument.id,
      timeframe: '1m',
      time: ctx.now,
      tier: this.tier,
      kind: 'info', // NEVER 'entry' at research tier — the runner rejects it
      direction,
      levels: { entry: out.entry, stop: out.stop, target: out.target },
      overlay,
      meta: {
        n: out.n,
        nBias: out.nBias,
        vwap: out.vwap ?? 0,
        vwapTop: out.vwapTop ?? 0,
        vwapBottom: out.vwapBottom ?? 0,
        vwapAtrRatio: out.vwapAtrRatio ?? 0,
        atr: out.atr ?? 0,
        rangeTop: out.rangeTop ?? 0,
        rangeBottom: out.rangeBottom ?? 0,
        inDiscount: out.inDiscount,
        ifvgLow: out.ifvgLow ?? 0,
        ifvgHigh: out.ifvgHigh ?? 0,
        ifvgAtrRatio: out.ifvgAtrRatio ?? 0,
        prevHigh: out.prevHigh ?? 0,
        prevLow: out.prevLow ?? 0,
        hi6: out.hi6 ?? 0,
        lo6: out.lo6 ?? 0,
        stopSize: out.stopSize ?? 0,
        stopShrink: out.stopShrink ?? 1,
        entryWindow: entryWindowLabel,
        windowSemantics: 'backtest[T-12h,T]',
        caveat:
          'mechanical trigger only; order-state rules (1/direction, daily caps, alive-window close) not applied',
      },
    };
  }
}

/** architecture/vwap-band-reversal-plugin.md §7 — params zod-validated at boot from strategies.yaml. */
export function createVwapBandReversalStrategy(rawParams: Record<string, unknown>): VwapBandReversalStrategy {
  const params = VwapBandReversalParamsSchema.parse(rawParams);
  return new VwapBandReversalStrategy(params);
}
