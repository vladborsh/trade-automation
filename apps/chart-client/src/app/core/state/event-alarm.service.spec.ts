import { TestBed } from '@angular/core/testing';
import { CHIME } from '../audio/chime';
import { CalendarFiltersStore } from './calendar-filters.store';
import { EventAlarmService, FIRED_KEY } from './event-alarm.service';
import { NotificationsStore } from './notifications.store';
import { FakeChime } from './fake-chime';
import { testEvent } from './calendar-test-events';

const AT = 1_790_000_000_000;

function setup(chime = new FakeChime()) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: CHIME, useValue: chime }] });
  return {
    alarm: TestBed.inject(EventAlarmService),
    settings: TestBed.inject(CalendarFiltersStore),
    notifications: TestBed.inject(NotificationsStore),
    chime,
  };
}

function week(events = [testEvent({ id: 'cpi', scheduledAt: AT })]) {
  return { from: AT - 3 * 86_400_000, to: AT + 4 * 86_400_000, day: [], events };
}

describe('EventAlarmService (§11.5)', () => {
  beforeEach(() => localStorage.clear());

  it('does nothing while the preference is off (the default)', () => {
    const { alarm, notifications } = setup();
    alarm.seedWeek(week());
    expect(alarm.check(AT - 60_000)).toEqual([]);
    expect(notifications.toastQueue()).toEqual([]);
  });

  it('turning it on arms audio and plays the confirmation chime', async () => {
    const { alarm, chime } = setup();
    alarm.setEnabled(true);
    await Promise.resolve();
    expect(chime.arms).toBe(1);
    expect(chime.plays).toBe(1);
    expect(alarm.armed()).toBe(true);
  });

  it('rings once at scheduledAt − lead: chime, toast with flag, ledger', async () => {
    const { alarm, settings, notifications, chime } = setup();
    await chime.arm();
    settings.setAlertEnabled(true);
    alarm.seedWeek(week());

    expect(alarm.check(AT - 5 * 60_000 - 1)).toEqual([]);
    expect(alarm.check(AT - 5 * 60_000)).toHaveLength(1);
    expect(chime.plays).toBe(1);
    const [toast] = notifications.toastQueue();
    expect(toast.alert).toBe(true);
    expect(toast.title).toBe('In 5 min: 🇺🇸 USD · High · CPI m/m');
    expect(notifications.notifications()).toEqual([]); // alerts are not server notifications

    expect(alarm.check(AT - 4 * 60_000)).toEqual([]);
    expect(Object.keys(JSON.parse(localStorage.getItem(FIRED_KEY)!))).toEqual([`alert:${AT}`]);
  });

  it('a reload never re-rings (the ledger is read back)', () => {
    const first = setup();
    first.settings.setAlertEnabled(true);
    first.alarm.seedWeek(week());
    vi.spyOn(Date, 'now').mockReturnValue(AT - 60_000);
    expect(first.alarm.check(AT - 60_000)).toHaveLength(1);

    const second = setup();
    second.alarm.seedWeek(week());
    expect(second.alarm.check(AT - 30_000)).toEqual([]);
    vi.restoreAllMocks();
  });

  it('still shows the toast when audio is not armed, and says it needs arming', () => {
    const { alarm, settings, notifications, chime } = setup();
    settings.setAlertEnabled(true);
    alarm.seedWeek(week());
    expect(alarm.needsArming()).toBe(true);
    alarm.check(AT - 60_000);
    expect(chime.plays).toBe(0);
    expect(notifications.toastQueue()).toHaveLength(1);
  });

  it('live frames merge into the upcoming set (a new event rings)', async () => {
    const { alarm, settings, chime } = setup();
    await chime.arm();
    settings.setAlertEnabled(true);
    alarm.seedWeek(week([]));
    alarm.mergeLive(testEvent({ id: 'late-add', scheduledAt: AT }));
    expect(alarm.check(AT - 60_000).map((a) => a.key)).toEqual([`alert:${AT}`]);
  });

  it('seedWeek keeps live events beyond the fetched week', () => {
    const { alarm } = setup();
    const w = week([]);
    alarm.mergeLive(testEvent({ id: 'next-week', scheduledAt: w.to + 1000 }));
    alarm.mergeLive(testEvent({ id: 'gone', scheduledAt: AT }));
    alarm.seedWeek(w);
    expect(alarm.upcoming().map((e) => e.id)).toEqual(['next-week']);
  });
});
