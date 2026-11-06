import { HttpException } from '@nestjs/common';
import type { Db } from '../../src/db/db.port';
import { STALE_AFTER_MS } from '../../src/collectors/uptime/uptime.recorder';
import { profileVenueStates } from '../../src/web/series/liq-profile-venues';
import { LiqProfileController } from '../../src/web/series/liq-profile.controller';
import { LiqProfileService } from '../../src/web/series/liq-profile.service';

/**
 * IB-153 — the profile's venue states (IB-BUG-011: a venue that was not listening is «нет данных», never
 * $0) and the route's refusals. The banding itself is pinned against Postgres in
 * test/db/liq-profile.integration.spec.ts.
 */
const HOUR = 3_600_000;
const FROM = Date.UTC(2026, 10, 3);
const TO = FROM + 24 * HOUR;
const streamOf = { binance: 'b', bybit: 'y', okx: 'o' };
const listed = { binance: 'BTCUSDT', bybit: 'BTCUSDT', okx: 'BTC-USDT-SWAP' };
const beat = (stream: string, first: number, last: number) =>
  [stream, { stream, venue: stream, firstSeenAt: new Date(first), lastSeenAt: new Date(last) }] as const;

describe('profile venue states (IB-153)', () => {
  it('rows → recorded; silent but listening throughout → no_events; silent with an outage → not_recorded', () => {
    const states = profileVenueStates({
      listed, streamOf,
      beats: new Map([beat('b', FROM - HOUR, TO), beat('y', FROM - HOUR, TO), beat('o', FROM - HOUR, TO)]),
      gaps: [{ stream: 'o', gapFrom: new Date(FROM + HOUR), gapTo: new Date(FROM + 2 * HOUR) }],
      rowsByVenue: new Map([['binance', 12]]),
      fromMs: FROM, toMs: TO, nowMs: TO,
    });
    expect(states).toEqual([
      { venue: 'binance', state: 'recorded' },
      { venue: 'bybit', state: 'no_events' },
      { venue: 'okx', state: 'not_recorded' },
    ]);
  });

  it('no heartbeat, a collector younger than the window, or a stale one: not_recorded, never $0', () => {
    const states = profileVenueStates({
      listed, streamOf,
      beats: new Map([beat('y', FROM + HOUR, TO), beat('o', FROM - HOUR, TO - 2 * STALE_AFTER_MS)]),
      gaps: [], rowsByVenue: new Map(), fromMs: FROM, toMs: TO, nowMs: TO,
    });
    expect(states.map((s) => s.state)).toEqual(['not_recorded', 'not_recorded', 'not_recorded']);
  });

  it('a window reaching past now is judged up to now; a coin a venue does not list is not_listed', () => {
    const states = profileVenueStates({
      listed: { ...listed, okx: null }, streamOf,
      beats: new Map([beat('b', FROM - HOUR, FROM + HOUR), beat('y', FROM - HOUR, FROM + HOUR)]),
      gaps: [], rowsByVenue: new Map(), fromMs: FROM, toMs: TO, nowMs: FROM + HOUR,
    });
    expect(states).toEqual([
      { venue: 'binance', state: 'no_events' },
      { venue: 'bybit', state: 'no_events' },
      { venue: 'okx', state: 'not_listed' },
    ]);
  });
});

describe('GET /series/liquidations/profile refusals (IB-153)', () => {
  const db: Db = { query: async () => [] as never, transaction: async (fn) => fn(db) };
  const controller = new LiqProfileController(db, new LiqProfileService(db, () => TO));
  const code = async (p: Promise<unknown>) => {
    try { await p; return null; } catch (e) { return ((e as HttpException).getResponse() as { code: string }).code; }
  };

  it('refuses a bad symbol, a non-positive or missing price span, and a window over 90 days', async () => {
    expect(await code(controller.profile('btc usdt', String(FROM), String(TO), '1', '2'))).toBe('BAD_REQUEST');
    expect(await code(controller.profile('BTCUSDT', String(FROM), String(TO), '0', '2'))).toBe('BAD_REQUEST');
    expect(await code(controller.profile('BTCUSDT', String(FROM), String(TO), 'x', '2'))).toBe('BAD_REQUEST');
    expect(await code(controller.profile('BTCUSDT', String(TO), String(FROM), '1', '2'))).toBe('BAD_REQUEST');
    expect(await code(controller.profile('BTCUSDT', String(TO - 91 * 24 * HOUR), String(TO), '1', '2'))).toBe('RANGE_TOO_WIDE');
  });

  it('without a database: 503, not an empty profile', async () => {
    const none = new LiqProfileController(null, new LiqProfileService(null, () => TO));
    await expect(none.profile('BTCUSDT', String(FROM), String(TO), '1', '2')).rejects.toThrow(HttpException);
  });

  it('a second ask for the same view is served from the cache: one read, not two', async () => {
    let reads = 0;
    const counting: Db = { query: async () => { reads += 1; return [] as never; }, transaction: async (fn) => fn(counting) };
    const service = new LiqProfileService(counting, () => TO);
    await service.profile('BTCUSDT', FROM, TO, 76_200, 78_100);
    const after = reads;
    await service.profile('BTCUSDT', FROM, TO, 76_210, 78_110); // a scroll inside the cover: same step, same key
    expect(reads).toBe(after);
  });
});
