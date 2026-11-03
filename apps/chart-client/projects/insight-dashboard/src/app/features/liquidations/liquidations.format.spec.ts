import type { WebLiquidationWindowStats } from '@trade-automation/contracts';
import {
  basisLine, escalation, formatRatio, formatUsd, hasRatio, leaning, sideShare,
} from './liquidations.format';

const side = (usd: number, ratio: number | null = null, median: number | null = null) => ({ usd, ratio, median });

const win = (over: Partial<WebLiquidationWindowStats> = {}): WebLiquidationWindowStats => ({
  window: '1h',
  events: 1,
  long: side(0),
  short: side(0),
  total: side(0),
  basis: { periodDays: 30, windowsInPeriod: 720, windowsObserved: 700, venues: ['bybit', 'okx'], unavailable: null },
  ...over,
});

describe('formatUsd', () => {
  it('is compact, because a card is read and not audited', () => {
    expect(formatUsd(1_234_567_890)).toBe('$1.2B');
    expect(formatUsd(1_234_567)).toBe('$1.2M');
    expect(formatUsd(847_000)).toBe('$847K');
    expect(formatUsd(12_400)).toBe('$12K');
    expect(formatUsd(432)).toBe('$432');
  });

  it('shows zero as zero rather than as nothing', () => {
    // A quiet window is a fact; a blank cell looks like a failed load.
    expect(formatUsd(0)).toBe('$0');
  });

  it('drops a trailing .0 instead of printing false precision', () => {
    expect(formatUsd(2_000_000)).toBe('$2M');
  });
});

describe('formatRatio', () => {
  it('prints a multiple with one decimal while it is small', () => {
    expect(formatRatio(2.44)).toBe('×2.4');
    expect(formatRatio(2)).toBe('×2');
    expect(formatRatio(51.2)).toBe('×51');
  });

  it('RETURNS NULL rather than a string for an absent ratio', () => {
    // The caller must branch, not print. A `null` reaching a template once rendered as "null".
    expect(formatRatio(null)).toBeNull();
  });
});

describe('escalation', () => {
  it('follows §12.1: < 1.5 calm, 1.5–3 elevated, ≥ 3 extreme', () => {
    expect(escalation(0.2)).toBe('calm');
    expect(escalation(1.5)).toBe('elevated');
    expect(escalation(3)).toBe('extreme');
  });

  it('A MISSING RATIO IS NOT A CALM ONE', () => {
    expect(escalation(null)).toBe('none');
  });
});

describe('leaning', () => {
  it('names the side taking the damage', () => {
    expect(leaning(win({ long: side(900), short: side(100) }))).toBe('longs');
    expect(leaning(win({ long: side(100), short: side(900) }))).toBe('shorts');
  });

  it('is quiet when nothing happened, rather than claiming a side', () => {
    expect(leaning(win())).toBe('quiet');
  });
});

describe('sideShare', () => {
  it('splits the bar by money', () => {
    expect(sideShare(win({ long: side(750), short: side(250) }))).toEqual({ long: 75, short: 25 });
  });

  it('splits an empty window evenly rather than dividing by zero', () => {
    expect(sideShare(win())).toEqual({ long: 50, short: 50 });
  });
});

describe('basisLine — what the figure is measured against', () => {
  it('REPORTS COVERAGE, not elapsed days', () => {
    // Tech Lead, 2026-10-07: the collectors write no uptime rows (IB-BUG-010), so elapsed time
    // claims observation we cannot prove. The sentence names observed windows out of total.
    const line = basisLine({ periodDays: 9.4, windowsInPeriod: 226, windowsObserved: 9, venues: [], unavailable: null }, '1h');
    expect(line.key).toBe('liq.norm.basis');
    expect(line.params).toMatchObject({ observed: 9, total: 226 });
    expect(JSON.stringify(line.params)).not.toContain('9.4'); // periodDays is not the claim
  });

  it('distinguishes too-little-history from an all-but-empty tape', () => {
    // One is temporary and the other is not, so they cannot share a sentence.
    const short = basisLine({ periodDays: 2, windowsInPeriod: 48, windowsObserved: 1, venues: [], unavailable: 'insufficient_history' }, '1h');
    const empty = basisLine({ periodDays: 30, windowsInPeriod: 720, windowsObserved: 3, venues: [], unavailable: 'no_norm' }, '1h');
    expect(short.key).toBe('liq.norm.noHistory');
    expect(empty.key).toBe('liq.norm.noNorm');
    expect(empty.params).toMatchObject({ observed: 3, total: 720 });
  });
});

describe('hasRatio', () => {
  it('answers the question the template actually asks', () => {
    expect(hasRatio(side(1, 2))).toBe(true);
    expect(hasRatio(side(1, null))).toBe(false);
    expect(hasRatio(side(0, 0))).toBe(true); // a measured zero is a ratio
  });
});
