import type { EconomicEvent, WebPushPayload, WebPushSubscription } from '@trade-automation/contracts';
import { CalendarNotifierService } from '../../src/delivery/calendar-notifier.service';
import type { CalendarNotifyStore } from '../../src/delivery/pg/calendar-notify.repo';
import type { PushTarget, WebPushStore } from '../../src/delivery/pg/web-push.repo';
import type { PushOutcome } from '../../src/delivery/web-push-sender';

/**
 * IB-069 — the notifier's push channel with in-memory stores and a fake push service: the same
 * events as Telegram, one push per (event, subscription), a restart repeats nothing, and a
 * subscription the push service calls gone (404/410) is deleted.
 */
const MIN = 60_000;
const DAY0 = Date.UTC(2026, 9, 29);
const CPI_AT = DAY0 + (12 * 60 + 30) * MIN;
const CPI: EconomicEvent = {
  id: 'ff:1:2026-10-29', source: 'forexfactory', seriesId: '1', sourceUrl: null, title: 'CPI m/m',
  country: 'USD', impact: 'high', scheduledAt: CPI_AT, scheduledDay: '2026-10-29', forecast: null,
  previous: null, actual: null, actualSource: null, actualAt: null, status: 'scheduled',
  firstSeenAt: DAY0, lastSeenAt: DAY0, revision: 1,
};

/** No Telegram recipients: the push channel must run on its own. */
class CalendarStore implements CalendarNotifyStore {
  constructor(public evts: EconomicEvent[]) {}
  async events() { return this.evts; }
  async collected() { return true; }
  async recipients() { return []; }
  async sentKeys() { return new Map<number, Set<string>>(); }
  async claim() { return true; }
}

class PushStore implements WebPushStore {
  journal = new Set<string>(); // `${subscriptionId}|${key}`
  dropped: number[] = [];
  constructor(public subs: PushTarget[]) {}
  async save() {}
  async remove() { return true; }
  async targets() { return this.subs.filter((s) => !this.dropped.includes(s.id)); }
  async drop(id: number) { this.dropped.push(id); }
  async sentKeys() {
    const out = new Map<number, Set<string>>();
    for (const k of this.journal) {
      const [id, key] = k.split('|');
      out.set(Number(id), (out.get(Number(id)) ?? new Set()).add(key));
    }
    return out;
  }
  async claim(id: number, key: string) {
    if (this.journal.has(`${id}|${key}`)) return false;
    this.journal.add(`${id}|${key}`);
    return true;
  }
}

const sub = (id: number, userId: number, lang: 'ru' | 'en' = 'ru'): PushTarget => ({
  id, userId, lang, subscription: { endpoint: `https://push.example/${id}`, keys: { p256dh: 'p', auth: 'a' } },
});

function build(calendar: CalendarStore, push: PushStore, opts: { enabled?: boolean; outcome?: (s: WebPushSubscription) => PushOutcome } = {}) {
  const pushed: Array<{ endpoint: string; payload: WebPushPayload }> = [];
  const sender = {
    enabled: opts.enabled ?? true,
    send: async (s: WebPushSubscription, payload: WebPushPayload) => {
      pushed.push({ endpoint: s.endpoint, payload });
      return opts.outcome?.(s) ?? 'sent';
    },
  };
  const telegram = { sendTo: jest.fn(async () => true) };
  const config = { env: { get: (k: string) => ({ CALENDAR_ENABLED: true, CALENDAR_DIGEST_TIME: '07:00', CALENDAR_REMIND_LEAD_MIN: 15 })[k] } };
  const service = new CalendarNotifierService(config as never, null, telegram as never, calendar, sender as never, push);
  return { service, pushed, telegram };
}

describe('CalendarNotifierService, the push channel (IB-069)', () => {
  it('pushes the reminder to every subscription, in its member\'s language, with the in-tab tag', async () => {
    const push = new PushStore([sub(1, 2, 'ru'), sub(2, 2, 'en'), sub(3, 5, 'en')]);
    const { service, pushed, telegram } = build(new CalendarStore([CPI]), push);

    const results = await service.tick(CPI_AT - 15 * MIN);

    expect(pushed.map((p) => p.endpoint)).toEqual(['https://push.example/1', 'https://push.example/2', 'https://push.example/3']);
    expect(pushed[0].payload).toEqual({ title: 'Через 15 мин, 12:30 UTC / 14:30 Киев — важное по USD', body: '• CPI m/m', tag: `alert:${CPI_AT}` });
    expect(pushed[1].payload.title).toBe('In 15 min, 12:30 UTC / 14:30 Kyiv — high-impact USD');
    expect(results).toContainEqual({ channel: 'push', subscriptionId: 3, key: `due:${CPI_AT}`, delivered: true });
    expect(telegram.sendTo).not.toHaveBeenCalled();
  });

  it('dedups per subscription: a browser that already had it is skipped, a new one still gets it', async () => {
    const push = new PushStore([sub(1, 2), sub(2, 2)]);
    push.journal.add(`1|due:${CPI_AT}`);
    const { service, pushed } = build(new CalendarStore([CPI]), push);
    await service.tick(CPI_AT - 14 * MIN);
    expect(pushed.map((p) => p.endpoint)).toEqual(['https://push.example/2']);
  });

  it('a new instance over the same journal (a restart) pushes nothing again', async () => {
    const push = new PushStore([sub(1, 2)]);
    const calendar = new CalendarStore([CPI]);
    expect((await build(calendar, push).service.tick(CPI_AT - 15 * MIN))).toHaveLength(1);
    const second = build(calendar, push);
    await second.service.tick(CPI_AT - 14 * MIN);
    expect(second.pushed).toEqual([]);
  });

  it('outside the reminder window, and for the morning digest, nothing is pushed', async () => {
    const push = new PushStore([sub(1, 2)]);
    const { service, pushed } = build(new CalendarStore([CPI]), push);
    await service.tick(DAY0 + 7 * 60 * MIN); // digest time
    await service.tick(CPI_AT - 30 * MIN); // too early
    await service.tick(CPI_AT - 9 * MIN); // too late (REMIND_LATE_MS is 5 min)
    expect(pushed).toEqual([]);
  });

  // the 404/410 → 'gone' mapping is WebPushSender's own, specced in web-push-sender.spec.ts
  it('a subscription the push service calls gone is deleted, and only that one', async () => {
    const push = new PushStore([sub(1, 2), sub(2, 3)]);
    const { service } = build(new CalendarStore([CPI]), push, {
      outcome: (s) => (s.endpoint.endsWith('/1') ? 'gone' : 'sent'),
    });
    const results = await service.tick(CPI_AT - 15 * MIN);
    expect(push.dropped).toEqual([1]);
    expect(results.filter((r) => r.channel === 'push').map((r) => r.delivered)).toEqual([false, true]);
  });

  it('a failed push (5xx, network) keeps the subscription and, claimed already, is not retried', async () => {
    const push = new PushStore([sub(1, 2)]);
    const calendar = new CalendarStore([CPI]);
    const { service, pushed } = build(calendar, push, { outcome: () => 'failed' });
    await service.tick(CPI_AT - 15 * MIN);
    await service.tick(CPI_AT - 14 * MIN);
    expect(push.dropped).toEqual([]);
    expect(pushed).toHaveLength(1);
  });

  it('with push off (no VAPID keys) it reads no subscriptions at all', async () => {
    const push = new PushStore([sub(1, 2)]);
    const spy = jest.spyOn(push, 'targets');
    const { service, pushed } = build(new CalendarStore([CPI]), push, { enabled: false });
    expect(await service.tick(CPI_AT - 15 * MIN)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(pushed).toEqual([]);
  });
});
