import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LiqEventContinuingDetails, LiqEventDetails, LiqVenue } from '@trade-automation/contracts';
import { LiqAlertLoop } from '../../../src/alerts/liquidations/liq-alert-loop';
import { MemoryLiqStore } from './memory-liq-store';

/**
 * IB-143 L15 — IB-BUG-046's scene from the box tape: BTC shorts 2026-11-04 14:30 → 15:50 (fixture). Under IB-122
 * the quiet period from the 14:41:07 crossing ended inside a running cascade, the next crossing came at 15:13:12,
 * and its per-coin 2× continuation was dated 15:08:50, BEFORE it. Under IB-143 a continuation is the event's
 * close (close ≥ S ≥ T0), so it cannot predate its first message.
 */
const fixture = JSON.parse(readFileSync(join(__dirname, '../../fixtures/liq-btc-short-2026-11-04.json'), 'utf8')) as {
  baseMs: number; rows: Array<[number, LiqVenue, string, number]>;
};
const at = (hh: number, mm: number, ss = 0, ms = 0) => Date.UTC(2026, 10, 4, hh, mm, ss, ms);
const UNIVERSE = [{ id: 'BTCUSDT', base: 'BTC', binance_perp: 'BTCUSDT', bybit_linear: 'BTCUSDT', okx_swap: 'BTC-USDT-SWAP' }];

async function replay(source: 'live' | 'backfill') {
  const store = new MemoryLiqStore();
  store.coins = [{ symbol: 'BTCUSDT', base: 'BTC' }];
  store.params = { perCoin: { BTCUSDT: { enabled: true, thresholdUsd: 5e6 } } };
  store.tape = fixture.rows.map(([offset, venue, symbol, usd]) => ({ venue, symbol, side: 'short' as const, ts: fixture.baseMs + offset, usd }));
  const loop = new LiqAlertLoop({ store, universe: UNIVERSE, webBaseUrl: '', build: 'dev', source, send: async () => true });
  for (let t = at(14, 36); t <= at(15, 50); t += 10_000) await loop.tick(t);
  return store;
}

describe('IB-BUG-046 scene under IB-143 (BTC shorts 2026-11-04, box tape)', () => {
  it('the fixture is the box tape it says it is', () => {
    expect(fixture.rows).toHaveLength(1951);
    expect(fixture.baseMs).toBe(at(14, 30));
  });

  it('the same two crossings as IB-122 (14:41:07.055, 15:13:12.467), each opening its own event; no per-coin continuation', async () => {
    const store = await replay('backfill');
    expect(store.alerts.filter((a) => a.event === 'alert').map((a) => a.atMs)).toEqual([at(14, 41, 7, 55), at(15, 13, 12, 467)]);
    expect(store.alerts.filter((a) => a.event === 'event').map((a) => (a.details as LiqEventDetails).eventAt)).toEqual([at(14, 41, 7, 55), at(15, 13, 12, 467)]);
    expect(store.alerts.filter((a) => a.event === 'continuing')).toEqual([]);
  });

  it('every continuation is dated at or after its first message, and at or after its T0', async () => {
    const store = await replay('backfill');
    const conts = store.alerts.filter((a) => a.event === 'event_continuing');
    for (const c of conts) {
      const d = c.details as LiqEventContinuingDetails;
      const first = store.alerts.find((a) => a.id === d.firstMessageId);
      expect(first).toBeDefined();
      expect(c.atMs).toBeGreaterThanOrEqual(first?.atMs ?? Infinity);
      expect(c.atMs).toBeGreaterThanOrEqual(d.eventAt);
      expect(d.closedAt).toBe(c.atMs);
    }
  });

  it('pinned outcome: S, settled and the continuation of each event', async () => {
    const store = await replay('backfill');
    const rows = store.alerts.filter((a) => a.event === 'event' || a.event === 'event_continuing')
      .map((a) => [a.event, new Date(a.atMs).toISOString(), (a.details as { settled?: string }).settled ?? (a.details as LiqEventContinuingDetails).closedBy,
        Math.round((a.details as LiqEventDetails).totalUsd / 1e5) / 10, (a.details as { news?: boolean }).news ?? null]);
    expect(rows).toEqual(PINNED);
  });
});

/**
 * 14:41 event: still printing at the cap (first message 14:44:07, $12.5M), closed 85 s later with $3.4M more —
 * under a threshold, so journalled, not sent. 15:13 event: settled after 97 s, $27.8M in one message (IB-122 had
 * sent $15.5M at the crossing, and a «продолжается» dated 4 min before it).
 */
const PINNED: unknown[] = [
  ['event', '2026-11-04T14:44:07.055Z', 'cap', 12.5, null],
  ['event_continuing', '2026-11-04T14:45:32.150Z', 'quiet', 15.9, false],
  ['event', '2026-11-04T15:14:49.576Z', 'quiet', 27.8, null],
];
