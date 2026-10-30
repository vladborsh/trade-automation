import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EconomicEvent, WebCalendarEventsResponse } from '@trade-automation/contracts';
import { vi } from 'vitest';
import { I18nService } from '../i18n/i18n.service';
import { OPT_IN_KEY } from './calendar-alerts';
import { CalendarAlertsService } from './calendar-alerts.service';
import { InsightApiClient } from './insight-api.client';
import { WebPushService } from './web-push.service';

/**
 * IB-061 — the service against a fake API and a fake `Notification`: it rings once inside the
 * lead window, never while off or refused, and the toggle asks the browser before switching on.
 */
const AT = Date.UTC(2026, 9, 29, 12, 30);
const CPI: EconomicEvent = {
  id: 'ff:1:2026-10-29', source: 'forexfactory', seriesId: '1', sourceUrl: null, title: 'CPI m/m',
  country: 'USD', impact: 'high', scheduledAt: AT, scheduledDay: '2026-10-29', forecast: null,
  previous: null, actual: null, actualSource: null, actualAt: null, status: 'scheduled',
  firstSeenAt: 0, lastSeenAt: 0, revision: 1,
};

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static answer: NotificationPermission = 'granted';
  static shown: Array<{ title: string; tag?: string; body?: string }> = [];
  static requestPermission = vi.fn(async () => FakeNotification.answer);
  constructor(title: string, options?: NotificationOptions) {
    FakeNotification.shown.push({ title, tag: options?.tag, body: options?.body });
  }
}

function setup(permission: NotificationPermission, optedIn: boolean, push?: object) {
  FakeNotification.permission = permission;
  FakeNotification.shown = [];
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal('Notification', FakeNotification);
  localStorage.clear();
  if (optedIn) localStorage.setItem(OPT_IN_KEY, '1');
  const upcoming = vi.fn(async (): Promise<WebCalendarEventsResponse> => ({ events: [CPI], lastFetchedAt: null }));
  TestBed.configureTestingModule({
    providers: [
      { provide: InsightApiClient, useValue: { calendarUpcoming: upcoming } },
      ...(push ? [{ provide: WebPushService, useValue: push }] : []),
    ],
  });
  TestBed.inject(I18nService).setLangFromUser('en');
  return { service: TestBed.inject(CalendarAlertsService), upcoming };
}

describe('CalendarAlertsService (IB-061)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('rings once, 15 minutes before, tagged with the instant\'s key', async () => {
    const { service } = setup('granted', true);
    expect(service.active()).toBe(true);

    expect(await service.check(AT - 15 * 60_000)).toEqual([`alert:${AT}`]);
    expect(await service.check(AT - 14 * 60_000)).toEqual([]);
    expect(FakeNotification.shown).toEqual([{ title: 'USD in 15 min, 12:30 UTC', tag: `alert:${AT}`, body: 'CPI m/m' }]);
  });

  it('a reload inside the window does not ring again — the ledger is in localStorage', async () => {
    const first = setup('granted', true);
    await first.service.check(AT - 15 * 60_000);
    TestBed.resetTestingModule();
    const ledger = localStorage.getItem('insight.calendarAlerts.fired');
    const second = setup('granted', true);
    localStorage.setItem('insight.calendarAlerts.fired', ledger ?? '{}');
    expect(await second.service.check(AT - 14 * 60_000)).toEqual([]);
  });

  it('is not due before the lead, and asks the API nothing while off', async () => {
    const { service, upcoming } = setup('granted', false);
    expect(await service.check(AT - 15 * 60_000)).toEqual([]);
    expect(upcoming).not.toHaveBeenCalled();
  });

  it('switching on asks the browser, and stays off when refused', async () => {
    const { service } = setup('default', false);
    FakeNotification.answer = 'denied';
    await service.toggle();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(service.active()).toBe(false);
    expect(service.permission()).toBe('denied');

    FakeNotification.answer = 'granted';
    service.permission.set('default');
    await service.toggle();
    expect(service.active()).toBe(true);
    expect(localStorage.getItem(OPT_IN_KEY)).toBe('1');

    await service.toggle();
    expect(service.active()).toBe(false);
    expect(localStorage.getItem(OPT_IN_KEY)).toBe('0');
  });

  describe('IB-069 — with browser push', () => {
    const fakePush = () => {
      const subscribed = signal(false);
      return {
        subscribed,
        enable: vi.fn(async () => { subscribed.set(true); return true; }),
        disable: vi.fn(async () => { subscribed.set(false); }),
        show: vi.fn(async () => undefined),
      };
    };

    it('switching on subscribes this browser to push; off unsubscribes it', async () => {
      const push = fakePush();
      const { service } = setup('granted', false, push);
      await service.toggle();
      expect(push.enable).toHaveBeenCalledTimes(1);
      expect(service.pushActive()).toBe(true);
      await service.toggle();
      expect(push.disable).toHaveBeenCalledTimes(1);
      expect(service.pushActive()).toBe(false);
    });

    it('a refused permission subscribes nothing', async () => {
      const push = fakePush();
      FakeNotification.answer = 'denied';
      const { service } = setup('default', false, push);
      await service.toggle();
      expect(push.enable).not.toHaveBeenCalled();
      FakeNotification.answer = 'granted';
    });

    it('the tab shows through the service worker, with the tag the push uses', async () => {
      const push = fakePush();
      const { service } = setup('granted', true, push);
      await service.check(AT - 15 * 60_000);
      expect(push.show).toHaveBeenCalledWith('USD in 15 min, 12:30 UTC', { tag: `alert:${AT}`, body: 'CPI m/m' });
      expect(FakeNotification.shown).toEqual([]);
    });

    it('on load, an opted-in browser re-sends its subscription (the bot may have dropped it)', () => {
      const push = fakePush();
      const { service } = setup('granted', true, push);
      service.start();
      service.stop();
      expect(push.enable).toHaveBeenCalledTimes(1);
    });
  });
});
