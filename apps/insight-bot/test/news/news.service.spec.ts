import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NewsService } from '../../src/news/news.service';
import type { NewsClient } from '../../src/news/news.client';
import type { NewsSource } from '../../src/news/sources';

/**
 * IB-027 — the poll's containment rules.
 *
 * Almost everything the service does lives in a pure module with its own spec, so what is left to
 * test here is the only thing the shell decides: **what one bad source does to the others**. Those
 * are the cases where a plausible implementation quietly lets the least reliable feed set the
 * tape's coverage.
 *
 * No timers and no network: `tick(now)` is driven directly and the client is a fake.
 */

const FIXTURE = readFileSync(join(__dirname, '..', 'fixtures', 'news', 'cointelegraph.rss.xml'), 'utf8');

const source = (id: string, over: Partial<NewsSource> = {}): NewsSource => ({
  id, url: `https://example.test/${id}`, kind: 'rss', shape: 'window', pollMs: 5 * 60_000, followRedirects: true, ...over,
});

/** Records which sources were asked for, and answers however the test says. */
function fakeClient(answers: Record<string, 'ok' | 'fail' | 'garbage' | 'empty'>) {
  const asked: string[] = [];
  const client = {
    async fetchSource(s: NewsSource) {
      asked.push(s.id);
      const answer = answers[s.id] ?? 'ok';
      if (answer === 'fail') return { ok: false as const, status: 503, reason: 'HTTP 503' };
      if (answer === 'garbage') return { ok: true as const, status: 200, body: 'this is not a feed' };
      if (answer === 'empty') return { ok: true as const, status: 200, body: '' };
      return { ok: true as const, status: 200, body: FIXTURE };
    },
  } as unknown as NewsClient;
  return { client, asked };
}

/** A database that records what it was asked to do and never actually stores anything. */
function fakeDb() {
  const calls: string[] = [];
  return {
    calls,
    db: {
      async query() { return []; },
      async transaction(fn: (tx: unknown) => Promise<unknown>) {
        calls.push('transaction');
        return fn({ async query() { return [{ id: 'x', cluster_id: '1' }]; } });
      },
    } as never,
  };
}

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);

describe('one bad source does not stop the others', () => {
  it('still polls every other source when one fails outright', async () => {
    const { client, asked } = fakeClient({ b: 'fail' });
    const { db } = fakeDb();
    const service = new NewsService(db, client, [source('a'), source('b'), source('c')]);

    await service.tick(NOW);

    expect(asked).toEqual(['a', 'b', 'c']);
  });

  it('still polls the others when one returns something unparseable', async () => {
    // a feed that changed shape is this source's problem; the pass must survive it
    const { client, asked } = fakeClient({ b: 'garbage' });
    const { db } = fakeDb();
    const service = new NewsService(db, client, [source('a'), source('b'), source('c')]);

    await service.tick(NOW);

    expect(asked).toEqual(['a', 'b', 'c']);
  });

  it('backs the failed source off while the healthy ones keep their cadence', async () => {
    const { client, asked } = fakeClient({ b: 'fail' });
    const { db } = fakeDb();
    const service = new NewsService(db, client, [source('a'), source('b')]);

    await service.tick(NOW);
    asked.length = 0;

    // six minutes later: 'a' is due again at its five-minute cadence; 'b' has doubled to ten
    await service.tick(NOW + 6 * 60_000);
    expect(asked).toEqual(['a']);

    // eleven minutes on, 'b' comes back round
    asked.length = 0;
    await service.tick(NOW + 11 * 60_000);
    expect(asked).toContain('b');
  });

  it('a source that fails is not retried every tick', async () => {
    // the bug this catches: recording the attempt only on success leaves a dead feed permanently
    // due, hammering it once a minute for ever
    const { client, asked } = fakeClient({ a: 'fail' });
    const { db } = fakeDb();
    const service = new NewsService(db, client, [source('a')]);

    await service.tick(NOW);
    asked.length = 0;
    await service.tick(NOW + 60_000);
    await service.tick(NOW + 120_000);
    expect(asked).toEqual([]);
  });
});

describe('a slow pass does not overlap the next tick', () => {
  it('drops a tick that arrives while one is still running', async () => {
    const released: Array<() => void> = [];
    const asked: string[] = [];
    const client = {
      async fetchSource(s: NewsSource) {
        asked.push(s.id);
        await new Promise<void>((resolve) => { released.push(resolve); });
        return { ok: true as const, status: 200, body: FIXTURE };
      },
    } as unknown as NewsClient;
    const { db } = fakeDb();
    const service = new NewsService(db, client, [source('a')]);

    const first = service.tick(NOW);
    await Promise.resolve();
    // a second tick arrives while the first is still waiting on the network
    await service.tick(NOW + 60_000);
    expect(asked).toEqual(['a']); // not asked twice

    released.forEach((r) => r());
    await first;
  });
});

describe('without a database', () => {
  it('does not start, rather than polling ten feeds and discarding the result', () => {
    const { client, asked } = fakeClient({});
    const service = new NewsService(null, client, [source('a')]);
    service.onApplicationBootstrap();
    expect(asked).toEqual([]);
    service.onModuleDestroy();
  });
});

describe('an empty response means different things to different sources', () => {
  it('a quiet TIME-FILTERED source stays healthy and keeps its cadence', async () => {
    // CFTC and SEC go genuinely silent on a weekend. If "no items" counted as a failure, a quiet
    // source would back ITSELF off and we would lose it for being quiet — the mirror of treating
    // silence as "published nothing", and just as undetectable from either side.
    const { client, asked } = fakeClient({ quiet: 'empty' });
    const { db } = fakeDb();
    const service = new NewsService(db, client, [source('quiet', { shape: 'time-filtered' })]);

    await service.tick(NOW);
    asked.length = 0;

    // six minutes on it is due again at its normal cadence, not backed off
    await service.tick(NOW + 6 * 60_000);
    expect(asked).toEqual(['quiet']);
  });

  it('an empty WINDOW feed is broken, and backs off', async () => {
    // a feed that serves "the last N items" cannot legitimately be empty
    const { client, asked } = fakeClient({ windowed: 'fail' });
    const { db } = fakeDb();
    const service = new NewsService(db, client, [source('windowed')]);

    await service.tick(NOW);
    asked.length = 0;
    await service.tick(NOW + 6 * 60_000);
    expect(asked).toEqual([]); // backed off to ten minutes
  });
});
