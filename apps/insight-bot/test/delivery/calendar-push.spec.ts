import { alertKey } from '@trade-automation/calendar-core';
import type { EconomicEvent } from '@trade-automation/contracts';
import { WebPushPayloadSchema } from '@trade-automation/contracts';
import { pushPayload, pushReminders } from '../../src/delivery/calendar-push';
import { selectDue } from '../../src/delivery/calendar-notify';

/** IB-069 — what the browser push carries, as pure functions. */
const MIN = 60_000;
const DAY0 = Date.UTC(2026, 9, 29);
const CPI_AT = DAY0 + (12 * 60 + 30) * MIN;
const event = (over: Partial<EconomicEvent>): EconomicEvent => ({
  id: 'ff:1:2026-10-29', source: 'forexfactory', seriesId: '1', sourceUrl: null, title: 'CPI m/m',
  country: 'USD', impact: 'high', scheduledAt: CPI_AT, scheduledDay: '2026-10-29', forecast: null,
  previous: null, actual: null, actualSource: null, actualAt: null, status: 'scheduled',
  firstSeenAt: DAY0, lastSeenAt: DAY0, revision: 1, ...over,
});
const input = (events: EconomicEvent[]) => ({ events, collectedToday: true, digestAtMin: 7 * 60, leadMs: 15 * MIN });

describe('pushReminders (IB-069)', () => {
  it('pushes the Telegram reminder and never the digest', () => {
    // 12:15 is both the reminder time and inside the digest's late window: Telegram gets two, push one
    const due = selectDue(CPI_AT - 15 * MIN, input([event({})]), new Set());
    expect(due.map((d) => d.kind)).toEqual(['digest', 'due']);
    expect(pushReminders(due).map((d) => d.key)).toEqual([`due:${CPI_AT}`]);
  });

  it('selects exactly what Telegram selects: high-impact USD only', () => {
    const events = [event({}), event({ id: 'e', country: 'EUR', title: 'ECB' }), event({ id: 'm', impact: 'medium', title: 'PMI' })];
    const [reminder] = pushReminders(selectDue(CPI_AT - 15 * MIN, input(events), new Set()));
    expect(reminder.events.map((e) => e.title)).toEqual(['CPI m/m']);
  });
});

describe('pushPayload (IB-069)', () => {
  const [reminder] = pushReminders(selectDue(CPI_AT - 13 * MIN, input([event({}), event({ id: 'b', title: 'Core CPI m/m' })]), new Set()));

  it('the title is the reminder line in the member\'s language, the body its events', () => {
    expect(pushPayload(reminder, CPI_AT - 13 * MIN, 'ru')).toEqual({
      title: 'Через 13 мин, 12:30 UTC / 14:30 Киев — важное по USD',
      body: '• Core CPI m/m\n• CPI m/m',
      tag: `alert:${CPI_AT}`,
    });
    expect(pushPayload(reminder, CPI_AT - 13 * MIN, 'en').title).toBe('In 13 min, 12:30 UTC / 14:30 Kyiv — high-impact USD');
  });

  it('the tag is the dashboard\'s in-tab key, so the two replace each other rather than ring twice', () => {
    const payload = pushPayload(reminder, CPI_AT - 13 * MIN, 'en');
    expect(payload.tag).toBe(alertKey(CPI_AT));
    expect(WebPushPayloadSchema.parse(payload)).toEqual(payload);
  });
});
