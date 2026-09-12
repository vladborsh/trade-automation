import type { OverlayPrimitive, Signal } from '../../../core/contracts/contracts';

const DIRECTION_SHAPE: Record<Signal['direction'], OverlayPrimitive & { type: 'marker' }> = {
  long: { type: 'marker', time: 0, position: 'below', shape: 'arrowUp', color: '#26a69a' },
  short: { type: 'marker', time: 0, position: 'above', shape: 'arrowDown', color: '#ef5350' },
  flat: { type: 'marker', time: 0, position: 'above', shape: 'circle', color: '#787b86' },
};

/**
 * Signal[] → OverlayPrimitive[] (§5.2): flattens each signal's own overlay
 * primitives, and synthesizes a default marker for a signal that declares
 * none — so every signal is visible even before a strategy bothers to
 * describe its own drawing.
 */
export function signalsToOverlays(signals: readonly Signal[]): OverlayPrimitive[] {
  const overlays: OverlayPrimitive[] = [];
  for (const signal of signals) {
    if (signal.overlay.length > 0) {
      overlays.push(...signal.overlay);
    } else {
      const template = DIRECTION_SHAPE[signal.direction];
      overlays.push({ ...template, time: signal.time, text: signal.strategyId });
    }
  }
  return overlays;
}
