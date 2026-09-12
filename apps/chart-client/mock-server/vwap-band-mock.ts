import type { Candle, IndicatorPoint, Signal } from '@trade-automation/contracts';

export const VWAP_BAND_STRATEGY_ID = 'vwap-band-reversal';

const SLOW_PERIOD_MS = 45 * 60_000; // ~45 minutes per full oscillation — "slow sine-ish"
const RESEARCH_SIGNAL_INTERVAL_MS = 30 * 60_000; // deterministic, one marker every 30 sim-minutes

/**
 * Stand-in for the real server's `VwapBandReversalStrategy` (§8.2 step 1 of
 * architecture/vwap-band-reversal-plugin.md — "a synthetic VWAP band (three
 * slow sine-ish lines around the fixture's closes) is a fine stand-in
 * signal source for the mock"). Not a port of the bot's mechanic — purely
 * so the client's indicator plumbing and research labelling have something
 * real to render against.
 */
export function computeVwapBandPoint(candle: Candle): IndicatorPoint {
  const wave = Math.sin(candle.openTime / SLOW_PERIOD_MS) * candle.close * 0.003;
  const vwap = candle.close + wave;
  const spread = Math.max(candle.close * 0.002, 0.01);
  return {
    strategyId: VWAP_BAND_STRATEGY_ID,
    instrument: candle.instrument,
    timeframe: candle.timeframe,
    tier: 'research',
    seriesId: 'vwap-band',
    time: candle.openTime,
    values: {
      vwap,
      vwapTop: vwap + spread,
      vwapBottom: vwap - spread,
    },
  };
}

export function computeHistoricalVwapBandPoints(history: readonly Candle[]): IndicatorPoint[] {
  return history.filter((c) => c.timeframe === '1m').map(computeVwapBandPoint);
}

/**
 * Deterministic (epoch-aligned) research-tier `info` signal, roughly every
 * §RESEARCH_SIGNAL_INTERVAL_MS — enough that a fresh boot already shows an
 * amber research marker without waiting on a live occurrence, mirroring
 * `example-cross`'s backfill (§4.4 of live-signal-server.md).
 */
export function detectVwapBandResearchSignal(candle: Candle): Signal | null {
  if (candle.timeframe !== '1m' || candle.openTime % RESEARCH_SIGNAL_INTERVAL_MS !== 0) {
    return null;
  }
  const short = Math.floor(candle.openTime / RESEARCH_SIGNAL_INTERVAL_MS) % 2 === 0;
  return {
    id: crypto.randomUUID(),
    strategyId: VWAP_BAND_STRATEGY_ID,
    instrument: candle.instrument,
    timeframe: candle.timeframe,
    time: candle.openTime,
    tier: 'research',
    kind: 'info',
    direction: short ? 'short' : 'long',
    overlay: [
      {
        type: 'marker',
        time: candle.openTime,
        position: short ? 'above' : 'below',
        shape: short ? 'arrowDown' : 'arrowUp',
        color: '#d29922',
        text: 'research',
      },
    ],
    meta: {
      caveat: 'mechanical trigger only; order-state rules (1/direction, daily caps, alive-window close) not applied',
    },
  };
}

export function computeHistoricalVwapBandSignals(history: readonly Candle[]): Signal[] {
  const signals: Signal[] = [];
  for (const candle of history) {
    const signal = detectVwapBandResearchSignal(candle);
    if (signal) {
      signals.push(signal);
    }
  }
  return signals;
}
