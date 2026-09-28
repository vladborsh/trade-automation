import { FeedFetchOutcome, FeedXmlRow } from '@trade-automation/calendar-core';
import { CalendarCollectorService } from '../../src/collectors/calendar/calendar-collector.service';
import { CalendarEventRow } from '../../src/collectors/writers/tables';

/**
 * The collector end to end with the real lifted mapper and diff, a canned feed, and a fake
 * writer: the properties IB-010 is about — every event and every revision, nothing written twice,
 * a withdrawn event marked cancelled — asserted on the rows that reach `calendar_events`.
 */
const WED = '2026-09-30T12:30:00-04:00'; // ForexFactory JSON carries an ET offset

function jsonRow(overrides: Record<string, string> = {}) {
  return {
    title: 'Non-Farm Employment Change',
    country: 'USD',
    date: WED,
    impact: 'High',
    forecast: '165K',
    previous: '142K',
    ...overrides,
  };
}

function xmlRow(overrides: Partial<FeedXmlRow> = {}): FeedXmlRow {
  return {
    title: 'Non-Farm Employment Change',
    country: 'USD',
    date: '09-30-2026',
    time: '4:30pm',
    impact: 'High',
    forecast: '165K',
    previous: '142K',
    url: 'https://www.forexfactory.com/calendar/832-usd-non-farm-employment-change',
    ...overrides,
  };
}

class FakeFeed {
  outcomes: FeedFetchOutcome[] = [];
  async fetch(): Promise<FeedFetchOutcome> {
    return this.outcomes.shift() ?? { changed: false };
  }
}

function snapshot(json: unknown[], xml: FeedXmlRow[]): FeedFetchOutcome {
  return { changed: true, json, xml, etag: { json: 'a', xml: 'b' }, fetchedAt: Date.now() };
}

function build() {
  const feed = new FakeFeed();
  const written: CalendarEventRow[] = [];
  const writers = { calendarEvents: { write: async (rows: CalendarEventRow[]) => void written.push(...rows) } };
  const config = {
    env: {
      get: (key: string) =>
        ({
          CALENDAR_ENABLED: true,
          CALENDAR_POLL_INTERVAL_MS: 600_000,
          CALENDAR_POLL_HOT_INTERVAL_MS: 120_000,
          CALENDAR_CACHE_LOOKBACK_DAYS: 30,
        })[key],
    },
  };
  const repo = { latestInWindow: async () => [] };
  const streams = { register: jest.fn(), recordMessage: jest.fn() };

  const service = new CalendarCollectorService(
    config as never,
    feed as never,
    repo as never,
    writers as never,
    streams as never,
  );
  return { service, feed, written, streams };
}

describe('CalendarCollectorService', () => {
  it('writes one row per event on the first snapshot, at revision 1 and status scheduled', async () => {
    const { service, feed, written } = build();
    feed.outcomes.push(snapshot([jsonRow()], [xmlRow()]));

    await service.poll();

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      revision: 1,
      status: 'scheduled',
      currency: 'USD',
      impact: 'high',
      seriesId: '832',
      forecast: '165K',
      previous: '142K',
    });
    expect(written[0].id).toBe('ff:832:2026-09-30');
  });

  it('writes nothing at all when the next snapshot repeats the same event unchanged', async () => {
    const { service, feed, written } = build();
    feed.outcomes.push(snapshot([jsonRow()], [xmlRow()]), snapshot([jsonRow()], [xmlRow()]));

    await service.poll();
    written.length = 0;
    await service.poll();

    expect(written).toEqual([]);
  });

  it('writes a NEW revision, keeping the old one, when a field changes', async () => {
    const { service, feed, written } = build();
    feed.outcomes.push(
      snapshot([jsonRow()], [xmlRow()]),
      snapshot([jsonRow({ forecast: '170K' })], [xmlRow({ forecast: '170K' })]),
    );

    await service.poll();
    await service.poll();

    expect(written.map((r) => [r.revision, r.forecast])).toEqual([
      [1, '165K'],
      [2, '170K'],
    ]);
    expect(new Set(written.map((r) => r.id)).size).toBe(1); // same id, two revisions
  });

  it('marks an event that vanished from the feed as cancelled, at a new revision', async () => {
    const { service, feed, written } = build();
    const other = { ...jsonRow({ title: 'ISM Services PMI' }) };
    feed.outcomes.push(
      snapshot([jsonRow(), other], [xmlRow(), xmlRow({ title: 'ISM Services PMI', url: 'https://www.forexfactory.com/calendar/901-usd-ism' })]),
      snapshot([jsonRow()], [xmlRow()]),
    );

    await service.poll();
    written.length = 0;
    await service.poll();

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ title: 'ISM Services PMI', status: 'cancelled', revision: 2 });
  });

  it('writes the prior occurrence’s backfilled actual as its own revision row', async () => {
    const { service, feed, written } = build();
    const september = { ...jsonRow({ date: '2026-09-02T12:30:00-04:00' }) };
    const septemberXml = xmlRow({ date: '09-02-2026' });
    feed.outcomes.push(
      snapshot([september], [septemberXml]),
      // the October occurrence of the same series arrives carrying September's released value
      snapshot([jsonRow({ previous: '151K' })], [xmlRow()]),
    );

    await service.poll();
    written.length = 0;
    await service.poll();

    const backfilled = written.find((r) => r.id === 'ff:832:2026-09-02');
    expect(backfilled).toMatchObject({ actual: '151K', actualSource: 'next-previous', revision: 2 });
  });

  it('does not write, or lose its etag, when the feed answers 304', async () => {
    const { service, feed, written, streams } = build();
    feed.outcomes.push({ changed: false });

    await service.poll();

    expect(written).toEqual([]);
    expect(streams.recordMessage).toHaveBeenCalled(); // a 304 is a healthy poll, not silence
  });

  it('swallows a feed error, counts it, and keeps the events it already holds', async () => {
    const { service, feed, written } = build();
    feed.outcomes.push(snapshot([jsonRow()], [xmlRow()]));
    await service.poll();
    written.length = 0;

    feed.fetch = async () => {
      throw new Error('ForexFactory feed JSON request failed: 503');
    };
    await expect(service.poll()).resolves.toBeUndefined();

    expect(written).toEqual([]);
    expect(service.healthStatus().eventsHeld).toBe(1);
  });
});
