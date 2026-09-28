import * as fs from 'fs';
import * as path from 'path';
import { FeedClient, FeedFetchOutcome, parseXmlRows } from '@trade-automation/calendar-core';

/**
 * architecture/economic-calendar.md §3 — the ReplayAdapter analogue for the calendar: reads the
 * committed fixture snapshot instead of hitting the live feed, selected when
 * `MARKET_DATA_MODE=replay` (§8). Fixture layout: `<fixturesDir>/calendar/<any-date>/
 * ff_calendar_thisweek.{json,xml}` — the first date directory found is used, so the committed
 * `2026-09-16` fixture (§10 step 2) needs no hard-coded date here.
 */
export class FixtureFeedClient implements FeedClient {
  private served = false;

  constructor(private readonly fixturesDir: string) {}

  private calendarDir(): string {
    const root = path.join(this.fixturesDir, 'calendar');
    const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => fs.statSync(path.join(root, d)).isDirectory()) : [];
    if (dirs.length === 0) throw new Error(`FixtureFeedClient: no fixture directory under ${root}`);
    return path.join(root, dirs.sort()[0]);
  }

  async fetch(): Promise<FeedFetchOutcome> {
    if (this.served) return { changed: false };
    this.served = true;

    const dir = this.calendarDir();
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'ff_calendar_thisweek.json'), 'utf8'));
    const xml = parseXmlRows(fs.readFileSync(path.join(dir, 'ff_calendar_thisweek.xml')));

    return { changed: true, json, xml, etag: { json: 'fixture', xml: 'fixture' }, fetchedAt: Date.now() };
  }
}
