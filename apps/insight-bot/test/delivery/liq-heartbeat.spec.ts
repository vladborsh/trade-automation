import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { LiqTickReport } from '../../src/alerts/liquidations/liq-alert-loop';
import { LiqAlertsService } from '../../src/delivery/liq-alerts.service';
import { LiqHeartbeat, LIQ_LOOP_ON_LINE } from '../../src/delivery/liq-heartbeat';

/**
 * IB-BUG-044 (dev-3's deploy batch 2, item 48): the liq loop logged only when it journalled something, so a
 * dead loop looked exactly like a quiet market. The heartbeat: one line on the first completed tick of every
 * 15-min UTC slot, the boot tick included; nothing else on a quiet tick. The deploy watch's
 * `liq_loop_missing` owes these lines — its test parses the same fixture file.
 */
const S = 1_000;
const MIN = 60 * S;
const at = (h: number, m: number, s = 0, ms = 0) => Date.UTC(2026, 10, 5, h, m, s, ms);
const quiet = (toMs: number, extra: Partial<LiqTickReport> = {}): LiqTickReport => ({
  fromMs: toMs - 60 * S, toMs, coins: 5, alerts: 0, events: 0, continuations: 0, late: 0, sent: 0, controls: 0, reads: 5, maxPrints: 40, prints: 40, failed: [], ...extra,
});
const FIXTURE = readFileSync(join(__dirname, '../fixtures/liq-heartbeat-lines.txt'), 'utf8').trimEnd().split('\n');

/** The service with a fake loop: `tick` answers from `answer(nowMs)`; every logged line is collected. */
function harness(answer: (nowMs: number) => LiqTickReport | null | Error, lagMs = 100) {
  const lines: string[] = [];
  const spies = [
    jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => { lines.push(String(m)); }),
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
  ];
  const service = Object.create(LiqAlertsService.prototype) as LiqAlertsService;
  let last = 0;
  Object.assign(service, {
    logger: new Logger('t'),
    heartbeat: new LiqHeartbeat(),
    now: () => last + lagMs,
    loop: { tick: async (nowMs: number) => { last = nowMs; const a = answer(nowMs); if (a instanceof Error) throw a; return a; } },
  });
  return { service, lines, beats: () => lines.filter((l) => l.startsWith('liq alerts heartbeat')), restore: () => spies.forEach((s) => s.mockRestore()) };
}

async function every30s(service: LiqAlertsService, fromMs: number, toMs: number) {
  for (let t = fromMs; t <= toMs; t += 30 * S) await service.tick(t);
}

describe('the liq loop heartbeat (IB-BUG-044)', () => {
  it('boot at 14:13:13, 30-s ticks to 15:00:13: one line at boot (slot 14:00), then one per slot — 14:15, 14:30, 14:45, 15:00 — and nothing else', async () => {
    const h = harness((t) => quiet(t));
    try {
      await every30s(h.service, at(14, 13, 13), at(15, 0, 13));
      expect(h.lines).toEqual(h.beats());
      expect(h.beats().map((l) => l.slice(0, 46))).toEqual([
        'liq alerts heartbeat @2026-11-05T14:00:00.000Z', 'liq alerts heartbeat @2026-11-05T14:15:00.000Z',
        'liq alerts heartbeat @2026-11-05T14:30:00.000Z', 'liq alerts heartbeat @2026-11-05T14:45:00.000Z',
        'liq alerts heartbeat @2026-11-05T15:00:00.000Z',
      ]);
      // boot: 1 tick; 14:13:43 … 14:15:13: 4; 14:15:43 … 14:30:13: 30 (a slot's worth)
      expect(h.beats().map((l) => Number(/: (\d+) ticks/.exec(l)?.[1]))).toEqual([1, 4, 30, 30, 30]);
    } finally { h.restore(); }
  });

  it('the slot boundary: a tick at 14:14:59.999 adds to 14:00, the tick at 14:15:00.000 opens 14:15', async () => {
    const h = harness((t) => quiet(t));
    try {
      await h.service.tick(at(14, 13, 13));
      await h.service.tick(at(14, 14, 59, 999));
      expect(h.beats()).toHaveLength(1);
      await h.service.tick(at(14, 15));
      expect(h.beats()).toHaveLength(2);
      expect(h.beats()[1]).toMatch(/^liq alerts heartbeat @2026-11-05T14:15:00\.000Z: 2 ticks/);
    } finally { h.restore(); }
  });

  it('a loop whose every tick throws (or is still running) never beats — silence is what the watch alarms on', async () => {
    const thrown = harness(() => new Error('db down'));
    const stuck = harness(() => null);
    try {
      await every30s(thrown.service, at(14, 13, 13), at(15, 0, 13));
      await every30s(stuck.service, at(14, 13, 13), at(15, 0, 13));
      expect(thrown.beats()).toEqual([]);
      expect(stuck.beats()).toEqual([]);
    } finally { thrown.restore(); stuck.restore(); }
  });

  it('a busy tick still gets its own line AND counts into the heartbeat', async () => {
    const h = harness((t) => quiet(t, t === at(14, 14) ? { alerts: 1, controls: 2 } : {}));
    try {
      await h.service.tick(at(14, 13, 13));
      await h.service.tick(at(14, 14));
      await h.service.tick(at(14, 15));
      expect(h.lines.filter((l) => l.startsWith('liq alerts ('))).toHaveLength(1);
      expect(h.beats()[1]).toContain('2 ticks, 80 prints read, 3 journalled');
    } finally { h.restore(); }
  });

  it('the line shapes are the committed fixture the deploy watch parses (infra/insight-bot/scripts/deploy-watch.test.sh)', async () => {
    let n = 0;
    const answers: Array<LiqTickReport | null | Error> = [
      quiet(at(14, 13, 13)),
      quiet(at(14, 13, 43), { alerts: 1, continuations: 1 }), new Error('db down'), null,
      quiet(at(14, 14, 43), { controls: 1 }),
      quiet(at(14, 15, 13)),
    ];
    const lags = [100, 2_500, 0, 0, 900, 1_000];
    const h = harness(() => answers[n] as LiqTickReport | null | Error);
    try {
      Object.assign(h.service, { now: () => answers[n] && !(answers[n] instanceof Error) ? (answers[n] as LiqTickReport).toMs + (lags[n] ?? 0) : 0 });
      for (; n < answers.length; n++) {
        const a = answers[n];
        await h.service.tick(a && !(a instanceof Error) ? a.toMs : at(14, 14, 13 + n));
      }
      expect([LIQ_LOOP_ON_LINE, ...h.beats()]).toEqual(FIXTURE);
    } finally { h.restore(); }
  });

  it('bootstrap announces the loop (the watch checks heartbeats only for an image that says so) — and stays silent when the loop is off', () => {
    for (const enabled of [true, false]) {
      const lines: string[] = [];
      const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => { lines.push(String(m)); });
      const service = Object.create(LiqAlertsService.prototype) as LiqAlertsService;
      Object.assign(service, {
        logger: new Logger('t'), heartbeat: new LiqHeartbeat(), now: () => 0, timer: null,
        config: { env: { get: (k: string) => (k === 'LIQ_ALERTS_LOOP_ENABLED' ? enabled : undefined) } },
        loop: { tick: async () => null },
      });
      try {
        service.onApplicationBootstrap();
        expect(lines).toEqual(enabled ? [LIQ_LOOP_ON_LINE] : []);
      } finally {
        service.onModuleDestroy();
        spy.mockRestore();
      }
    }
  });
});
