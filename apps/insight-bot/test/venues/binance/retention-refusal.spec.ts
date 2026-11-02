import fs from 'node:fs';
import path from 'node:path';
import { BinanceWeightTracker } from '../../../src/venues/binance/binance-weight.tracker';
import {
  FuturesDataClient, RETENTION_ERROR_CODE, RetentionEdgeError, venueErrorCode,
} from '../../../src/venues/binance/futures-data.client';
import { fakeFetch } from '../fake-fetch';

/**
 * WD-008 — the SHAPE of Binance's retention refusal, pinned by a committed fixture (AGENTS.md: shapes
 * are pinned by fixtures; numbers by repetition). The body is the one IB-007 captured on 2026-09-28
 * (`futures-data.client.ts` quotes it). The 30-day figure itself is design text with its own record
 * there and is NOT asserted here.
 */
const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'binance', 'futures-data-retention-1130.json');
const body = fs.readFileSync(FIXTURE, 'utf8');

describe('Binance /futures/data retention refusal (fixture)', () => {
  it('the fixture is HTTP-400 JSON with code -1130 naming the rejected parameter', () => {
    const parsed = JSON.parse(body) as { code: number; msg: string };
    expect(parsed.code).toBe(RETENTION_ERROR_CODE);
    expect(parsed.msg).toMatch(/parameter '(endTime|startTime)' is invalid/);
    expect(venueErrorCode(body)).toBe(-1130);
  });

  it('the client turns that body into RetentionEdgeError — compact or pretty-printed', async () => {
    for (const served of [body, JSON.stringify(JSON.parse(body), null, 2)]) {
      const f = fakeFetch([{ match: '/futures/data/', answer: { status: 400, body: served } }]);
      const client = new FuturesDataClient({ baseUrl: 'https://fapi.example', weight: new BinanceWeightTracker(), fetchImpl: f.impl });
      await expect(client.fetchPage({ endpoint: 'openInterestHist', symbol: 'BTCUSDT' })).rejects.toBeInstanceOf(RetentionEdgeError);
    }
  });

  it('any other code is an ordinary error, not the retention edge', async () => {
    const f = fakeFetch([{ match: '/futures/data/', answer: { status: 400, body: { code: -1121, msg: 'Invalid symbol.' } } }]);
    const client = new FuturesDataClient({ baseUrl: 'https://fapi.example', weight: new BinanceWeightTracker(), fetchImpl: f.impl });
    const err = await client.fetchPage({ endpoint: 'openInterestHist', symbol: 'NOPE' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RetentionEdgeError);
    expect(venueErrorCode('not json')).toBeNull();
  });
});
