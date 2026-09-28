import { BITCOIN_ID, fractionalChange, marketCapCurrent, marketCapDays, shiftDay, type CoinCapRow } from '../../src/web/context/market-shares';

/**
 * IB-037 done-when: "specs for the derived shares". These are the only figures on the market page
 * that no venue sent — everything else is a stored row — so this is where a wrong number would
 * otherwise reach a reader looking authoritative.
 */

const COINS = [BITCOIN_ID, 'ethereum', 'solana'];
const row = (day: string, coin: string, capUsd: number | null, priceUsd: number | null = null): CoinCapRow => ({ day, coin, capUsd, priceUsd });

describe('marketCapDays — each coin as a share of Σ top-20 held that day', () => {
  it('shares are of the sum of the caps held, and they add to 1', () => {
    const [day] = marketCapDays([row('2026-09-01', BITCOIN_ID, 600), row('2026-09-01', 'ethereum', 300), row('2026-09-01', 'solana', 100)], COINS);
    expect(day.totalUsd).toBe(1000);
    expect(day.coinsCounted).toBe(3);
    expect(day.coins.map((c) => c.share)).toEqual([0.6, 0.3, 0.1]);
    expect(day.btcShare).toBe(0.6);
    expect(day.coins.reduce((sum, c) => sum + (c.share ?? 0), 0)).toBeCloseTo(1, 12);
  });

  it('a coin with no cap is null, not 0 %, and is out of the denominator — the rest still sum to 1', () => {
    const [day] = marketCapDays([row('2026-09-01', BITCOIN_ID, 600), row('2026-09-01', 'ethereum', 400), row('2026-09-01', 'solana', null, 123)], COINS);
    const solana = day.coins.find((c) => c.coin === 'solana');
    expect(solana).toEqual({ coin: 'solana', capUsd: null, share: null }); // a hole stays a hole
    expect(day.coinsCounted).toBe(2); // the denominator says it counted two, not three
    expect(day.totalUsd).toBe(1000);
    expect(day.btcShare).toBe(0.6);
    expect(day.coins.reduce((sum, c) => sum + (c.share ?? 0), 0)).toBeCloseTo(1, 12);
  });

  it('a coin absent from the rows is still present as a hole — a stacked chart must show the gap', () => {
    const [day] = marketCapDays([row('2026-09-01', BITCOIN_ID, 500), row('2026-09-01', 'ethereum', 500)], COINS);
    expect(day.coins.map((c) => c.coin)).toEqual(COINS); // the caller's order, all three
    expect(day.coins.find((c) => c.coin === 'solana')?.share).toBeNull();
  });

  it('the slice order is the caller order, so bands do not swap as caps move', () => {
    const rows = [row('2026-09-01', 'solana', 900), row('2026-09-01', BITCOIN_ID, 50), row('2026-09-01', 'ethereum', 50)];
    expect(marketCapDays(rows, COINS)[0].coins.map((c) => c.coin)).toEqual(COINS);
  });

  it('a day with nothing usable is shares of null, never 0 % of 0', () => {
    const [day] = marketCapDays([row('2026-09-01', BITCOIN_ID, null), row('2026-09-01', 'ethereum', 0)], COINS);
    expect(day.totalUsd).toBe(0);
    expect(day.coinsCounted).toBe(1); // 0 is a cap the venue really sent; null is not
    expect(day.btcShare).toBeNull();
    expect(day.coins.every((c) => c.share === null)).toBe(true);
  });

  it('rejects a negative or non-finite cap as no cap at all', () => {
    const [day] = marketCapDays([row('2026-09-01', BITCOIN_ID, -5), row('2026-09-01', 'ethereum', Number.NaN), row('2026-09-01', 'solana', 100)], COINS);
    expect(day.coinsCounted).toBe(1);
    expect(day.coins.map((c) => c.capUsd)).toEqual([null, null, 100]);
    expect(day.coins.find((c) => c.coin === 'solana')?.share).toBe(1);
  });

  it('days come back oldest first, whatever order the rows arrived in', () => {
    const rows = [row('2026-09-03', BITCOIN_ID, 1), row('2026-09-01', BITCOIN_ID, 1), row('2026-09-02', BITCOIN_ID, 1)];
    expect(marketCapDays(rows, COINS).map((d) => d.day)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  it('is empty for no rows rather than inventing a day', () => {
    expect(marketCapDays([], COINS)).toEqual([]);
  });
});

describe('marketCapCurrent — the table, and what a missing comparison day means', () => {
  const rows = [
    ...[['2026-09-01', 100], ['2026-09-07', 110], ['2026-09-08', 121]].map(([d, c]) => row(d as string, BITCOIN_ID, c as number)),
    row('2026-09-08', 'ethereum', 50, 3_000),
  ];
  const days = marketCapDays(rows, COINS);

  it('24 h and 7 d changes are fractional, against the day exactly that far back', () => {
    const btc = marketCapCurrent(days, rows).find((r) => r.coin === BITCOIN_ID);
    expect(btc?.change24h).toBeCloseTo(0.1, 12); // 110 -> 121
    expect(btc?.change7d).toBeCloseTo(0.21, 12); // 100 -> 121, seven days back
  });

  it('a comparison day we do not hold is null, not a 0 % move', () => {
    const eth = marketCapCurrent(days, rows).find((r) => r.coin === 'ethereum');
    expect(eth?.change24h).toBeNull();
    expect(eth?.change7d).toBeNull();
  });

  it("carries the newest day's price, which the day rows do not hold", () => {
    expect(marketCapCurrent(days, rows).find((r) => r.coin === 'ethereum')?.priceUsd).toBe(3_000);
  });

  it('orders by cap, largest first, with a capless coin last rather than dropped', () => {
    const table = marketCapCurrent(days, rows);
    expect(table.map((r) => r.coin)).toEqual([BITCOIN_ID, 'ethereum', 'solana']);
    expect(table.at(-1)).toMatchObject({ coin: 'solana', capUsd: null, share: null });
  });

  it('is empty when there are no days', () => {
    expect(marketCapCurrent([], [])).toEqual([]);
  });
});

describe('fractionalChange and shiftDay', () => {
  it('is (now - then) / then', () => {
    expect(fractionalChange(200, 150)).toBeCloseTo(-0.25, 12);
    expect(fractionalChange(200, 260)).toBeCloseTo(0.3, 12);
  });

  it('refuses to divide by a zero or missing base — an undefined move is null', () => {
    expect(fractionalChange(0, 100)).toBeNull();
    expect(fractionalChange(null, 100)).toBeNull();
    expect(fractionalChange(100, null)).toBeNull();
  });

  it('shifts whole UTC days, across a month end and a leap day', () => {
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDay('2026-03-01', -7)).toBe('2026-02-22');
    expect(shiftDay('2024-03-01', -1)).toBe('2024-02-29');
  });
});
