import { NotificationsStore, toastContent } from './notifications.store';
import type { CalendarNotification, EventImpact } from '../contracts/calendar';
import { testEvent } from './calendar-test-events';

function notification(overrides: Partial<CalendarNotification> = {}): CalendarNotification {
  return {
    id: 'due:1726500000000',
    kind: 'event-due',
    at: 1_726_500_000_000,
    events: [],
    title: 'USD · High · Federal Funds Rate',
    ...overrides,
  };
}

describe('NotificationsStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with zero unread and an empty toast queue', () => {
    const store = new NotificationsStore();
    expect(store.unreadCount()).toBe(0);
    expect(store.toastQueue()).toEqual([]);
    expect(store.notifications()).toEqual([]);
  });

  it('seeding on boot fills the center but does not mark anything unread', () => {
    const store = new NotificationsStore();
    store.seed([notification({ id: 'digest:2026-09-16', kind: 'daily-digest' })]);

    expect(store.notifications()).toHaveLength(1);
    expect(store.unreadCount()).toBe(0);
    expect(store.toastQueue()).toEqual([]);
  });

  it('receiving a live notification bumps unread and enqueues a toast', () => {
    const store = new NotificationsStore();
    store.receive(notification());

    expect(store.unreadCount()).toBe(1);
    expect(store.notifications()).toHaveLength(1);
    expect(store.toastQueue()).toHaveLength(1);
    expect(store.toastQueue()[0].notification.id).toBe('due:1726500000000');
  });

  it('event-due toasts are not sticky; daily-digest toasts are', () => {
    const store = new NotificationsStore();
    store.receive(notification({ id: 'due:1', kind: 'event-due' }));
    store.receive(notification({ id: 'digest:2026-09-16', kind: 'daily-digest' }));

    const [dueToast, digestToast] = store.toastQueue();
    expect(dueToast.sticky).toBe(false);
    expect(digestToast.sticky).toBe(true);
  });

  it('dismissing a toast removes only that toast', () => {
    const store = new NotificationsStore();
    store.receive(notification({ id: 'due:1' }));
    store.receive(notification({ id: 'due:2' }));
    const [first] = store.toastQueue();

    store.dismissToast(first.toastId);
    expect(store.toastQueue()).toHaveLength(1);
    expect(store.toastQueue()[0].notification.id).toBe('due:2');
  });

  it('markAllRead resets unread to zero without touching the center or toasts', () => {
    const store = new NotificationsStore();
    store.receive(notification());
    store.markAllRead();

    expect(store.unreadCount()).toBe(0);
    expect(store.notifications()).toHaveLength(1);
    expect(store.toastQueue()).toHaveLength(1);
  });

  it('dedupes a notification id already seen from the boot seed (ledger idempotency, §5.4)', () => {
    const store = new NotificationsStore();
    store.seed([notification({ id: 'due:1' })]);
    store.receive(notification({ id: 'due:1', title: 'duplicate delivery' }));

    expect(store.notifications()).toHaveLength(1);
    expect(store.unreadCount()).toBe(0);
    expect(store.toastQueue()).toEqual([]);
  });

  it('desktop notification opt-in persists to localStorage and restores on a fresh instance', () => {
    const store = new NotificationsStore();
    expect(store.desktopNotificationsEnabled()).toBe(false);

    store.setDesktopNotificationsEnabled(true);
    expect(store.desktopNotificationsEnabled()).toBe(true);

    const restored = new NotificationsStore();
    expect(restored.desktopNotificationsEnabled()).toBe(true);
  });
});

describe('toastContent — toasts respect the filters (§11.3)', () => {
  const filters = { impacts: ['medium', 'high', 'holiday'] as EventImpact[], countries: ['USD'], hideRemoved: false };

  it('an event-due toast shows only if one of its events passes, titled from the passing ones', () => {
    const due = notification({ events: [testEvent({ id: 'jpy', country: 'JPY' }), testEvent({ id: 'usd', title: 'Fed Funds Rate' })] });
    expect(toastContent(due, filters)).toMatchObject({ show: true, title: '🇺🇸 USD · High · Fed Funds Rate', hiddenCount: 1 });
    expect(toastContent(notification({ events: [testEvent({ country: 'JPY' })] }), filters).show).toBe(false);
  });

  it('a digest lists only passing events and counts the hidden ones', () => {
    const digest = notification({
      id: 'digest:2026-09-22',
      kind: 'daily-digest',
      title: 'Today: 3 events · 3 high (USD, JPY)',
      events: [testEvent({ id: 'b', scheduledAt: 2 }), testEvent({ id: 'jpy', country: 'JPY' }), testEvent({ id: 'a', scheduledAt: 1 })],
    });
    const content = toastContent(digest, filters);
    expect(content.show).toBe(true);
    expect(content.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(content.hiddenCount).toBe(1);
    expect(content.title).toBe('Today: 2 matching events');
  });

  it('an empty digest keeps the server title', () => {
    const empty = notification({ kind: 'daily-digest', title: 'Today: no scheduled events', events: [] });
    expect(toastContent(empty, filters)).toEqual({ show: true, title: 'Today: no scheduled events', events: [], hiddenCount: 0 });
  });

  it('receive() with filters skips the toast but still records the notification', () => {
    const store = new NotificationsStore();
    store.receive(notification({ events: [testEvent({ country: 'JPY' })] }), filters);
    expect(store.notifications()).toHaveLength(1);
    expect(store.unreadCount()).toBe(1);
    expect(store.toastQueue()).toEqual([]);
  });
});
