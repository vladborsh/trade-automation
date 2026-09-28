import type { AppConfigService } from '../../src/config/config.service';
import type { Db } from '../../src/db/db.port';
import { WebContextController } from '../../src/web/context/context.controller';

/**
 * IB-037 — the two context endpoints, driven through a fake `Db` so the shapes and the window
 * rules are pinned without Postgres. The share maths itself is `market-shares.spec.ts`.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 28); // 2026-09-28

/** A `Db` that answers each query by the table it names, and records what it was asked. */
function fakeDb(rows: Record<string, unknown[]>) {
  const asked: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
      asked.push({ sql, params });
      const table = ['fear_greed', 'market_cap_global', 'market_cap_coin'].find((t) => sql.includes(t)) ?? '';
      const key = sql.includes('order by day desc') ? 'fear_greed_latest' : sql.includes('order by ts limit 1') ? 'dominance_start' : table;
      return (rows[key] ?? []) as T[];
    },
  } as unknown as Db;
  return { db, asked };
}

const config = (symbols: Array<{ id: string; coingecko_id?: string; volume_rank?: number }>) =>
  ({ symbols }) as unknown as AppConfigService;

const UNIVERSE = [
  { id: 'BTCUSDT', coingecko_id: 'bitcoin', volume_rank: 1 },
  { id: 'ETHUSDT', coingecko_id: 'ethereum', volume_rank: 2 },
  { id: 'NOIDUSDT', volume_rank: 3 }, // no coingecko_id: must be skipped, never guessed
];

describe('WebContextController — fear & greed', () => {
  it('returns the window, and `latest` from the WHOLE series even when it falls outside it', async () => {
    const { db } = fakeDb({
      fear_greed: [{ day: '2026-09-01', value: 20, classification: 'Extreme Fear' }],
      fear_greed_latest: [{ day: '2026-09-28', value: 71, classification: 'Greed' }],
    });
    const res = await new WebContextController(config(UNIVERSE), db).fearGreed(String(T0 - 30 * DAY), String(T0 - 20 * DAY));

    expect(res.points).toEqual([{ day: '2026-09-01', value: 20, classification: 'Extreme Fear' }]);
    // the gauge says "today": an old window must not be able to present a stale value as current
    expect(res.latest).toEqual({ day: '2026-09-28', value: 71, classification: 'Greed' });
    expect(res.downsampled).toBe(false);
  });

  it('defaults to the last 365 days when no window is given', async () => {
    const { db, asked } = fakeDb({});
    await new WebContextController(config(UNIVERSE), db).fearGreed();
    const [from, to] = asked[0].params as [string, string];
    expect(Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)).toBe(365);
  });

  it('refuses a backwards or non-numeric window rather than guessing', async () => {
    const controller = new WebContextController(config(UNIVERSE), fakeDb({}).db);
    await expect(controller.fearGreed(String(T0), String(T0 - DAY))).rejects.toThrow();
    await expect(controller.fearGreed('yesterday', String(T0))).rejects.toThrow();
  });

  it('answers empty without a database rather than throwing (the app boots without one)', async () => {
    const res = await new WebContextController(config(UNIVERSE), null).fearGreed();
    expect(res).toEqual({ points: [], latest: null, downsampled: false });
  });
});

describe('WebContextController — market cap', () => {
  const caps = [
    { day: '2026-09-27', coin: 'bitcoin', cap_usd: '100', price_usd: '10' },
    { day: '2026-09-27', coin: 'ethereum', cap_usd: '100', price_usd: '5' },
    { day: '2026-09-28', coin: 'bitcoin', cap_usd: '150', price_usd: '15' },
    { day: '2026-09-28', coin: 'ethereum', cap_usd: '50', price_usd: '4' },
  ];

  it('derives the stacked days, the table and the dominance line from stored rows', async () => {
    const { db } = fakeDb({
      market_cap_coin: caps,
      market_cap_global: [{ ts: new Date(T0), total_usd: '2000', btc_pct: 52.5, eth_pct: null }],
      dominance_start: [{ ts: new Date(T0 - 10 * DAY) }],
    });
    const res = await new WebContextController(config(UNIVERSE), db).marketCap();

    expect(res.days.map((d) => d.day)).toEqual(['2026-09-27', '2026-09-28']);
    expect(res.days.at(-1)?.btcShare).toBeCloseTo(0.75, 12); // 150 of 200 — of the top 20, not the market
    expect(res.current.map((r) => r.coin)).toEqual(['bitcoin', 'ethereum']);
    expect(res.current[0]).toMatchObject({ capUsd: 150, priceUsd: 15 });
    expect(res.current[0].change24h).toBeCloseTo(0.5, 12); // 100 -> 150
    // `/global`'s dominance is a different number from btcShare and stays its own field
    expect(res.dominance).toEqual([{ ts: T0, totalUsd: 2000, btcPct: 52.5, ethPct: null }]);
    expect(res.dominanceStart).toBe(T0 - 10 * DAY);
  });

  it('asks only for the top-20 coins that HAVE a coingecko id, in rank order', async () => {
    const { db, asked } = fakeDb({});
    await new WebContextController(config(UNIVERSE), db).marketCap();
    const capsQuery = asked.find((a) => a.sql.includes('market_cap_coin'));
    expect(capsQuery?.params[0]).toEqual(['bitcoin', 'ethereum']); // NOIDUSDT skipped, not guessed
  });

  it('keeps a null dominance percentage null — the venue omitted the coin, it is not 0 %', async () => {
    const { db } = fakeDb({ market_cap_global: [{ ts: new Date(T0), total_usd: '1', btc_pct: null, eth_pct: null }] });
    const res = await new WebContextController(config(UNIVERSE), db).marketCap();
    expect(res.dominance[0]).toMatchObject({ btcPct: null, ethPct: null });
  });

  it('answers empty without a database', async () => {
    expect(await new WebContextController(config(UNIVERSE), null).marketCap()).toEqual({
      days: [], current: [], dominance: [], dominanceStart: null, downsampled: false,
    });
  });
});
