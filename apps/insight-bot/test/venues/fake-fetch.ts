import type { FetchLike, FetchLikeResponse } from '../../src/venues/fetch-like';

/**
 * WD-008 — one fake for every venue client: a table of URL routes to canned answers, shaped as
 * `FetchLike`. The first route whose `match` fits the URL answers; an unmatched URL fails the spec
 * loudly instead of returning something plausible.
 *
 * Headers follow the venue (WD-008 row; measured 5/5 on two occasions, `binance-weight.tracker.ts`):
 * a `/fapi/*` answer carries `x-mbx-used-weight-1m`, a `/futures/data/*` answer does not. A route
 * can override either way with `headers`.
 */
export interface FakeAnswer {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface FakeRoute {
  match: string | RegExp;
  /** One answer for every call, or a list served in order (the last one repeats). */
  answer: FakeAnswer | FakeAnswer[] | ((url: string) => FakeAnswer | Promise<FakeAnswer>);
}

export interface FakeFetch {
  impl: FetchLike;
  /** Every URL asked for, in order. */
  calls: string[];
  /** URLs asked for that contain `fragment`. */
  callsTo(fragment: string): string[];
}

export const FAKE_FAPI_USED_WEIGHT = '42';

export function fakeFetch(routes: FakeRoute[]): FakeFetch {
  const calls: string[] = [];
  const served = new Map<FakeRoute, number>();
  const impl: FetchLike = async (url) => {
    calls.push(url);
    const route = routes.find((r) => (typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url)));
    if (!route) throw new Error(`fake-fetch: no route for ${url}`);
    let answer: FakeAnswer;
    if (typeof route.answer === 'function') answer = await route.answer(url);
    else if (Array.isArray(route.answer)) {
      const n = served.get(route) ?? 0;
      served.set(route, n + 1);
      answer = route.answer[Math.min(n, route.answer.length - 1)];
    } else answer = route.answer;
    return respond(url, answer);
  };
  return { impl, calls, callsTo: (fragment) => calls.filter((u) => u.includes(fragment)) };
}

function respond(url: string, answer: FakeAnswer): FetchLikeResponse {
  const status = answer.status ?? 200;
  const headers = new Map<string, string>();
  if (new URL(url).pathname.startsWith('/fapi/')) headers.set('x-mbx-used-weight-1m', FAKE_FAPI_USED_WEIGHT);
  for (const [k, v] of Object.entries(answer.headers ?? {})) headers.set(k.toLowerCase(), v);
  const text = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : `HTTP ${status}`,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  };
}
