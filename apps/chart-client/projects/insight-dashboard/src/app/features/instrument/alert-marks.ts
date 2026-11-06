import type { WebAlertMark } from '@trade-automation/contracts';
import { formatUsd } from '../liquidations/liquidations.format';
import { snapTime } from './time-grid';

/**
 * IB-129 (alerts design §5) — the liquidation and funding alerts as markers on the price pane. Pure, with
 * its own spec (AGENTS.md); `panel-series.ts` hands the result to the library's series markers.
 *
 * - **Liquidations** (the coin's own threshold crossing): an arrow at the bar, the 5-minute sum as its text.
 *   Longs liquidated (forced sells) point up from below the bar in the down colour; shorts liquidated point
 *   down from above it in the up colour — the side is the fact, the arrow is where the price was pushed.
 *   They are arrows, not circles, so they never read as one of the liquidation bubbles.
 * - **Funding:** an amber square at the bar, the 8 h-normalised rate as its text: above the bar while longs
 *   pay (`high`), below while shorts pay. A `flip` sits on the side of the NEW sign and is marked «⇄».
 * - **No forecast:** the text is the alert's measured figure only.
 *
 * Each mark goes on the bar its moment falls in. A mark whose bar is not among the candles drawn (off the
 * window, or a gap) is left out: the library places a marker only on a bar of its series.
 */
export const ALERT_MARK_COLOURS = { liqLong: '#ef5350', liqShort: '#26a69a', funding: '#d29922' } as const;

export interface AlertMarker {
  time: number;
  position: 'aboveBar' | 'belowBar';
  shape: 'arrowUp' | 'arrowDown' | 'square';
  color: string;
  text: string;
}

/** `+0.080%` per 8 h: a funding rate is read in hundredths of a percent, so three decimals. */
export function ratePct(fraction: number): string {
  const pct = fraction * 100;
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toFixed(3)}%`;
}

export function toAlertMarkers(marks: readonly WebAlertMark[], candleTimes: readonly number[], barSec: number): AlertMarker[] {
  const bars = new Set(candleTimes);
  const out: AlertMarker[] = [];
  for (const m of marks) {
    const time = snapTime(m.at, barSec);
    if (!bars.has(time)) continue;
    if (m.type === 'liq') {
      out.push(m.side === 'long'
        ? { time, position: 'belowBar', shape: 'arrowUp', color: ALERT_MARK_COLOURS.liqLong, text: formatUsd(m.sumUsd) }
        : { time, position: 'aboveBar', shape: 'arrowDown', color: ALERT_MARK_COLOURS.liqShort, text: formatUsd(m.sumUsd) });
      continue;
    }
    const longsPay = m.event === 'enter' ? m.side === 'high' : m.side === 'low';
    out.push({
      time, position: longsPay ? 'aboveBar' : 'belowBar', shape: 'square', color: ALERT_MARK_COLOURS.funding,
      text: m.event === 'flip' ? `⇄ ${ratePct(m.ratePer8h)}` : ratePct(m.ratePer8h),
    });
  }
  return out.sort((a, b) => a.time - b.time);
}
