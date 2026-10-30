import type { EconomicEvent } from '@trade-automation/contracts';
import { FUTURE_HORIZON_DAYS, MAX_FUTURE_BARS, calendarWindow, futureSlots, futureTimes } from './future-bars';
import { snapTime } from './time-grid';

const DAY = 86_400;
const NOW = Date.UTC(2026, 9, 29, 12, 0) / 1000; // a Thursday
const event = (atSec: number, over: Partial<EconomicEvent> = {}): EconomicEvent =>
  ({ id: `e${atSec}`, country: 'USD', impact: 'high', status: 'scheduled', title: 'CPI', scheduledAt: atSec * 1000, ...over }) as EconomicEvent;

describe('futureTimes (IB-067)', () => {
  it('one bar per step after the last candle, up to the bar of the latest upcoming event', () => {
    const out = futureTimes(NOW, 900, [event(NOW + 3 * 3600 + 120)]); // 15m, event at 15:02
    expect(out[0]).toBe(NOW + 900);
    expect(out.at(-1)).toBe(NOW + 3 * 3600); // the 15:00 bar holds it
    expect(out.every((t, i) => i === 0 || t - out[i - 1] === 900)).toBe(true);
  });

  it('no upcoming marked event, no future bars: empty space would only squeeze the candles', () => {
    expect(futureTimes(NOW, 900, [])).toEqual([]);
    expect(futureTimes(NOW, 900, [event(NOW + 3600, { impact: 'medium' })])).toEqual([]);
    expect(futureTimes(NOW, 900, [event(NOW + 3600, { country: 'EUR' })])).toEqual([]);
    expect(futureTimes(NOW, 900, [event(NOW + 3600, { status: 'removed' })])).toEqual([]);
    expect(futureTimes(NOW, 900, [event(NOW - 3600)])).toEqual([]); // already past
    expect(futureTimes(NOW, 900, [event(NOW + 300)])).toEqual([]); // inside the current bar: on a real candle
  });

  it('only events within the horizon count: one 8 days out adds nothing', () => {
    expect(futureTimes(NOW, 3600, [event(NOW + (FUTURE_HORIZON_DAYS + 1) * DAY)])).toEqual([]);
    // the horizon runs from the last bar's close
    expect(futureTimes(NOW, 3600, [event(NOW + 3600 + FUTURE_HORIZON_DAYS * DAY - 1)]).length).toBe(168); // its bar opens at +7 d
    expect(futureTimes(NOW, 3600, [event(NOW + 2 * DAY), event(NOW + 8 * DAY)]).at(-1)).toBe(NOW + 2 * DAY);
  });

  it.each<[string, number, number]>([
    ['1m: 200 bars, 3 h 20 min', 60, 200],
    ['15m: 200 bars, 50 h', 900, 200],
    ['1h: the 7 days fit, 167 bars to an event at 11:59 a week on', 3600, 167],
    ['4h: 41 bars', 14_400, 41],
  ])('never more than 200 bars — %s', (_name, step, bars) => {
    const out = futureTimes(NOW, step, [event(NOW + 7 * DAY - 60)]);
    expect(out.length).toBe(Math.min(bars, MAX_FUTURE_BARS));
  });

  it('1w: future weeks open on Mondays, as the candles do (IB-065)', () => {
    const monday = snapTime(NOW, 7 * DAY);
    const out = futureTimes(monday, 7 * DAY, [event(monday + 7 * DAY + 2 * DAY)]);
    expect(out).toEqual([monday + 7 * DAY]);
    expect(new Date(out[0] * 1000).getUTCDay()).toBe(1);
  });
});

describe('futureSlots', () => {
  it('reads the last candle and the timeframe from the window', () => {
    const data = { timeframe: '1h', candles: { candles: [{ time: NOW - 3600 }, { time: NOW }] }, calendarEvents: [event(NOW + 3 * 3600)] };
    expect(futureSlots(data as never)).toEqual([NOW + 3600, NOW + 7200, NOW + 10_800]);
  });

  it('a window without candles has no future', () => {
    expect(futureSlots({ timeframe: '1h', candles: { candles: [] }, calendarEvents: [event(NOW + 3600)] } as never)).toEqual([]);
  });
});

describe('calendarWindow', () => {
  const H = FUTURE_HORIZON_DAYS * DAY * 1000;
  it('reads on into the week ahead', () => {
    expect(calendarWindow(1_000, 2_000)).toEqual({ fromMs: 1_000, toMs: 2_000 + H });
  });

  it('keeps within the server\'s 90 days by starting later, never by reading less ahead', () => {
    const to = 100 * DAY * 1000;
    const out = calendarWindow(to - 90 * DAY * 1000, to);
    expect(out.toMs).toBe(to + H);
    expect(out.toMs - out.fromMs).toBe(90 * DAY * 1000);
  });
});
