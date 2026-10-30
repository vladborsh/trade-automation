import type { EconomicEvent } from '@trade-automation/contracts';
import { CalendarNotifierService } from '../../src/delivery/calendar-notifier.service';
import type { CalendarNotifyStore, CalendarRecipient } from '../../src/delivery/pg/calendar-notify.repo';

/**
 * IB-062 — the notifier end to end with an in-memory store and a fake sender: who gets what, in
 * which language, and that the journal (not process memory) is what stops a repeat.
 */
const MIN = 60_000;
const DAY0 = Date.UTC(2026, 9, 29);
const CPI_AT = DAY0 + (12 * 60 + 30) * MIN;

const CPI: EconomicEvent = {
  id: 'ff:1:2026-10-29', source: 'forexfactory', seriesId: '1', sourceUrl: null, title: 'CPI m/m',
  country: 'USD', impact: 'high', scheduledAt: CPI_AT, scheduledDay: '2026-10-29', forecast: '0.3%',
  previous: '0.2%', actual: null, actualSource: null, actualAt: null, status: 'scheduled',
  firstSeenAt: DAY0, lastSeenAt: DAY0, revision: 1,
};

class MemoryStore implements CalendarNotifyStore {
  journal = new Map<string, number>(); // `${userId}|${key}` → at
  constructor(public evts: EconomicEvent[], public recips: CalendarRecipient[], public collectedDays = new Set(['2026-10-29'])) {}
  async events() { return this.evts; }
  async collected(day: string) { return this.collectedDays.has(day); }
  async recipients() { return this.recips; }
  async sentKeys() {
    const out = new Map<number, Set<string>>();
    for (const k of this.journal.keys()) {
      const [id, key] = k.split('|');
      out.set(Number(id), (out.get(Number(id)) ?? new Set()).add(key));
    }
    return out;
  }
  async claim(userId: number, key: string, at: number) {
    const k = `${userId}|${key}`;
    if (this.journal.has(k)) return false;
    this.journal.set(k, at);
    return true;
  }
}

function build(store: MemoryStore, env: Record<string, unknown> = {}) {
  const sent: Array<{ chatId: number | string; text: string }> = [];
  const telegram = { sendTo: async (chatId: number | string, text: string) => { sent.push({ chatId, text }); return true; } };
  const config = {
    env: { get: (k: string) => ({ CALENDAR_ENABLED: true, CALENDAR_DIGEST_TIME: '07:00', CALENDAR_REMIND_LEAD_MIN: 15, ...env })[k] },
  };
  const service = new CalendarNotifierService(config as never, null, telegram as never, store);
  return { service, sent };
}

const RU: CalendarRecipient = { userId: 2, chatId: 222, lang: 'ru' };
const EN: CalendarRecipient = { userId: 3, chatId: 333, lang: 'en' };

describe('CalendarNotifierService (IB-062)', () => {
  it('sends the digest at 07:00 UTC to each member in their own language, once', async () => {
    const store = new MemoryStore([CPI], [RU, EN]);
    const { service, sent } = build(store);

    await service.tick(DAY0 + 7 * 60 * MIN);
    await service.tick(DAY0 + 7 * 60 * MIN + MIN);

    expect(sent.map((s) => s.chatId)).toEqual([222, 333]);
    expect(sent[0].text).toMatch(/^Календарь США на 29\.10/);
    expect(sent[1].text).toMatch(/^US calendar for 29\.10/);
  });

  it('reminds 15 minutes before, with the minutes actually left', async () => {
    const store = new MemoryStore([CPI], [EN]);
    store.journal.set('3|digest:2026-10-29', DAY0);
    const { service, sent } = build(store);

    const results = await service.tick(CPI_AT - 13 * MIN); // two minutes late
    expect(results).toEqual([{ channel: 'telegram', userId: 3, key: `due:${CPI_AT}`, delivered: true }]);
    expect(sent[0].text.split('\n')[0]).toBe('In 13 min, 12:30 UTC / 14:30 Kyiv — high-impact USD:');
  });

  it('a new instance over the same journal (a restart) does not repeat anything', async () => {
    const store = new MemoryStore([CPI], [RU]);
    await build(store).service.tick(CPI_AT - 15 * MIN);
    const second = build(store);
    await second.service.tick(CPI_AT - 14 * MIN);
    expect(second.sent).toEqual([]);
  });

  it('honours CALENDAR_REMIND_LEAD_MIN and CALENDAR_DIGEST_TIME', async () => {
    const store = new MemoryStore([CPI], [RU]);
    const { service, sent } = build(store, { CALENDAR_REMIND_LEAD_MIN: 30, CALENDAR_DIGEST_TIME: '06:15' });
    await service.tick(DAY0 + (6 * 60 + 15) * MIN);
    await service.tick(CPI_AT - 30 * MIN);
    expect(sent).toHaveLength(2);
    expect(sent[0].text).toContain('Напомню за 30 мин');
  });

  it('sends nothing when nobody wants it, and does not even read the events', async () => {
    const store = new MemoryStore([CPI], []);
    const spy = jest.spyOn(store, 'events');
    expect(await build(store).service.tick(CPI_AT - 15 * MIN)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a failing store is logged, not thrown', async () => {
    const store = new MemoryStore([CPI], [RU]);
    store.recipients = async () => { throw new Error('connection refused'); };
    await expect(build(store).service.tick(CPI_AT)).resolves.toEqual([]);
  });
});
