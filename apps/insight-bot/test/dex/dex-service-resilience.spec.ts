import { DexService, TICK_MS } from '../../src/dex/dex.service';
import type { DexClient, Fetched } from '../../src/dex/dex.client';
import type { Db } from '../../src/db/db.port';

/**
 * IB-028 — the tick must survive one bad minute, because the timer cannot survive a rejection.
 *
 * `setInterval(() => void this.tick())` means a rejected tick is an unhandled promise rejection,
 * and since Node 15 the default for those is to terminate the process. So a transient error in our
 * own database would take down the collectors, the news ingest and the web API along with this
 * loop. These specs are the control on that: they drive a tick against a database that throws and
 * assert the promise RESOLVES, then assert the next tick still works.
 */
const ok = (body: string): Fetched => ({ ok: true, body, status: 200 });

const emptyClient = (): DexClient => ({
  geckoTerminal: () => Promise.resolve(ok('{"data":[]}')),
  dexScreener: () => Promise.resolve(ok('{"pairs":[]}')),
  goPlus: () => Promise.resolve(ok('{"result":{}}')),
} as unknown as DexClient);

describe('DexService.tick under failure', () => {
  it('does not reject when the database throws — a rejection would kill the process', async () => {
    const db = { query: () => Promise.reject(new Error('connection terminated unexpectedly')) };
    const service = new DexService(db as unknown as Db, emptyClient());
    await expect(service.tick(Date.now())).resolves.toBeUndefined();
  });

  it('runs the NEXT tick after a failure, rather than wedging on `running`', async () => {
    // the finally that clears `running` is the other half: without it one failed tick would make
    // every later tick a no-op and the loop would go quiet while looking alive
    let calls = 0;
    const db = {
      query: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('blip')) : Promise.resolve([]);
      },
    };
    const service = new DexService(db as unknown as Db, emptyClient());
    await service.tick(1_000);
    await service.tick(1_000 + TICK_MS);
    expect(calls).toBeGreaterThan(1); // it tried again
  });

  it('refuses to overlap itself, which is what `running` is for', async () => {
    /*
     * The first query hangs until released; every later one resolves at once.
     *
     * Two earlier versions of this test TIMED OUT instead of failing, both because the resolver
     * was captured inside `query` — so releasing it before the tick had reached its first query
     * released nothing, and the tick waited for ever. The deferred is created up front, and the
     * test yields with `setImmediate` rather than one microtask, because a tick passes through
     * several awaits before it touches the database. The version before that ended on
     * `expect(true).toBe(true)`, which would have passed whatever the service did.
     */
    let releaseFirst: (rows: unknown[]) => void = () => undefined;
    const firstQuery = new Promise<unknown[]>((resolve) => { releaseFirst = resolve; });
    let taken = false;
    const db = {
      query: () => {
        if (taken) return Promise.resolve([]);
        taken = true;
        return firstQuery;
      },
    };
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    let gecko = 0;
    const counting = {
      geckoTerminal: () => { gecko += 1; return Promise.resolve(ok('{"data":[]}')); },
      dexScreener: () => Promise.resolve(ok('{"pairs":[]}')),
      goPlus: () => Promise.resolve(ok('{"result":{}}')),
    } as unknown as DexClient;

    const service = new DexService(db as unknown as Db, counting);
    const inFlight = service.tick(1_000);
    await flush(); // let the first tick get as far as the database
    expect(gecko).toBe(1);
    expect(taken).toBe(true); // the premise: it really is blocked on a query

    // far enough ahead that the spacing would allow a call, so only `running` can stop it — two
    // overlapping ticks would mean two GeckoTerminal calls inside the measured 75 s window
    await service.tick(1_000 + 10 * TICK_MS);
    expect(gecko).toBe(1);

    releaseFirst([]);
    await inFlight;
    expect(gecko).toBe(1);

    // and once it HAS finished, a later tick is allowed through again
    await service.tick(1_000 + 20 * TICK_MS);
    expect(gecko).toBe(2);
  });
});
