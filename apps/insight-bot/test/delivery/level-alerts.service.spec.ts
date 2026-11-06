import type { WebCandle } from '@trade-automation/contracts';
import { LEVEL_LOOP_ON_LINE, candlesLevelVenue, levelSeedLine, levelTickLine } from '../../src/delivery/level-alerts.service';
import type { LevelTickReport } from '../../src/alerts/levels/level-alert-loop';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * IB-126 — the service's seams: the venue port over CandlesService (closed 15m bars at the exact limit; 70 daily bars
 * ending with today's forming one, a weight-1 tail), and the heartbeat line the deploy watch parses. The line shapes
 * are written to test/fixtures/level-heartbeat-lines.txt, which infra/insight-bot/scripts/deploy-watch.test.sh parses.
 */
const DAY = 86_400_000;
const report = (over: Partial<LevelTickReport> = {}): LevelTickReport => ({
  atMs: Date.UTC(2026, 10, 6, 3, 15, 5), dueBarMs: Date.UTC(2026, 10, 6, 3, 0), coins: 5, bars: 5, calls: 5, weight: 5,
  alerts: 0, late: 0, sent: 0, controls: 1, seeded: [], pendingSeed: 0, failed: [], ...over,
});

describe('IB-126 level alerts service', () => {
  it('bars15m: CandlesService.closedKlines on 15m at exactly the limit, times to epoch ms', async () => {
    const calls: unknown[] = [];
    const candle: WebCandle = { time: 1_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 9 };
    const venue = candlesLevelVenue({
      closedKlines: async (...a: unknown[]) => { calls.push(a); return [candle]; },
      candles: async (...a: unknown[]) => { calls.push(a); return []; },
    } as never);
    expect(await venue.bars15m('BTCUSDT', 5_000, 2)).toEqual([{ openMs: 1_000_000, open: 1, high: 2, low: 0.5, close: 1.5 }]);
    const day = Date.UTC(2026, 10, 6);
    await venue.daily('BTCUSDT', day);
    expect(calls).toEqual([['BTCUSDT', '15m', 5_000, 2], ['perp', 'BTCUSDT', '1d', day - 69 * DAY, day + DAY]]);
  });

  it('the heartbeat line names the CLOSE it covers; failures and seeds are on it', () => {
    expect(levelTickLine(report())).toBe('level alerts @2026-11-06T03:15:00.000Z: 5 coins, 5 bars, calls 5 (weight 5), alerts 0 (late 0), sent 0, controls 1, seeded -, pending 0');
    expect(levelTickLine(report({ seeded: ['ETHUSDT'], pendingSeed: 3, failed: ['SOLUSDT'] }))).toMatch(/seeded ETHUSDT, pending 3, failed SOLUSDT$/);
    expect(levelSeedLine(report({ seeded: ['ETHUSDT'], calls: 2, weight: 15, pendingSeed: 3 }))).toBe('level alerts seed @2026-11-06T03:15:05.000Z: seeded ETHUSDT, calls 2 (weight 15), pending 3');
  });

  it('pins the line shapes for the deploy watch', () => {
    const lines = [LEVEL_LOOP_ON_LINE, levelTickLine(report()), levelTickLine(report({ failed: ['BTCUSDT'], bars: 0 })), levelSeedLine(report({ seeded: ['BTCUSDT'] }))];
    writeFileSync(join(__dirname, '../fixtures/level-heartbeat-lines.txt'), `${lines.join('\n')}\n`);
    expect(LEVEL_LOOP_ON_LINE).toBe('level alerts loop on: tick 60 s, a line per 15m close');
  });
});
