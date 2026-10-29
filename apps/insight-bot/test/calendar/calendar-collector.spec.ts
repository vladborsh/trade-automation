import { FeedFetchOutcome, FeedXmlRow } from '@trade-automation/calendar-core';
import { CalendarCollectorService } from '../../src/collectors/calendar/calendar-collector.service';
import { FetchRun } from '../../src/collectors/calendar/calendar.repository';
import { CalendarEventRow } from '../../src/collectors/writers/tables';

/**
 * The collector end to end with the real lifted mapper and diff, a canned feed, and a fake
 * writer: the properties IB-010 is about — every event and every revision, nothing written twice,
 * a withdrawn event marked cancelled — asserted on the rows that reach `calendar_events`.
 */
const WED = '2026-09-30T12:30:00-04:00'; // ForexFactory JSON carries an ET offset

/**
 * One fixed instant for the whole file.
 *
 * IB-051 made `poll(now)` REQUIRED rather than defaulted, which turned every call here into a
 * compile error — and that is the point: a default cannot fail, so these calls were silently
 * taking the real wall clock, exactly as `tick()` did before it passed its own instant down.
 */
const POLL_AT = Date.parse('2026-10-12T12:00:00Z');

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
  calls = 0;
  async fetch(): Promise<FeedFetchOutcome> {
    this.calls++;
    return this.outcomes.shift() ?? { changed: false };
  }
}

function snapshot(json: unknown[], xml: FeedXmlRow[]): FeedFetchOutcome {
  return { changed: true, json, xml, etag: { json: 'a', xml: 'b' }, fetchedAt: POLL_AT };
}

function build(storedRun: FetchRun | null = null) {
  const feed = new FakeFeed();
  const written: CalendarEventRow[] = [];
  const writers = { calendarEvents: { write: async (rows: CalendarEventRow[]) => void written.push(...rows) } };
  const config = {
    env: {
      get: (key: string) =>
        ({
          CALENDAR_ENABLED: true,
          CALENDAR_CHECK_INTERVAL_MS: 600_000,
          CALENDAR_CACHE_LOOKBACK_DAYS: 30,
        })[key],
    },
  };
  const runs: FetchRun[] = storedRun ? [storedRun] : [];
  const repo = {
    latestInWindow: async () => [],
    lastFetchRun: async () => runs[runs.length - 1] ?? null,
    recordFetchRun: async (run: FetchRun) => void runs.push(run),
  };
  const streams = { register: jest.fn(), recordMessage: jest.fn() };

  const service = new CalendarCollectorService(
    config as never,
    feed as never,
    repo as never,
    writers as never,
    streams as never,
  );
  return { service, feed, written, streams, runs };
}

describe('CalendarCollectorService', () => {
  it('writes one row per event on the first snapshot, at revision 1 and status scheduled', async () => {
    const { service, feed, written } = build();
    feed.outcomes.push(snapshot([jsonRow()], [xmlRow()]));

    await service.poll(POLL_AT);

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

  it('writes nothing when a snapshot repeats — and, at the SAME instant, proves the dedup is by CONTENT', async () => {
    /**
     * **The two polls share `POLL_AT` deliberately. Do not "tidy" the duplicate timestamp.**
     *
     * This became possible only once IB-051 made `poll(now)` required and the spec stopped using
     * the wall clock: before that, two polls could not share an instant, because each read
     * `Date.now()` a few milliseconds apart.
     *
     * What it now proves is stronger than what it was written for. Passing with two polls at one
     * instant means the "nothing changed" decision is made from the event's CONTENT, not from its
     * timestamp — if any part of the diff compared `fetched_at` or a revision clock, two polls
     * sharing an instant would behave differently and this test would have moved when the clock
     * was frozen. It did not.
     *
     * Give the two polls different instants and the test still passes, but it stops proving that.
     */
    const { service, feed, written } = build();
    feed.outcomes.push(snapshot([jsonRow()], [xmlRow()]), snapshot([jsonRow()], [xmlRow()]));

    await service.poll(POLL_AT);
    written.length = 0;
    await service.poll(POLL_AT); // same instant, on purpose — see above

    expect(written).toEqual([]);
  });

  it('writes a NEW revision, keeping the old one, when a field changes', async () => {
    const { service, feed, written } = build();
    feed.outcomes.push(
      snapshot([jsonRow()], [xmlRow()]),
      snapshot([jsonRow({ forecast: '170K' })], [xmlRow({ forecast: '170K' })]),
    );

    await service.poll(POLL_AT);
    await service.poll(POLL_AT);

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

    await service.poll(POLL_AT);
    written.length = 0;
    await service.poll(POLL_AT);

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

    await service.poll(POLL_AT);
    written.length = 0;
    await service.poll(POLL_AT);

    const backfilled = written.find((r) => r.id === 'ff:832:2026-09-02');
    expect(backfilled).toMatchObject({ actual: '151K', actualSource: 'next-previous', revision: 2 });
  });

  it('does not write, or lose its etag, when the feed answers 304', async () => {
    const { service, feed, written, streams } = build();
    feed.outcomes.push({ changed: false });

    await service.poll(POLL_AT);

    expect(written).toEqual([]);
    expect(streams.recordMessage).toHaveBeenCalled(); // a 304 is a healthy poll, not silence
  });

  it('swallows a feed error, counts it, and keeps the events it already holds', async () => {
    const { service, feed, written } = build();
    feed.outcomes.push(snapshot([jsonRow()], [xmlRow()]));
    await service.poll(POLL_AT);
    written.length = 0;

    feed.fetch = async () => {
      throw new Error('ForexFactory feed JSON request failed: 503');
    };
    await expect(service.poll(POLL_AT)).resolves.toBeUndefined();

    expect(written).toEqual([]);
    expect(service.healthStatus().eventsHeld).toBe(1);
  });

  describe('once per UTC day (IB-058)', () => {
    afterEach(() => jest.useRealTimers());

    it('records the day in calendar_fetch_runs with the snapshot size', async () => {
      const { service, feed, runs } = build();
      feed.outcomes.push(snapshot([jsonRow()], [xmlRow()]));

      await service.tick(POLL_AT);

      expect(runs).toEqual([{ day: '2026-10-12', fetchedAt: POLL_AT, events: 1 }]);
    });

    it('makes no second request on the same UTC day, and fetches again after 00:00 UTC', async () => {
      const { service, feed, runs } = build();
      feed.outcomes.push(snapshot([jsonRow()], [xmlRow()]));

      await service.tick(POLL_AT);
      await service.tick(POLL_AT + 10 * 60_000);
      await service.tick(Date.parse('2026-10-12T23:59:00Z'));
      expect(feed.calls).toBe(1);

      await service.tick(Date.parse('2026-10-13T00:00:00Z'));
      expect(feed.calls).toBe(2);
      // the unchanged (304) day is still a collected day, carrying the last snapshot's size
      expect(runs[1]).toEqual({ day: '2026-10-13', fetchedAt: Date.parse('2026-10-13T00:00:00Z'), events: 1 });
    });

    it('does not record a failed fetch, so the next check retries', async () => {
      const { service, feed, runs } = build();
      feed.fetch = async () => {
        feed.calls++;
        throw new Error('ForexFactory feed JSON request failed: 503');
      };

      await service.tick(POLL_AT);
      await service.tick(POLL_AT + 10 * 60_000);

      expect(runs).toEqual([]);
      expect(feed.calls).toBe(2);
    });

    it('after a restart on a collected day makes no request, and says so', async () => {
      jest.useFakeTimers({ now: POLL_AT, doNotFake: ['nextTick', 'setImmediate'] });
      const stored = { day: '2026-10-12', fetchedAt: POLL_AT - 3_600_000, events: 87 };
      const { service, feed, streams } = build(stored);
      const log = jest.spyOn((service as unknown as { logger: { log: (m: string) => void } }).logger, 'log');

      await service.onApplicationBootstrap();
      service.onModuleDestroy();

      expect(feed.calls).toBe(0);
      expect(log).toHaveBeenCalledWith('Calendar already collected for 2026-10-12 — skipping fetch');
      // the watchdog's clock starts from the stored run, not from boot, and the period is a day
      expect(streams.register).toHaveBeenCalledWith('calendar/forexfactory', 'forexfactory', 86_400);
      expect(streams.recordMessage).toHaveBeenCalledWith('calendar/forexfactory', stored.fetchedAt);
      expect(service.healthStatus().lastSuccessfulPollAge).toBe(3_600_000);
    });

    it('a restart on a new day fetches at boot', async () => {
      jest.useFakeTimers({ now: POLL_AT, doNotFake: ['nextTick', 'setImmediate'] });
      const { service, feed } = build({ day: '2026-10-11', fetchedAt: POLL_AT - 86_400_000, events: 87 });

      await service.onApplicationBootstrap();
      service.onModuleDestroy();

      expect(feed.calls).toBe(1);
    });
  });
});
