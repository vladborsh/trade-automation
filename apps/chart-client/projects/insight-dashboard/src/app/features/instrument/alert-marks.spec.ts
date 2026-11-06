import { describe, expect, it } from 'vitest';
import type { WebAlertMark } from '@trade-automation/contracts';
import { ALERT_MARK_COLOURS, ratePct, toAlertMarkers } from './alert-marks';

/** IB-129 — the liquidation and funding alerts as price-pane markers. */
const H = 3_600;
const T = 1_793_900_000 - (1_793_900_000 % H); // a 1h bar open
const bars = [T - H, T, T + H];
const venues = { binance: 1, bybit: 1, okx: 1 };
const liq = (side: 'long' | 'short', at = T + 120): WebAlertMark => ({ type: 'liq', at, side, sumUsd: 7.4e6, thresholdUsd: 5e6, byVenue: venues });
const funding = (event: 'enter' | 'flip', side: 'high' | 'low', ratePer8h: number, at = T): WebAlertMark =>
  ({ type: 'funding', event, at, side, ratePer8h, episodeHours: event === 'flip' ? 30 : null });

describe('alert markers (IB-129)', () => {
  it('a liquidation crossing sits on the bar its moment falls in, with its 5-minute sum', () => {
    expect(toAlertMarkers([liq('long')], bars, H)).toEqual([
      { time: T, position: 'belowBar', shape: 'arrowUp', color: ALERT_MARK_COLOURS.liqLong, text: '$7.4M' },
    ]);
  });

  it('shorts liquidated: from above, pointing down, in the up colour', () => {
    expect(toAlertMarkers([liq('short')], bars, H)[0]).toMatchObject({ position: 'aboveBar', shape: 'arrowDown', color: ALERT_MARK_COLOURS.liqShort });
  });

  it('funding: above the bar while longs pay, below while shorts pay; the 8 h rate as text', () => {
    const [hi, lo] = toAlertMarkers([funding('enter', 'high', 0.0008), funding('enter', 'low', -0.0005, T + H)], bars, H);
    expect(hi).toMatchObject({ time: T, position: 'aboveBar', shape: 'square', text: '+0.080%' });
    expect(lo).toMatchObject({ time: T + H, position: 'belowBar', text: '−0.050%' });
  });

  it('a flip sits on the side of the NEW sign and says so', () => {
    // a high (longs-pay) episode flipped: shorts pay now → below the bar
    expect(toAlertMarkers([funding('flip', 'high', -0.0001)], bars, H)[0]).toMatchObject({ position: 'belowBar', text: '⇄ −0.010%' });
    expect(toAlertMarkers([funding('flip', 'low', 0.0001)], bars, H)[0]).toMatchObject({ position: 'aboveBar', text: '⇄ +0.010%' });
  });

  it('a mark whose bar is not drawn (before the window, in a gap) is left out; the rest come sorted', () => {
    const out = toAlertMarkers([funding('enter', 'high', 0.0008, T + H + 10), liq('long', T - 5 * H), liq('short', T - H)], bars, H);
    expect(out.map((m) => m.time)).toEqual([T - H, T + H]);
  });

  it('ratePct: three decimals of a percent, a true minus sign, no sign on zero', () => {
    expect([ratePct(0.00012), ratePct(-0.00012), ratePct(0)]).toEqual(['+0.012%', '−0.012%', '0.000%']);
  });
});
