import type { WebCollectorCoverage } from '@trade-automation/contracts';
import { basisState, collectorTotals, toCollectorViews } from './collector-rows';

/**
 * IB-BUG-010 — the collector-uptime display.
 *
 * The bar for this task was a spec that can fail. Each test here pins a number or an ordering that
 * a plausible wrong implementation gets differently: a percentage that divides by the wrong thing,
 * a zero window that renders as an outage, an average that lets a one-hour stream outvote a
 * month-long one.
 */

const row = (over: Partial<WebCollectorCoverage> = {}): WebCollectorCoverage => ({
  stream: 'bybit:allLiquidation',
  venue: 'bybit',
  coveredHours: 24,
  elapsedHours: 24,
  firstSeen: Date.UTC(2026, 8, 28),
  lastSeen: Date.UTC(2026, 9, 12),
  outages: 0,
  ...over,
});

describe('collector uptime rows', () => {
  it('shows covered as a percentage of elapsed, not of the window', () => {
    // 7.5 of 16 — the stream existed for 16 of the window's hours, so the honest figure is 47%,
    // not 31% (7.5/24). Dividing by the wrong denominator is the whole bug class this page exists
    // to expose, so it would be particularly bad to commit it here.
    const [view] = toCollectorViews([row({ coveredHours: 7.5, elapsedHours: 16 })]);
    expect(view.coveredLabel).toBe('47%');
    expect(view.coveredFraction).toBeCloseTo(0.46875, 5);
  });

  it('renders a stream with no elapsed time as unknown, not as zero covered', () => {
    // a stream registered a second ago has no fraction yet; '0%' would read as an outage
    const [view] = toCollectorViews([row({ coveredHours: 0, elapsedHours: 0 })]);
    expect(view.coveredLabel).toBe('—');
    expect(view.coveredFraction).toBeNull();
    expect(view.state).toBe('empty');
  });

  it('puts the worst stream first, because that is the row a reader needs', () => {
    const views = toCollectorViews([
      row({ stream: 'a:good', coveredHours: 24, elapsedHours: 24 }),
      row({ stream: 'b:bad', coveredHours: 2, elapsedHours: 24 }),
      row({ stream: 'c:middling', coveredHours: 22, elapsedHours: 24 }),
    ]);
    expect(views.map((v) => v.stream)).toEqual(['b:bad', 'c:middling', 'a:good']);
  });

  it('states the day coverage began, so a short basis is visible', () => {
    const [view] = toCollectorViews([row({ firstSeen: Date.UTC(2026, 9, 11, 13, 45) })]);
    expect(view.firstSeenLabel).toBe('2026-10-11');
  });

  it('says "—" rather than inventing a date for a stream that never ran', () => {
    const [view] = toCollectorViews([row({ firstSeen: null })]);
    expect(view.firstSeenLabel).toBe('—');
  });
});

describe('the basis totals', () => {
  it('sums hours rather than averaging percentages', () => {
    // one stream up for a month at 100%, one up for an hour at 0%. Averaging the two percentages
    // gives 50% and is nonsense; summing the hours gives 720 of 721, which is the truth.
    const totals = collectorTotals([
      row({ stream: 'a', coveredHours: 720, elapsedHours: 720 }),
      row({ stream: 'b', coveredHours: 0, elapsedHours: 1, outages: 1 }),
    ]);
    expect(totals.coveredHours).toBe(720);
    expect(totals.elapsedHours).toBe(721);
    expect(totals.streams).toBe(2);
    expect(totals.outages).toBe(1);
  });

  it('reproduces the measured insight_coord shape', () => {
    // the figure from the brief: 9 covered of 226 elapsed. A reader seeing this knows a ratio
    // built on 226 is understated roughly 25-fold.
    const totals = collectorTotals([row({ coveredHours: 9, elapsedHours: 226, outages: 1 })]);
    expect(totals.coveredHours).toBe(9);
    expect(totals.elapsedHours).toBe(226);
  });

  it('is zeroed, not NaN, when nothing is instrumented', () => {
    expect(collectorTotals([])).toEqual({ streams: 0, coveredHours: 0, elapsedHours: 0, outages: 0 });
  });
});

describe('IB-044 — whether a basis exists at all', () => {
  it('is NOT recorded when every stream has zero elapsed hours', () => {
    // the bug: a collector that predates IB-BUG-010 writes its first heartbeat at startup, so
    // first_seen_at is "now" and the window it is responsible for is zero wide. The old code then
    // rendered «покрыто 0 из 0 часов» — a measurement of nothing, stated as a measurement. Zero
    // covered out of zero elapsed is not 0 % coverage; it is the absence of a basis.
    expect(basisState({ streams: 2, elapsedHours: 0 })).toBe('not-recorded');
  });

  it('is NOT recorded when no stream is instrumented', () => {
    expect(basisState({ streams: 0, elapsedHours: 0 })).toBe('not-recorded');
  });

  it('IS recorded once there are elapsed hours — including when none of them were covered', () => {
    // this is the case that must NOT be swallowed by the fix. "We were responsible for 24 hours and
    // covered none" is a real and alarming measurement; collapsing it into "not recorded" would
    // hide an outage behind the same words used for "we never looked".
    expect(basisState({ streams: 1, elapsedHours: 24 })).toBe('recorded');
  });

  it('IS recorded for a partial window', () => {
    expect(basisState({ streams: 1, elapsedHours: 0.5 })).toBe('recorded');
  });
});
