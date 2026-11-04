import { Logger } from '@nestjs/common';
import { evaluationLine, OiAlertsService } from '../../src/delivery/oi-alerts.service';
import type { EvaluationReport } from '../../src/alerts/oi-divergence/oi-alert-loop';

/**
 * IB-115 (dev-3's deploy finding): the loop logs ONE info line per evaluation, found or not. The deploy watch of
 * sha-b49cd48d4ab4 could not prove a single evaluation from the log, because an evaluation that found nothing
 * wrote nothing.
 */
const quiet: EvaluationReport = { tf: '15m', barClose: 1_793_750_400, journalled: 0, late: 0, sent: 0, skips: 0, coins: 5, controls: 0, nearMisses: 0, failed: [] };

describe('the OI alert loop’s evaluation line', () => {
  it('an evaluation that found nothing still says so, with the coin count', () => {
    expect(evaluationLine(quiet)).toBe('oi alerts 15m @2026-11-04T00:00:00.000Z: 5 coins, 0 found (late 0), sent 0, skipped 0, controls 0, near-misses 0');
  });

  it('a busy one names every count and the coins that failed', () => {
    expect(evaluationLine({ ...quiet, tf: '1h', journalled: 2, late: 1, sent: 1, skips: 1, controls: 3, nearMisses: 1, failed: ['TRXUSDT'] }))
      .toBe('oi alerts 1h @2026-11-04T00:00:00.000Z: 5 coins, 2 found (late 1), sent 1, skipped 1, controls 3, near-misses 1, failed TRXUSDT');
  });

  it('the service logs it for EVERY evaluation of a tick, including the empty ones', async () => {
    const lines: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => { lines.push(String(m)); });
    try {
      const service = Object.create(OiAlertsService.prototype) as OiAlertsService;
      Object.assign(service, {
        logger: new Logger('t'),
        loop: { tick: async () => [quiet, { ...quiet, tf: '1h' }] },
      });
      await service.tick(1_793_750_400_000 + 6 * 60_000);
      expect(lines).toEqual([evaluationLine(quiet), evaluationLine({ ...quiet, tf: '1h' })]);
    } finally {
      spy.mockRestore();
    }
  });
});
