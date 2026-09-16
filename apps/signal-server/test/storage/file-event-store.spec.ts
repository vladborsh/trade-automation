import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CalendarNotification, EconomicEvent, EventRevision } from '@trade-automation/contracts';
import { FileEventStore } from '../../src/storage/file/file-event-store';

function event(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: 'ff:832:2026-09-14',
    source: 'forexfactory',
    seriesId: '832',
    sourceUrl: 'https://www.forexfactory.com/calendar/832-ez-ecb-president-lagarde-speaks',
    title: 'ECB President Lagarde Speaks',
    country: 'EUR',
    impact: 'medium',
    scheduledAt: Date.parse('2026-09-14T11:15:00-04:00'),
    scheduledDay: '2026-09-14',
    forecast: null,
    previous: null,
    actual: null,
    actualSource: null,
    actualAt: null,
    status: 'scheduled',
    firstSeenAt: 1000,
    lastSeenAt: 1000,
    revision: 1,
    ...overrides,
  };
}

describe('FileEventStore (architecture/economic-calendar.md §4.2–4.3)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-server-file-event-store-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('upsert is idempotent on id — upserting the same event twice does not duplicate the row', async () => {
    const store = new FileEventStore(root);
    await store.upsert([event()]);
    await store.upsert([event()]);

    const rows = await store.queryByScheduled(0, Date.now() + 1e12);
    expect(rows).toHaveLength(1);
  });

  it('re-upserting with changed fields replaces the row in place, keyed by id', async () => {
    const store = new FileEventStore(root);
    await store.upsert([event({ revision: 1 })]);
    await store.upsert([event({ revision: 2, impact: 'high' })]);

    const rows = await store.queryByScheduled(0, Date.now() + 1e12);
    expect(rows).toHaveLength(1);
    expect(rows[0].revision).toBe(2);
    expect(rows[0].impact).toBe('high');
  });

  it('partitions events by scheduledDay (ET), at the calendar/events/ Hive-style path', async () => {
    const store = new FileEventStore(root);
    await store.upsert([event()]);

    const expectedFile = path.join(root, 'calendar', 'events', 'date=2026-09-14.jsonl');
    expect(fs.existsSync(expectedFile)).toBe(true);
  });

  it('get(id) resolves an ff: id directly from its encoded day', async () => {
    const store = new FileEventStore(root);
    await store.upsert([event()]);

    const found = await store.get('ff:832:2026-09-14');
    expect(found?.id).toBe('ff:832:2026-09-14');
    expect(await store.get('ff:999:2026-09-14')).toBeNull();
  });

  it('get(id) falls back to scanning all day files for an ffx: id (no day encoded)', async () => {
    const store = new FileEventStore(root);
    const ffx = event({ id: 'ffx:deadbeef', seriesId: null, scheduledDay: '2026-09-15' });
    await store.upsert([ffx]);

    const found = await store.get('ffx:deadbeef');
    expect(found?.id).toBe('ffx:deadbeef');
  });

  it('appendRevisions is append-only and queryRevisions returns them ascending by revision', async () => {
    const store = new FileEventStore(root);
    const rows: EventRevision[] = [
      { eventId: 'ff:832:2026-09-14', revision: 2, at: 2000, change: 'updated', before: { impact: 'low' }, after: { impact: 'medium' } },
      { eventId: 'ff:832:2026-09-14', revision: 1, at: 1000, change: 'created', before: null, after: { title: 'x' } },
    ];
    await store.appendRevisions([rows[0]]);
    await store.appendRevisions([rows[1]]);

    const found = await store.queryRevisions('ff:832:2026-09-14');
    expect(found.map((r) => r.revision)).toEqual([1, 2]);
  });

  it('appendNotifications is append-only and queryNotifications filters by range', async () => {
    const store = new FileEventStore(root);
    const n1: CalendarNotification = { id: 'digest:2026-09-14', kind: 'daily-digest', at: 1000, events: [], title: 'Today: 0 events' };
    const n2: CalendarNotification = { id: 'due:2000', kind: 'event-due', at: 2000, events: [], title: 'x' };
    await store.appendNotifications([n1]);
    await store.appendNotifications([n2]);

    expect((await store.queryNotifications(0, 1500)).map((n) => n.id)).toEqual(['digest:2026-09-14']);
    expect((await store.queryNotifications(0, 5000)).map((n) => n.id)).toEqual(['digest:2026-09-14', 'due:2000']);
  });
});
