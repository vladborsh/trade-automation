import { DbHandle } from '../src/db/db.port';
import { syncUniverse } from '../src/db/universe-sync';
import { parseUniverse } from '../src/config/universe.loader';

const UNIVERSE = parseUniverse(`
signal_set: [BTCUSDT]
symbols:
  - id: BTCUSDT
    base: BTC
    asset_class: crypto
    quote: USDT
    binance_perp: BTCUSDT
    binance_spot: BTCUSDT
    bybit_linear: BTCUSDT
    okx_swap: BTC-USDT-SWAP
    listed_perp: 2020-01-01
  - id: ETHUSDT
    base: ETH
    asset_class: crypto
    quote: USDT
    binance_perp: ETHUSDT
    listed_perp: 2020-01-01
`);

/** Records every statement; answers the deactivation query with whatever the test seeds. */
class FakeDb implements DbHandle {
  readonly calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  constructor(private readonly stale: string[] = []) {}
  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params });
    return (/^update symbols/.test(sql.trim()) ? this.stale.map((id) => ({ id })) : []) as T[];
  }
}

describe('syncUniverse', () => {
  it('upserts one row per symbol, with null for a mapping the file omits', async () => {
    const db = new FakeDb();
    const result = await syncUniverse(db, UNIVERSE);

    expect(result.upserted).toBe(2);
    const inserts = db.calls.filter((c) => c.sql.includes('insert into symbols'));
    expect(inserts).toHaveLength(2);
    // the trailing two are IB-031's volume_rank (from file order) and coingecko_id
    expect(inserts[0].params).toEqual(['BTCUSDT', 'BTC', 'USDT', 'BTCUSDT', 'BTCUSDT', 'BTCUSDT', 'BTC-USDT-SWAP', '2020-01-01', true, 1, null]);
    // ETHUSDT has no spot/bybit/okx mapping: null, never '' and never the perp symbol.
    expect(inserts[1].params).toEqual(['ETHUSDT', 'ETH', 'USDT', 'ETHUSDT', null, null, null, '2020-01-01', false, 2, null]);
  });

  it('IB-031: volume_rank comes from the file\'s order, which IS the ranking', async () => {
    const db = new FakeDb();
    await syncUniverse(db, UNIVERSE);
    const ranks = db.calls.filter((c) => c.sql.includes('insert into symbols')).map((c) => c.params?.[9]);
    expect(ranks).toEqual([1, 2]);
  });

  it('IB-031: an explicit volume_rank in the file overrides the position', async () => {
    const db = new FakeDb();
    const file = {
      ...UNIVERSE,
      symbols: [
        { ...UNIVERSE.symbols[0], volume_rank: 7 },
        { ...UNIVERSE.symbols[1], coingecko_id: 'ethereum' },
      ],
    };
    await syncUniverse(db, file as never);
    const inserts = db.calls.filter((c) => c.sql.includes('insert into symbols'));
    expect(inserts[0].params?.[9]).toBe(7);
    expect(inserts[1].params?.[9]).toBe(2);
    expect(inserts[1].params?.[10]).toBe('ethereum'); // never guessed from the ticker
  });

  it('is idempotent: every insert carries ON CONFLICT (id) DO UPDATE', async () => {
    const db = new FakeDb();
    await syncUniverse(db, UNIVERSE);
    for (const call of db.calls.filter((c) => c.sql.includes('insert into symbols'))) {
      expect(call.sql).toContain('on conflict (id) do update');
    }
  });

  it('marks in_signal_set from signal_set, not from the row order', async () => {
    const db = new FakeDb();
    await syncUniverse(db, UNIVERSE);
    const flags = db.calls.filter((c) => c.sql.includes('insert into')).map((c) => c.params[8]);
    expect(flags).toEqual([true, false]);
  });

  it('deactivates a symbol that left the file instead of deleting it', async () => {
    const db = new FakeDb(['SOLUSDT']);
    const result = await syncUniverse(db, UNIVERSE);

    expect(result.deactivated).toEqual(['SOLUSDT']);
    const update = db.calls.find((c) => c.sql.trim().startsWith('update symbols'));
    expect(update).toBeDefined();
    expect(update!.sql).toContain('set active = false');
    expect(update!.sql).not.toMatch(/delete/i);
    expect(update!.params[0]).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('reports nothing deactivated when the file still covers every active row', async () => {
    expect((await syncUniverse(new FakeDb([]), UNIVERSE)).deactivated).toEqual([]);
  });
});
