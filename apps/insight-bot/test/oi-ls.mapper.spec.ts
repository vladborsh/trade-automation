import * as fs from 'fs';
import * as path from 'path';
import {
  ACCOUNT_RATIO_ENDPOINTS,
  LongShortAccountRow,
  mapLongShortAccount,
  mapOpenInterestHist,
  mapTakerRatio,
  OpenInterestHistRow,
  TakerRatioRow,
} from '../src/collectors/binance-perp/oi-ls.mapper';

/** Payloads captured live from fapi.binance.com on 2026-09-28 (BTCUSDT, period=5m, limit=2). */
const fixture = <T>(name: string): T[] =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'binance', `${name}.json`), 'utf8')) as T[];

describe('mapOpenInterestHist (real payload)', () => {
  const rows = fixture<OpenInterestHistRow>('openInterestHist');

  it('stores both the base and the quote figure, parsed from the venue strings', () => {
    const [first] = mapOpenInterestHist(rows, 'BTCUSDT', 'rest');
    expect(first).toEqual({
      venue: 'binance',
      symbol: 'BTCUSDT',
      ts: new Date(1790601900000),
      oiBase: 95212.641,
      oiQuote: 7937947068.022778,
      source: 'rest',
    });
  });

  it('maps every row, on the 5-minute grid', () => {
    const mapped = mapOpenInterestHist(rows, 'BTCUSDT', 'rest');
    expect(mapped).toHaveLength(rows.length);
    expect(mapped[1].ts.getTime() - mapped[0].ts.getTime()).toBe(300_000);
  });

  it('ignores CMCCirculatingSupply — it is not a venue measurement', () => {
    expect(Object.keys(mapOpenInterestHist(rows, 'BTCUSDT', 'rest')[0])).not.toContain('CMCCirculatingSupply');
  });

  it('refuses a payload whose numbers are not numbers', () => {
    expect(() => mapOpenInterestHist([{ ...rows[0], sumOpenInterest: 'n/a' }], 'BTCUSDT', 'rest')).toThrow(
      /'sumOpenInterest' is not a number/,
    );
    expect(() => mapOpenInterestHist([{ ...rows[0], timestamp: 0 }], 'BTCUSDT', 'rest')).toThrow(/bad timestamp/);
  });
});

describe('mapLongShortAccount (real payloads)', () => {
  it.each(ACCOUNT_RATIO_ENDPOINTS)('$endpoint maps into kind $kind', ({ endpoint, kind }) => {
    const rows = fixture<LongShortAccountRow>(endpoint);
    const [first] = mapLongShortAccount(rows, 'BTCUSDT', kind, 'rest');
    expect(first.kind).toBe(kind);
    expect(first.venue).toBe('binance');
    expect(first.longRatio).toBeCloseTo(Number(rows[0].longAccount), 12);
    expect(first.shortRatio).toBeCloseTo(Number(rows[0].shortAccount), 12);
    expect(first.ratio).toBeCloseTo(Number(rows[0].longShortRatio), 12);
  });

  it('keeps the three account series distinguishable — they differ in the same slot', () => {
    // The captured payloads are the same symbol and overlapping slots, and the ratios differ:
    // proof that `kind` is carrying real information, not three copies of one series.
    const ratios = ACCOUNT_RATIO_ENDPOINTS.map(({ endpoint, kind }) => {
      const rows = fixture<LongShortAccountRow>(endpoint);
      return mapLongShortAccount(rows, 'BTCUSDT', kind, 'rest').find((r) => r.ts.getTime() === 1790602200000)?.ratio;
    });
    expect(new Set(ratios.filter((r) => r !== undefined)).size).toBeGreaterThan(1);
  });

  it('the long and short account shares sum to 1, as the venue reports them', () => {
    const rows = fixture<LongShortAccountRow>('globalLongShortAccountRatio');
    for (const row of mapLongShortAccount(rows, 'BTCUSDT', 'global_account', 'rest')) {
      expect((row.longRatio as number) + (row.shortRatio as number)).toBeCloseTo(1, 4);
    }
  });
});

describe('mapTakerRatio (real payload)', () => {
  const rows = fixture<TakerRatioRow>('takerlongshortRatio');

  it('normalises taker volumes into the same three columns', () => {
    const [first] = mapTakerRatio(rows, 'BTCUSDT', 'rest');
    const buy = Number(rows[0].buyVol);
    const sell = Number(rows[0].sellVol);
    expect(first.kind).toBe('taker');
    expect(first.symbol).toBe('BTCUSDT'); // the payload carries no symbol field — the caller supplies it
    expect(first.longRatio).toBeCloseTo(buy / (buy + sell), 12);
    expect(first.shortRatio).toBeCloseTo(sell / (buy + sell), 12);
    expect(first.ratio).toBeCloseTo(Number(rows[0].buySellRatio), 12);
  });

  it('the captured payload really has no symbol field — which is why the caller must supply it', () => {
    expect(rows[0]).not.toHaveProperty('symbol');
  });

  it('reports null shares, not 0.5 and not 0, for a slot with no taker volume', () => {
    const [empty] = mapTakerRatio([{ buyVol: '0', sellVol: '0', buySellRatio: '0', timestamp: 1790601600000 }], 'BTCUSDT', 'rest');
    expect(empty.longRatio).toBeNull();
    expect(empty.shortRatio).toBeNull();
    expect(empty.ratio).toBe(0); // the venue's own figure is still stored as sent
  });
});
