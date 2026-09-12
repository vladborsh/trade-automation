import type { Candle, Signal } from '@trade-automation/contracts';

const SMA_PERIOD = 20;

function sma(values: number[]): number | null {
  if (values.length < SMA_PERIOD) {
    return null;
  }
  const window = values.slice(values.length - SMA_PERIOD);
  return window.reduce((sum, v) => sum + v, 0) / SMA_PERIOD;
}

/**
 * Stand-in for SE-1's `example-cross` demo plug-in (§4.4): "1m close
 * crosses the 20-bar SMA → `info` signal with a marker". Never described as
 * a strategy of this project — its only job is to prove the overlay slot
 * (`Signal.overlay` → `OverlayLayer`) renders end to end.
 */
/** Replays `detectExampleCrossSignal` over a full history to backfill signals for already-seeded candles. */
export function computeHistoricalSignals(history: readonly Candle[]): Signal[] {
  const signals: Signal[] = [];
  for (let i = SMA_PERIOD + 1; i <= history.length; i++) {
    const signal = detectExampleCrossSignal(history.slice(0, i));
    if (signal) {
      signals.push(signal);
    }
  }
  return signals;
}

export function detectExampleCrossSignal(closes: readonly Candle[]): Signal | null {
  if (closes.length < SMA_PERIOD + 1) {
    return null;
  }
  const values = closes.map((c) => c.close);
  const currentSma = sma(values);
  const previousSma = sma(values.slice(0, -1));
  if (currentSma === null || previousSma === null) {
    return null;
  }

  const current = closes[closes.length - 1];
  const previous = closes[closes.length - 2];

  const crossedUp = previous.close <= previousSma && current.close > currentSma;
  const crossedDown = previous.close >= previousSma && current.close < currentSma;
  if (!crossedUp && !crossedDown) {
    return null;
  }

  const direction = crossedUp ? 'long' : 'short';
  return {
    id: crypto.randomUUID(),
    strategyId: 'example-cross',
    instrument: current.instrument,
    timeframe: current.timeframe,
    time: current.openTime,
    tier: 'demo',
    kind: 'info',
    direction,
    confidence: undefined,
    overlay: [
      {
        type: 'marker',
        time: current.openTime,
        position: crossedUp ? 'below' : 'above',
        shape: crossedUp ? 'arrowUp' : 'arrowDown',
        color: crossedUp ? '#26a69a' : '#ef5350',
        text: `SMA${SMA_PERIOD} cross`,
      },
    ],
    meta: { sma: currentSma },
  };
}
