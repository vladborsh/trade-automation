import { changes, dvolTile, premiumTile, putCallTile, stablecoinTile, valueAt } from '../../src/web/market/flows.assemble';

/** IB-091 — the four tiles' maths (D2, D3, D18). */
const H = 3_600;
const D = 86_400;
const T0 = 1_790_000_000 - (1_790_000_000 % D);
const series = (n: number, step: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ timeSec: T0 + i * step, value: f(i) }));

describe('valueAt / changes', () => {
  it('the value at or before a time; null before the series starts', () => {
    const s = series(3, H, (i) => 10 + i);
    expect(valueAt(s, T0 + H + 5)).toBe(11);
    expect(valueAt(s, T0 - 1)).toBeNull();
    expect(changes(s, 1)).toEqual([1, 1]);
  });
});

describe('dvolTile (R8: signed rarity — a spike is a rise)', () => {
  const hourly = series(30 * 24, H, (i) => 40 + Math.sin(i / 5)); // calm, ±1 point
  const daily = series(400, D, (i) => 40 + (i % 3) - 1);
  it('1h: the change on the hourly series, against hourly changes; a big RISE is rare, a big fall is not', () => {
    const up = dvolTile([...hourly, { timeSec: hourly.at(-1)!.timeSec + H, value: 48 }], daily, '1h');
    expect(up.value).toBe(48);
    expect(up.change?.rarity).toBeGreaterThan(0.99);
    const down = dvolTile([...hourly, { timeSec: hourly.at(-1)!.timeSec + H, value: 32 }], daily, '1h');
    expect(down.change?.rarity).toBeLessThan(0.01);
  });
  it('24h and 7d take their sample from the DAILY series (it spans 400 days)', () => {
    const t = dvolTile(hourly, daily, '24h');
    expect(t.change?.sample).toBe(399);
    expect(t.change?.sampleDays).toBe(399);
    expect(dvolTile(hourly, daily, '7d').change?.sample).toBe(393);
    expect(t.series.length).toBe(7 * 24 + 1); // the mini-chart: the last 7 days hourly
  });
  it('a thin history keeps the value and refuses the rarity (D3)', () => {
    const short = series(10 * 24, H, () => 40);
    expect(dvolTile(short, series(10, D, () => 40), '1h').change?.rarity).toBeNull();
  });
});

describe('stablecoinTile (R9: two-sided — a mint or a burn)', () => {
  const daily = series(500, D, (i) => 200e9 + i * 1e8); // +100M a day, steadily
  it('1 day on 1h/4h/24h pages, 7 days on 7d; the current change is not in its own sample', () => {
    const t = stablecoinTile(daily, '24h');
    expect(t.changeDays).toBe(1);
    expect(t.changeUsd?.value).toBeCloseTo(1e8, 0);
    expect(t.changeUsd?.sample).toBe(364); // 365 days of points → 364 changes, minus the current
    expect(stablecoinTile(daily, '7d').changeDays).toBe(7);
    expect(t.series).toHaveLength(90);
  });
  it('a burn as unusual as a mint is equally rare', () => {
    const mint = stablecoinTile([...daily, { timeSec: daily.at(-1)!.timeSec + D, value: daily.at(-1)!.value + 5e9 }], '24h');
    const burn = stablecoinTile([...daily, { timeSec: daily.at(-1)!.timeSec + D, value: daily.at(-1)!.value - 5e9 }], '24h');
    expect(mint.changeUsd?.rarity).toBeGreaterThan(0.99);
    expect(burn.changeUsd?.rarity).toBe(mint.changeUsd?.rarity);
  });
});

describe('premiumTile (R10, D18)', () => {
  const now = T0 + 30 * D;
  const hourly = series(600, H, (i) => (i % 2 ? 0.01 : -0.01)); // 25 days of a tiny premium
  const minutes = (n: number, v: number) => Array.from({ length: n }, (_, i) => ({ timeSec: now - i * 60, value: v })).reverse();
  it('the mean of the valid minutes in the last hour, how many share its sign, a two-sided rarity', () => {
    const t = premiumTile([...minutes(50, 0.2), ...minutes(0, 0)], hourly, now);
    expect(t.premiumPct?.value).toBeCloseTo(0.2, 9);
    expect(t.minutes).toBe(50);
    expect(t.sameSignMinutes).toBe(50);
    expect(t.premiumPct?.rarity).toBeGreaterThan(0.99);
    expect(t.unavailable).toBeNull();
    expect(premiumTile(minutes(50, -0.2), hourly, now).premiumPct?.rarity).toBe(t.premiumPct?.rarity);
  });
  it('44 VALID minutes: the value stands WITH insufficient_minutes (D18); 45 does not', () => {
    expect(premiumTile(minutes(44, 0.2), hourly, now).unavailable).toBe('insufficient_minutes');
    expect(premiumTile(minutes(44, 0.2), hourly, now).premiumPct?.value).toBeCloseTo(0.2, 9);
    expect(premiumTile(minutes(45, 0.2), hourly, now).unavailable).toBeNull();
  });
  it('minutes older than the hour do not count; none at all is source_unavailable, not zero', () => {
    const old = minutes(60, 0.2).map((p) => ({ ...p, timeSec: p.timeSec - 2 * H }));
    expect(premiumTile(old, hourly, now)).toMatchObject({ premiumPct: null, minutes: 0, unavailable: 'source_unavailable' });
  });
});

describe('putCallTile (no rule — the cut)', () => {
  it('the latest day and the OI series; empty is null, not 0', () => {
    expect(putCallTile([{ timeSec: 1, oiRatio: 0.9, volumeRatio: 1.7 }, { timeSec: 2, oiRatio: 0.99, volumeRatio: 1.79 }]))
      .toEqual({ oiRatio: 0.99, volumeRatio: 1.79, asOf: 2, series: [{ time: 1, value: 0.9 }, { time: 2, value: 0.99 }] });
    expect(putCallTile([]).oiRatio).toBeNull();
  });
});
