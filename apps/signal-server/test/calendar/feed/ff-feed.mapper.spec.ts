import * as fs from 'fs';
import * as path from 'path';
import { mapFeedSnapshot, xmlInstantUtc } from '../../../src/calendar/feed/ff-feed.mapper';
import { parseXmlRows } from '../../../src/calendar/feed/ff-feed.client';

const FIXTURE_DIR = path.join(__dirname, '..', '..', 'fixtures', 'calendar', '2026-09-16');

function loadFixture() {
  const json = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'ff_calendar_thisweek.json'), 'utf8'));
  const xml = parseXmlRows(fs.readFileSync(path.join(FIXTURE_DIR, 'ff_calendar_thisweek.xml')));
  return { json, xml };
}

/**
 * architecture/economic-calendar.md §10 step 3 — the golden test against the committed real
 * 2026-09-16 fixture: "105 rows -> 105 events, 103 series ids, ids ff:832:2026-09-14 and
 * ff:832:2026-09-18 both present, ff:504:… likewise, All row accepted, scheduledAt for
 * Federal Funds Rate = 2026-09-16T18:00:00Z."
 */
describe('mapFeedSnapshot — golden 2026-09-16 fixture', () => {
  it('maps all 105 rows to 105 event drafts', () => {
    const { json, xml } = loadFixture();
    const drafts = mapFeedSnapshot(json, xml);
    expect(drafts).toHaveLength(105);
  });

  it('resolves 103 distinct series ids (two doubled: 832 and 504)', () => {
    const { json, xml } = loadFixture();
    const drafts = mapFeedSnapshot(json, xml);
    const seriesIds = new Set(drafts.map((d) => d.seriesId).filter((id): id is string => id !== null));
    expect(seriesIds.size).toBe(103);
    expect(drafts.every((d) => d.seriesId !== null)).toBe(true); // no unjoined rows in this fixture
  });

  it('produces ff:832:2026-09-14 and ff:832:2026-09-18 for the two Lagarde speeches', () => {
    const { json, xml } = loadFixture();
    const drafts = mapFeedSnapshot(json, xml);
    const ids = drafts.filter((d) => d.seriesId === '832').map((d) => d.id);
    expect(ids.sort()).toEqual(['ff:832:2026-09-14', 'ff:832:2026-09-18']);
  });

  it('produces two distinct ff:504:… ids for the two ECOFIN Meetings occurrences', () => {
    const { json, xml } = loadFixture();
    const drafts = mapFeedSnapshot(json, xml);
    const ids = drafts.filter((d) => d.seriesId === '504').map((d) => d.id);
    expect(ids.sort()).toEqual(['ff:504:2026-09-18', 'ff:504:2026-09-19']);
  });

  it('accepts the literal country "All" (BRICS Summit)', () => {
    const { json, xml } = loadFixture();
    const drafts = mapFeedSnapshot(json, xml);
    const brics = drafts.find((d) => d.title === 'BRICS Summit');
    expect(brics?.country).toBe('All');
  });

  it('Federal Funds Rate scheduledAt is 2026-09-16T18:00:00Z', () => {
    const { json, xml } = loadFixture();
    const drafts = mapFeedSnapshot(json, xml);
    const ffr = drafts.find((d) => d.title === 'Federal Funds Rate');
    expect(new Date(ffr!.scheduledAt).toISOString()).toBe('2026-09-16T18:00:00.000Z');
    expect(ffr!.scheduledDay).toBe('2026-09-16');
  });

  it('empty forecast/previous strings become null', () => {
    const { json, xml } = loadFixture();
    const drafts = mapFeedSnapshot(json, xml);
    const brics = drafts.find((d) => d.title === 'BRICS Summit');
    expect(brics?.forecast).toBeNull();
    expect(brics?.previous).toBeNull();
  });

  it('lower-cases impact and preserves unusual (non-clean-numeric) forecast/previous strings verbatim', () => {
    const { json, xml } = loadFixture();
    const drafts = mapFeedSnapshot(json, xml);
    const voteSplit = drafts.find((d) => d.title === 'MPC Official Bank Rate Votes');
    expect(voteSplit?.impact).toBe('high');
    expect(voteSplit?.forecast).toBe('3-0-6');
    const boj = drafts.find((d) => d.title === 'BOJ Policy Rate');
    expect(boj?.forecast).toBe('<1.25%');
  });

  it('assigns the ffx: fallback id when no XML row can be joined at all', () => {
    const json = [{ title: 'Mystery Event', country: 'USD', date: '2026-09-16T09:00:00-04:00', impact: 'Low', forecast: '', previous: '' }];
    const drafts = mapFeedSnapshot(json, []); // no XML rows -> no join possible
    expect(drafts[0].seriesId).toBeNull();
    expect(drafts[0].id).toMatch(/^ffx:[0-9a-f]{40}$/);
  });

  it('falls back to the instant-based join when positional order diverges', () => {
    const json = [
      { title: 'A', country: 'USD', date: '2026-09-16T09:00:00-04:00', impact: 'Low', forecast: '', previous: '' },
      { title: 'B', country: 'EUR', date: '2026-09-16T10:00:00-04:00', impact: 'Low', forecast: '', previous: '' },
    ];
    // XML rows reversed relative to JSON — positional join fails for both, instant join must recover.
    const xml = [
      { title: 'B', country: 'EUR', date: '09-16-2026', time: '2:00pm', impact: 'Low', forecast: '', previous: '', url: 'https://www.forexfactory.com/calendar/2-b' },
      { title: 'A', country: 'USD', date: '09-16-2026', time: '1:00pm', impact: 'Low', forecast: '', previous: '', url: 'https://www.forexfactory.com/calendar/1-a' },
    ];
    const drafts = mapFeedSnapshot(json, xml);
    expect(drafts.find((d) => d.title === 'A')?.seriesId).toBe('1');
    expect(drafts.find((d) => d.title === 'B')?.seriesId).toBe('2');
  });

  it('unknown impact strings map to "unknown" rather than throwing', () => {
    const json = [{ title: 'X', country: 'USD', date: '2026-09-16T09:00:00-04:00', impact: 'Weird', forecast: '', previous: '' }];
    const drafts = mapFeedSnapshot(json, []);
    expect(drafts[0].impact).toBe('unknown');
  });
});

describe('xmlInstantUtc', () => {
  it('reads the XML date+time as UTC directly (no ET conversion)', () => {
    // BusinessNZ Services Index: XML says 09-13-2026 / 10:30pm, and the JSON's equivalent instant
    // is 2026-09-13T18:30:00-04:00 = 2026-09-13T22:30:00Z.
    const ms = xmlInstantUtc('09-13-2026', '10:30pm');
    expect(new Date(ms!).toISOString()).toBe('2026-09-13T22:30:00.000Z');
  });

  it('returns null for non-clock-time values like "All Day"/"Tentative"', () => {
    expect(xmlInstantUtc('09-13-2026', 'All Day')).toBeNull();
    expect(xmlInstantUtc('09-13-2026', 'Tentative')).toBeNull();
  });

  it('handles 12am/12pm correctly', () => {
    expect(new Date(xmlInstantUtc('09-13-2026', '12:00am')!).toISOString()).toBe('2026-09-13T00:00:00.000Z');
    expect(new Date(xmlInstantUtc('09-13-2026', '12:00pm')!).toISOString()).toBe('2026-09-13T12:00:00.000Z');
  });
});
