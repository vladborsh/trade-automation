import { collectorCoverage } from '../../src/web/collector-coverage';
import { clampDays } from '../../src/web/coverage.controller';
import type { Heartbeat } from '../../src/collectors/uptime/uptime-gap';

/**
 * IB-BUG-010 — what the coverage page and IB-038's ratio basis read.
 *
 * The property under test is that an uninstrumented stream and a fully-uncovered one do not look
 * alike. Both would render as a small number next to a stream name, and conflating them is the same
 * failure as IB-BUG-011's «все биржи» over 10 % of the money: not a crash, a confident wrong number.
 */

const T = (iso: string) => new Date(iso);
const WINDOW = { from: T('2026-09-28T00:00:00Z'), to: T('2026-09-29T00:00:00Z') }; // 24 h

const beat = (stream: string, over: Partial<Heartbeat> = {}): Heartbeat => ({
  stream,
  venue: stream.split(':')[0],
  market: 'perp',
  firstSeenAt: T('2026-09-01T00:00:00Z'),
  lastSeenAt: T('2026-09-29T00:00:00Z'),
  ...over,
});

describe('per-stream coverage', () => {
  it('reports covered and elapsed hours separately, so a consumer can divide by the right one', () => {
    const [row] = collectorCoverage(
      new Map([['bybit:allLiquidation', beat('bybit:allLiquidation')]]),
      [{ stream: 'bybit:allLiquidation', gapFrom: T('2026-09-28T06:00:00Z'), gapTo: T('2026-09-28T12:00:00Z') }],
      WINDOW,
    );
    expect(row.elapsedHours).toBe(24);
    expect(row.coveredHours).toBe(18);
    expect(row.outages).toBe(1);
  });

  it('counts only its OWN outages — one venue being down is not the other being down', () => {
    // the bug this prevents: filtering by nothing, so okx inherits bybit's outage and both read low
    const rows = collectorCoverage(
      new Map([
        ['bybit:allLiquidation', beat('bybit:allLiquidation')],
        ['okx:liquidation-orders', beat('okx:liquidation-orders')],
      ]),
      [{ stream: 'bybit:allLiquidation', gapFrom: T('2026-09-28T06:00:00Z'), gapTo: T('2026-09-28T12:00:00Z') }],
      WINDOW,
    );
    const byStream = Object.fromEntries(rows.map((r) => [r.stream, r]));
    expect(byStream['bybit:allLiquidation'].coveredHours).toBe(18);
    expect(byStream['bybit:allLiquidation'].outages).toBe(1);
    expect(byStream['okx:liquidation-orders'].coveredHours).toBe(24);
    expect(byStream['okx:liquidation-orders'].outages).toBe(0);
  });

  it('omits a stream with no heartbeat entirely rather than showing it as zero covered', () => {
    // binance's liquidation stream writes gap rows but no heartbeat. Rendering it at 0 covered
    // hours would assert it was never running, which is false — it is simply not instrumented for
    // this, and an absent row says that where a 0 would lie.
    const rows = collectorCoverage(
      new Map([['bybit:allLiquidation', beat('bybit:allLiquidation')]]),
      [{ stream: 'binance-perp:forceOrder', gapFrom: T('2026-09-28T06:00:00Z'), gapTo: T('2026-09-28T12:00:00Z') }],
      WINDOW,
    );
    expect(rows.map((r) => r.stream)).toEqual(['bybit:allLiquidation']);
    // and that foreign gap must not be subtracted from the stream that IS reported
    expect(rows[0].coveredHours).toBe(24);
  });

  it('clips elapsed to first liveness, so a stream started mid-window is not blamed for before it', () => {
    const [row] = collectorCoverage(
      new Map([['okx:liquidation-orders', beat('okx:liquidation-orders', { firstSeenAt: T('2026-09-28T18:00:00Z') })]]),
      [],
      WINDOW,
    );
    // 6 h of responsibility, all covered — not 24 h with 18 missing
    expect(row.elapsedHours).toBe(6);
    expect(row.coveredHours).toBe(6);
  });

  it('is empty when nothing is instrumented, rather than inventing rows', () => {
    expect(collectorCoverage(new Map(), [], WINDOW)).toEqual([]);
  });
});

describe('the coverage window', () => {
  it('defaults, clamps and never throws on a bad query string', () => {
    expect(clampDays(undefined)).toBe(30);
    expect(clampDays('7')).toBe(7);
    expect(clampDays('0')).toBe(30);
    expect(clampDays('-5')).toBe(30);
    expect(clampDays('abc')).toBe(30);
    expect(clampDays('100000')).toBe(365);
    expect(clampDays('7.9')).toBe(7);
  });
});
