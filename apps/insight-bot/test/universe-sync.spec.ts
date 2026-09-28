import { DbHandle } from '../src/db/db.port';
import { syncUniverse } from '../src/db/universe-sync';
import { parseUniverse } from '../src/config/universe.loader';

const UNIVERSE = parseUniverse(`
signal_set: [BTCUSDT]
symbols:
  - id: BTCUSDT
    base: BTC
    quote: USDT
    binance_perp: BTCUSDT
    binance_spot: BTCUSDT
    bybit_linear: BTCUSDT
    okx_swap: BTC-USDT-SWAP
    listed_perp: 2020-01-01
  - id: ETHUSDT
    base: ETH
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
    expect(inserts[0].params).toEqual(['BTCUSDT', 'BTC', 'USDT', 'BTCUSDT', 'BTCUSDT', 'BTCUSDT', 'BTC-USDT-SWAP', '2020-01-01', true]);
    // ETHUSDT has no spot/bybit/okx mapping: null, never '' and never the perp symbol.
    expect(inserts[1].params).toEqual(['ETHUSDT', 'ETH', 'USDT', 'ETHUSDT', null, null, null, '2020-01-01', false]);
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
