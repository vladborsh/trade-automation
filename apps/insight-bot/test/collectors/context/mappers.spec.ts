import * as fs from 'fs';
import * as path from 'path';
import { fearGreedRows, marketCapCoinRows, marketCapGlobalRow, utcDay } from '../../../src/collectors/context/mappers';
import { FngPayload, GlobalPayload, MarketChartPayload } from '../../../src/collectors/context/payloads';

/** Recorded live from alternative.me and CoinGecko on 2026-09-28. */
const fixture = <T>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'context', `${name}.json`), 'utf8')) as T;

const AT = new Date('2026-09-28T18:00:00Z');

describe('fear & greed (real payload)', () => {
  const payload = fixture<FngPayload>('fng');

  it('maps every row, with the seconds timestamp read as a UTC day', () => {
    const rows = fearGreedRows(payload, AT);
    expect(rows).toHaveLength(payload.data.length);
    expect(rows[0].day).toBe(utcDay(Number(payload.data[0].timestamp) * 1000));
    expect(rows[0].value).toBe(Number(payload.data[0].value));
    expect(rows[0].classification).toBe(payload.data[0].value_classification);
    expect(rows[0].fetchedAt).toBe(AT);
  });

  it('treats the timestamp as SECONDS, not milliseconds', () => {
    // Read as ms it would land in 1970 — the classic unit error for this source.
    const [row] = fearGreedRows({ data: [{ value: '50', value_classification: 'Neutral', timestamp: '1790553600' }] }, AT);
    expect(row.day).toBe('2026-09-28');
    expect(row.day.startsWith('1970')).toBe(false);
  });

  it('rejects a value outside 0-100 rather than storing it', () => {
    const bad = { data: [{ value: '140', value_classification: 'Greed', timestamp: '1790553600' }] };
    expect(() => fearGreedRows(bad, AT)).toThrow(/out of range/);
    const nan = { data: [{ value: 'n/a', value_classification: 'Greed', timestamp: '1790553600' }] };
    expect(() => fearGreedRows(nan, AT)).toThrow(/not a number/);
  });

  it("surfaces the source's own error field instead of writing an empty history", () => {
    expect(() => fearGreedRows({ data: [], metadata: { error: 'rate limited' } }, AT)).toThrow(/rate limited/);
  });
});

describe('/global (real payload)', () => {
  const payload = fixture<GlobalPayload>('global');

  it('lifts btc and eth out and keeps the whole dominance map', () => {
    const row = marketCapGlobalRow(payload, AT);
    expect(row.totalUsd).toBe(payload.data.total_market_cap.usd);
    expect(row.btcPct).toBe(payload.data.market_cap_percentage.btc);
    expect(row.ethPct).toBe(payload.data.market_cap_percentage.eth);
    // The full map is kept because this series can never be re-collected.
    expect(Object.keys(row.dominance).length).toBeGreaterThan(5);
    expect(row.dominance).toEqual(payload.data.market_cap_percentage);
  });

  it("stamps the row with the venue's updated_at, so two polls in one refresh collapse", () => {
    const row = marketCapGlobalRow(payload, AT);
    expect(row.ts).toEqual(new Date((payload.data.updated_at as number) * 1000));
    // Same payload twice -> same primary key -> the upsert overwrites rather than duplicating.
    expect(marketCapGlobalRow(payload, new Date('2026-09-28T18:05:00Z')).ts).toEqual(row.ts);
  });

  it('falls back to the fetch time when the venue sends no updated_at', () => {
    const { updated_at: _omitted, ...rest } = payload.data;
    expect(marketCapGlobalRow({ data: rest } as GlobalPayload, AT).ts).toBe(AT);
  });

  it('reports a missing dominance figure as null, never 0 %', () => {
    const row = marketCapGlobalRow(
      { data: { total_market_cap: { usd: 1 }, market_cap_percentage: { eth: 10 } } } as GlobalPayload,
      AT,
    );
    expect(row.btcPct).toBeNull();
    expect(row.ethPct).toBe(10);
  });

  it('refuses a payload with no total market cap rather than storing zero', () => {
    expect(() =>
      marketCapGlobalRow({ data: { total_market_cap: {}, market_cap_percentage: {} } } as GlobalPayload, AT),
    ).toThrow(/no total_market_cap.usd/);
  });
});

describe('market_chart (real payload)', () => {
  const payload = fixture<MarketChartPayload>('market_chart');

  it('gives one row per UTC day with both series joined', () => {
    const rows = marketCapCoinRows(payload, 'bitcoin', AT);
    expect(rows.length).toBe(new Set(payload.prices.map(([ms]) => utcDay(ms))).size);
    expect(rows[0].coin).toBe('bitcoin');
    expect(rows.every((r) => r.priceUsd !== null)).toBe(true);
    expect(rows.every((r) => r.capUsd !== null)).toBe(true);
    expect(rows).toEqual([...rows].sort((a, b) => a.day.localeCompare(b.day)));
  });

  it('joins on the timestamp, not by position — a price with no matching cap gives null', () => {
    const rows = marketCapCoinRows(
      { prices: [[1790380800000, 84075]], market_caps: [[1790467200000, 999]] },
      'bitcoin',
      AT,
    );
    const priced = rows.find((r) => r.priceUsd === 84075);
    expect(priced?.capUsd).toBeNull(); // not 999, which belongs to a different day
    const capped = rows.find((r) => r.capUsd === 999);
    expect(capped?.priceUsd).toBeNull();
  });

  it('keeps a cap that has no price at all', () => {
    const rows = marketCapCoinRows({ prices: [], market_caps: [[1790380800000, 42]] }, 'bitcoin', AT);
    expect(rows).toEqual([{ day: utcDay(1790380800000), coin: 'bitcoin', capUsd: 42, priceUsd: null, fetchedAt: AT }]);
  });

  it('keeps the final partial day, which the upsert replaces tomorrow', () => {
    // CoinGecko's window ends at `now`, not at the last midnight, so the newest point is partial.
    const rows = marketCapCoinRows(payload, 'bitcoin', AT);
    expect(rows[rows.length - 1].day).toBe(utcDay(payload.prices[payload.prices.length - 1][0]));
  });

  it('survives an empty payload without inventing rows', () => {
    expect(marketCapCoinRows({ prices: [], market_caps: [] }, 'bitcoin', AT)).toEqual([]);
  });
});
