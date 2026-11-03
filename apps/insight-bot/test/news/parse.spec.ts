import * as fs from 'fs';
import * as path from 'path';
import { parseFeed, parseDate } from '../../src/news/parse';
import {
  parseBinanceAnnouncements,
  parseBybitAnnouncements,
  parseOkxAnnouncements,
} from '../../src/news/parse-json';

/** Recorded live on 2026-09-28; a changed shape fails here, which is the guard we prefer. */
const fixture = (name: string): string =>
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'news', name), 'utf8');

/**
 * **Positive control (IB-027 rule).** This spec carries at least one fixture that MUST FIRE, and
 * this comment says why, so nobody "simplifies" the fixtures back to the cheap negative ones.
 *
 * A detector tested only on inputs that should NOT match is unfalsifiable: a dead pattern passes
 * every one of those tests. Not hypothetical — the cashtag rule in `assets.ts` had never worked at
 * all (a double-escaped pattern demanded a literal backslash in the article text), and its absence
 * was indistinguishable from "no cashtag in this article". One firing fixture found it instantly.
 *
 * Negative cases prove precision; positive ones prove the detector is alive. Neither half alone is
 * enough — the same pairing as the ON DELETE RESTRICT tests: the refusal AND the permitted case.
 */

describe('parseDate', () => {
  it('reads RFC 822, ISO 8601 and epoch forms', () => {
    expect(parseDate('Mon, 28 Sep 2026 12:00:00 +0000')?.toISOString()).toBe('2026-09-28T12:00:00.000Z');
    expect(parseDate('2026-09-28T12:00:00Z')?.toISOString()).toBe('2026-09-28T12:00:00.000Z');
    expect(parseDate('1790589613103')?.getTime()).toBe(1790589613103); // epoch ms
    expect(parseDate('1790589613')?.getTime()).toBe(1790589613000); // epoch seconds
  });

  it('returns null rather than an Invalid Date', () => {
    for (const bad of ['', '   ', 'yesterday', 'not a date']) expect(parseDate(bad)).toBeNull();
  });
});

describe('RSS (cointelegraph fixture)', () => {
  const result = parseFeed('cointelegraph', fixture('cointelegraph.rss.xml'));

  it('reads every item with a url, a title and a real published date', () => {
    expect(result.items.length).toBeGreaterThan(10);
    for (const item of result.items) {
      expect(item.url).toMatch(/^https?:\/\//);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.publishedAt.getTime()).toBeGreaterThan(Date.UTC(2020, 0, 1));
      expect(item.source).toBe('cointelegraph');
    }
  });

  it('gives each item a source-scoped id and both hashes', () => {
    const [first] = result.items;
    expect(first.id.startsWith('cointelegraph:')).toBe(true);
    expect(first.urlHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.titleHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces no duplicate ids within one feed read', () => {
    expect(new Set(result.items.map((i) => i.id)).size).toBe(result.items.length);
  });
});

describe('Atom (blockworks fixture)', () => {
  const result = parseFeed('blockworks', fixture('blockworks.atom.xml'));

  it('reads <entry> and takes the href from <link>', () => {
    expect(result.items.length).toBeGreaterThan(10);
    for (const item of result.items) expect(item.url).toMatch(/^https?:\/\//);
  });

  it('uses published/updated for the date', () => {
    for (const item of result.items) expect(Number.isFinite(item.publishedAt.getTime())).toBe(true);
  });
});

describe('malformed input', () => {
  it('reports unparseable XML instead of throwing', () => {
    const result = parseFeed('x', '<rss><channel><item><title>oops');
    expect(result.items).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it('skips an item with no date, with a reason, rather than stamping it now', () => {
    // published_at drives the reaction window: a guessed stamp yields a confidently wrong return.
    const xml = '<rss><channel><item><title>T</title><link>https://a.com/x</link></item></channel></rss>';
    const result = parseFeed('x', xml);
    expect(result.items).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/published date/);
  });

  it('skips an item with no link', () => {
    const xml = '<rss><channel><item><title>T</title><pubDate>Mon, 28 Sep 2026 12:00:00 +0000</pubDate></item></channel></rss>';
    expect(parseFeed('x', xml).skipped[0].reason).toBe('no url');
  });
});

describe('Binance announcements (fixture)', () => {
  const result = parseBinanceAnnouncements('binance-announcements', fixture('binance-announcements.json'));

  it('builds the URL from `code`, since the payload carries none', () => {
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.url).toMatch(/^https:\/\/www\.binance\.com\/en\/support\/announcement\/[0-9a-f]+$/);
    }
  });

  it('uses releaseDate (epoch ms) as the published stamp', () => {
    for (const item of result.items) {
      expect(item.publishedAt.getTime()).toBeGreaterThan(Date.UTC(2024, 0, 1));
    }
  });
});

describe('OKX announcements (fixture)', () => {
  const result = parseOkxAnnouncements('okx-announcements', fixture('okx-announcements.json'));

  it('flattens data[].details[] and reads pTime', () => {
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.url).toMatch(/^https?:\/\//);
      expect(item.publishedAt.getTime()).toBeGreaterThan(Date.UTC(2024, 0, 1));
    }
  });

  it("surfaces OKX's in-body error code rather than returning an empty success", () => {
    const result = parseOkxAnnouncements('okx-announcements', '{"code":"50011","msg":"rate limited","data":[]}');
    expect(result.items).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/okx code 50011/);
  });
});

describe('Bybit announcements (fixture)', () => {
  const result = parseBybitAnnouncements('bybit-announcements', fixture('bybit-announcements.json'));

  it('reads result.list[] with its url and description', () => {
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) expect(item.url).toMatch(/^https?:\/\//);
  });

  it('prefers publishTime over dateTimestamp', () => {
    // dateTimestamp is the campaign's start (it equals startDateTimestamp on every sampled row)
    // and is often a day earlier — using it would open the reaction window before the news.
    const raw = JSON.parse(fixture('bybit-announcements.json')) as {
      result: { list: Array<{ url: string; publishTime: number; dateTimestamp: number }> };
    };
    const sample = raw.result.list[0];
    const parsed = result.items.find((i) => i.url === sample.url);
    expect(parsed?.publishedAt.getTime()).toBe(sample.publishTime);
    if (sample.publishTime !== sample.dateTimestamp) {
      expect(parsed?.publishedAt.getTime()).not.toBe(sample.dateTimestamp);
    }
  });

  it("surfaces Bybit's retCode rather than returning an empty success", () => {
    const result = parseBybitAnnouncements('bybit-announcements', '{"retCode":10001,"retMsg":"bad","result":{"list":[]}}');
    expect(result.skipped[0].reason).toMatch(/bybit retCode 10001/);
  });
});
