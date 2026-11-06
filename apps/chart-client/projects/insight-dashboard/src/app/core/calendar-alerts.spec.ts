import type { EconomicEvent } from '@trade-automation/contracts';
import {
  FIRED_KEY, OPT_IN_KEY, isAlertEvent, notificationFor, readFired, readOptIn, writeFired, writeOptIn,
  type AlertStore,
} from './calendar-alerts';

const AT = Date.UTC(2026, 9, 29, 12, 30);

function ev(over: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: 'ff:1:2026-10-29', source: 'forexfactory', seriesId: '1', sourceUrl: null, title: 'CPI m/m',
    country: 'USD', impact: 'high', scheduledAt: AT, scheduledDay: '2026-10-29', forecast: null,
    previous: null, actual: null, actualSource: null, actualAt: null, status: 'scheduled',
    firstSeenAt: 0, lastSeenAt: 0, revision: 1, ...over,
  };
}

function memoryStore(): AlertStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

const throwing: AlertStore = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
};

describe('calendar alerts storage (IB-061)', () => {
  it('remembers the opt-in, off by default', () => {
    const store = memoryStore();
    expect(readOptIn(store)).toBe(false);
    writeOptIn(store, true);
    expect(store.data[OPT_IN_KEY]).toBe('1');
    expect(readOptIn(store)).toBe(true);
  });

  it('round-trips the fired ledger and reads garbage as empty', () => {
    const store = memoryStore();
    writeFired(store, { [`alert:${AT}`]: AT });
    expect(readFired(store)).toEqual({ [`alert:${AT}`]: AT });
    store.data[FIRED_KEY] = 'not json';
    expect(readFired(store)).toEqual({});
    store.data[FIRED_KEY] = '[1,2]';
    expect(readFired(store)).toEqual({});
  });

  it('a store that throws (private window) reads as off / nothing shown, and writes are swallowed', () => {
    expect(readOptIn(throwing)).toBe(false);
    expect(readFired(throwing)).toEqual({});
    expect(() => writeOptIn(throwing, true)).not.toThrow();
    expect(() => writeFired(throwing, {})).not.toThrow();
    expect(readOptIn(null)).toBe(false);
  });
});

describe('isAlertEvent', () => {
  it('rings for high-impact USD only', () => {
    expect(isAlertEvent(ev())).toBe(true);
    expect(isAlertEvent(ev({ impact: 'medium' }))).toBe(false);
    expect(isAlertEvent(ev({ country: 'EUR' }))).toBe(false);
    expect(isAlertEvent(ev({ impact: 'holiday' }))).toBe(false);
  });
});

describe('notificationFor', () => {
  it('names the minutes left and the time in the viewer\'s zone, named, and lists the grouped titles (IB-152)', () => {
    const alert = { key: `alert:${AT}`, scheduledAt: AT, events: [ev(), ev({ id: 'b', title: 'Core CPI m/m' })] };
    const n = notificationFor(alert, AT - 14 * 60_000 - 20_000, (minutes, time) => `${minutes}|${time}`, 'UTC');
    expect(n).toEqual({ title: '14|12:30 UTC', body: 'CPI m/m\nCore CPI m/m' });
    const kyiv = notificationFor(alert, AT - 14 * 60_000 - 20_000, (minutes, time) => `${minutes}|${time}`, 'Europe/Kyiv');
    expect(kyiv.title).toBe('14|14:30 UTC+2'); // 29.10: Kyiv is back on +2 since the 25th
  });
});
