import fs from 'node:fs';
import path from 'node:path';
import { HttpException } from '@nestjs/common';
import { BinanceWeightTracker } from '../../../src/venues/binance/binance-weight.tracker';
import { FuturesDataClient, RETENTION_MS } from '../../../src/venues/binance/futures-data.client';
import { TtlCache } from '../../../src/venues/ttl-cache';
import { OiLsService } from '../../../src/web/market/oi-ls.service';
import { fakeFetch, type FakeRoute } from '../../venues/fake-fetch';

const fixtures = path.join(__dirname, '..', '..', 'fixtures', 'binance');
const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));
const OI_1H = read('openInterestHist-1h.json') as Array<{ timestamp: number; sumOpenInterest: string; sumOpenInterestValue: string }>;
const REFUSAL = fs.readFileSync(path.join(fixtures, 'futures-data-retention-1130.json'), 'utf8');

const H = 3_600_000;
const D = 24 * H;
// the fixture's 25 hourly rows span exactly one day; "now" is half an hour after the last one
const FROM = OI_1H[0].timestamp;
const TO = OI_1H[OI_1H.length - 1].timestamp;
const NOW = TO + H / 2;

function setup(routes: FakeRoute[]) {
  const f = fakeFetch(routes);
  const weight = new BinanceWeightTracker();
  const client = new FuturesDataClient({ baseUrl: 'https://fapi.example', weight, fetchImpl: f.impl });
  const service = new OiLsService({ client, weight, cache: new TtlCache({ now: () => NOW }), now: () => NOW });
  return { f, weight, service };
}

describe('OiLsService (WD-008)', () => {
  it('reads a window inside retention at the finest fitting period, with no coverage flags', async () => {
    const { f, service } = setup([{ match: 'openInterestHist', answer: { body: OI_1H } }]);
    const res = await service.openInterest('BTCUSDT', FROM, TO);
    expect(res.points).toHaveLength(25);
    expect(res.points[0]).toEqual({ time: FROM / 1000, value: Number(OI_1H[0].sumOpenInterest), notional: Number(OI_1H[0].sumOpenInterestValue) });
    expect(res).not.toHaveProperty('truncated');
    expect(res).not.toHaveProperty('coverageFrom');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toContain('period=5m');
  });

  it('counts each page into the shared tracker by hand — /futures/data sends no weight header', async () => {
    const { weight, service } = setup([{ match: 'openInterestHist', answer: { body: OI_1H } }]);
    await service.openInterest('BTCUSDT', FROM, TO);
    expect(weight.isEstimate(Date.now())).toBe(true);
    expect(weight.used1m(Date.now())).toBe(1);
  });

  it('serves a repeat read from the cache for its TTL', async () => {
    const { f, service } = setup([{ match: 'openInterestHist', answer: { body: OI_1H } }]);
    await service.openInterest('BTCUSDT', FROM, TO);
    await service.openInterest('BTCUSDT', FROM, TO);
    expect(f.calls).toHaveLength(1);
  });

  it('clips a window older than retention, reads the rest at a coarser period, and says where it starts', async () => {
    const { f, service } = setup([{ match: 'openInterestHist', answer: { body: OI_1H } }]);
    const res = await service.openInterest('BTCUSDT', NOW - 45 * D, NOW);
    expect(f.calls[0]).toContain('period=1h');
    expect(res.truncated).toBe(true);
    expect(res.coverageFrom).toBe(FROM / 1000);
    expect(res.points.length).toBeGreaterThan(0);
  });

  it('a window wholly before retention: no venue call, no points, and an explicit truncation', async () => {
    const { f, service } = setup([{ match: 'openInterestHist', answer: { body: OI_1H } }]);
    const res = await service.openInterest('BTCUSDT', NOW - 60 * D, NOW - 40 * D);
    expect(f.calls).toHaveLength(0);
    expect(res).toMatchObject({ points: [], truncated: true, coverageFrom: Math.floor((NOW - RETENTION_MS) / 1000) });
  });

  it('the venue refusing with -1130 (fixture) is the end of history — truncated, never an error', async () => {
    const { service } = setup([{ match: 'openInterestHist', answer: { status: 400, body: REFUSAL } }]);
    const res = await service.openInterest('BTCUSDT', FROM, TO);
    expect(res).toMatchObject({ points: [], truncated: true });
  });

  it('any other venue failure is a 502 VENUE_UNAVAILABLE, not a 500', async () => {
    const { service } = setup([{ match: 'openInterestHist', answer: { status: 500, body: 'oops' } }]);
    const err = (await service.openInterest('BTCUSDT', FROM, TO).catch((e: unknown) => e)) as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(502);
    expect(err.getResponse()).toMatchObject({ code: 'VENUE_UNAVAILABLE' });
  });

  it('above the 1 800/min ceiling: 503 without asking the venue', async () => {
    const { f, weight, service } = setup([{ match: 'openInterestHist', answer: { body: OI_1H } }]);
    weight.recordHeader(1_900, NOW);
    const err = (await service.openInterest('BTCUSDT', FROM, TO).catch((e: unknown) => e)) as HttpException;
    expect(err.getStatus()).toBe(503);
    expect(f.calls).toHaveLength(0);
  });

  it('long-short: each kind reads its own endpoint and maps the venue ratio (fixtures)', async () => {
    const cases = [
      ['global_account', 'globalLongShortAccountRatio', 'globalLongShortAccountRatio.json', 'longShortRatio'],
      ['top_account', 'topLongShortAccountRatio', 'topLongShortAccountRatio.json', 'longShortRatio'],
      ['top_position', 'topLongShortPositionRatio', 'topLongShortPositionRatio.json', 'longShortRatio'],
      ['taker', 'takerlongshortRatio', 'takerlongshortRatio.json', 'buySellRatio'],
    ] as const;
    for (const [kind, endpoint, file, field] of cases) {
      const rows = read(file) as Array<Record<string, string | number> & { timestamp: number }>;
      const last = Math.max(...rows.map((r) => r.timestamp));
      const f = fakeFetch([{ match: `/futures/data/${endpoint}?`, answer: { body: rows } }]);
      const weight = new BinanceWeightTracker();
      const client = new FuturesDataClient({ baseUrl: 'https://fapi.example', weight, fetchImpl: f.impl });
      const service = new OiLsService({ client, weight, cache: new TtlCache({ now: () => last + H }), now: () => last + H });
      const res = await service.longShort('BTCUSDT', kind, last - H, last);
      expect(res.kind).toBe(kind);
      // two fixture rows do not reach `from`, so the pager asks once more and stops on no progress
      expect(f.calls.length).toBeGreaterThan(0);
      expect(f.calls.every((u) => u.includes(`/futures/data/${endpoint}?`))).toBe(true);
      const newest = rows.find((r) => r.timestamp === last)!;
      expect(res.points.at(-1)).toEqual({ time: last / 1000, ratio: Number(newest[field]) });
    }
  });
});
