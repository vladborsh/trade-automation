import { BinanceWeightTracker } from '../../src/venues/binance/binance-weight.tracker';
import type { Db } from '../../src/db/db.port';
import { GapReportService } from '../../src/ops/gap-report.service';
import type { TelegramSender } from '../../src/delivery/telegram-sender';

/**
 * IB-011 — the job around the pure builder: when it fires, and the ordering that makes the
 * stored row the Tester's evidence rather than Telegram.
 */

const config = { env: { get: () => '3' } } as never;

/** Captures the window each read is asked for; returns no rows, which is enough here. */
const fakeDb = () => {
  const windows: Array<[string, string]> = [];
  const db: Db = {
    query: async (sql: string, params?: readonly unknown[]) => {
      if (params && params.length >= 2 && params[0] instanceof Date) {
        windows.push([(params[0] as Date).toISOString(), (params[1] as Date).toISOString()]);
      }
      return [];
    },
    transaction: async (fn) => fn(db),
  };
  return { db, windows };
};

const senderSpy = () => {
  const sent: string[] = [];
  return { sent, sender: { send: async (text: string) => { sent.push(text); return true; } } as TelegramSender };
};

describe('GapReportService', () => {
  it('fires at 00:10 UTC for the PREVIOUS day, and only once for it', async () => {
    const { db } = fakeDb();
    const { sender } = senderSpy();
    const svc = new GapReportService(config, db, sender, new BinanceWeightTracker());

    expect(await svc.maybeRun(new Date('2026-09-28T00:05:00Z'))).toBeNull(); // too early
    expect(await svc.maybeRun(new Date('2026-09-28T01:10:00Z'))).toBeNull(); // wrong hour

    const report = await svc.maybeRun(new Date('2026-09-28T00:10:30Z'));
    expect(report?.day).toBe('2026-09-27');
    expect(await svc.maybeRun(new Date('2026-09-28T00:11:00Z'))).toBeNull(); // not twice
  });

  it('stores the report before sending it — Telegram must not cost a day of evidence', async () => {
    const order: string[] = [];
    const db: Db = {
      query: async (sql: string) => { if (sql.includes('gap_reports')) order.push('stored'); return []; },
      transaction: async (fn) => fn(db as never),
    };
    const sender = { send: async () => { order.push('sent'); return true; } } as unknown as TelegramSender;
    await new GapReportService(config, db, sender, new BinanceWeightTracker()).runForDay('2026-09-27');
    expect(order).toEqual(['stored', 'sent']);
  });

  it('a re-run DURING the day stops at "now": future minutes are not missing minutes', async () => {
    const { db, windows } = fakeDb();
    const { sender } = senderSpy();
    const svc = new GapReportService(config, db, sender, new BinanceWeightTracker());

    const noon = Date.parse('2026-09-28T12:00:00Z');
    await svc.runForDay('2026-09-28', noon);
    expect(windows.every(([, to]) => to === '2026-09-28T12:00:00.000Z')).toBe(true);

    windows.length = 0;
    await svc.runForDay('2026-09-27', noon); // a finished day is never clamped
    expect(windows.every(([, to]) => to === '2026-09-28T00:00:00.000Z')).toBe(true);
  });

  it('without a database it declines rather than reporting an empty day as clean', async () => {
    const { sent, sender } = senderSpy();
    expect(await new GapReportService(config, null, sender, new BinanceWeightTracker()).runForDay('2026-09-27')).toBeNull();
    expect(sent).toEqual([]);
  });
});
