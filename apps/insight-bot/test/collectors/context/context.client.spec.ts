import { ContextClient, MAX_RETRIES, RETRY_AFTER_MS } from '../../../src/collectors/context/context.client';

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const urls: string[] = [];
  let i = 0;
  const impl = (async (url: string) => {
    urls.push(String(url));
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => next.body,
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    };
  }) as unknown as typeof fetch;
  return { impl, urls, calls: () => i };
}

function build(responses: Parameters<typeof fakeFetch>[0]) {
  const slept: number[] = [];
  const f = fakeFetch(responses);
  const client = new ContextClient({
    fngBaseUrl: 'https://fng.test',
    coingeckoBaseUrl: 'https://cg.test',
    fetchImpl: f.impl,
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  return { client, slept, ...f };
}

describe('URLs', () => {
  it('builds the keyless endpoints the design probed', async () => {
    const { client, urls } = build([{ body: { data: [] } }]);
    await client.fearGreed(0);
    await client.global();
    await client.coinMarketChart('bitcoin', 365);
    expect(urls).toEqual([
      'https://fng.test/fng/?limit=0',
      'https://cg.test/api/v3/global',
      'https://cg.test/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily',
    ]);
  });

  it('escapes a coin id rather than pasting it into the path', async () => {
    const { client, urls } = build([{ body: {} }]);
    await client.coinMarketChart('a/b?c', 2);
    expect(urls[0]).toContain('coins/a%2Fb%3Fc/market_chart');
  });
});

describe('back-off', () => {
  it('retries a 429 after 60 s, at most 3 times, then gives up', async () => {
    const { client, slept, calls } = build([{ status: 429, body: 'slow down' }]);
    await expect(client.global()).rejects.toThrow(/HTTP 429/);
    expect(slept).toEqual([RETRY_AFTER_MS, RETRY_AFTER_MS, RETRY_AFTER_MS]);
    expect(calls()).toBe(MAX_RETRIES + 1);
  });

  it('succeeds when the retry works', async () => {
    const { client, slept } = build([{ status: 429, body: 'slow' }, { body: { data: { ok: true } } }]);
    await expect(client.global()).resolves.toEqual({ data: { ok: true } });
    expect(slept).toEqual([RETRY_AFTER_MS]);
  });

  it('does NOT retry a 401 — that is the venue saying the endpoint is paid, not a hiccup', async () => {
    const { client, slept, calls } = build([{ status: 401, body: { error: { status: { error_code: 10012 } } } }]);
    await expect(client.coinMarketChart('bitcoin', 99999)).rejects.toThrow(/needs a paid key/);
    expect(slept).toEqual([]);
    expect(calls()).toBe(1);
  });

  it('names the two paid endpoints in the 401 message, since that is the likely mistake', async () => {
    const { client } = build([{ status: 401, body: 'nope' }]);
    await expect(client.global()).rejects.toThrow(/market_cap_chart and days=max/);
  });

  it('does not retry other failures', async () => {
    const { client, calls } = build([{ status: 500, body: 'boom' }]);
    await expect(client.global()).rejects.toThrow(/HTTP 500/);
    expect(calls()).toBe(1);
  });
});
