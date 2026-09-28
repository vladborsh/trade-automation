import type { WebMarketCapDay } from '@trade-automation/contracts';
import {
  BTC_COLOUR, btcShareLine, dominanceLine, fearGreedBand, fearGreedLine, gaugeAngle, gaugePoint, linePoints, polyline, shareLegend, stackedBands,
} from './market.adapter';

const day = (d: string, shares: Record<string, number | null>): WebMarketCapDay => ({
  day: d,
  totalUsd: 1,
  coinsCounted: Object.values(shares).filter((s) => s !== null).length,
  coins: Object.entries(shares).map(([coin, share]) => ({ coin, capUsd: share, share })),
  btcShare: shares['bitcoin'] ?? null,
});

describe('the Fear & Greed dial', () => {
  it('maps 0..100 across the 180° arc', () => {
    expect(gaugeAngle(0)).toBe(-90);
    expect(gaugeAngle(50)).toBe(0);
    expect(gaugeAngle(100)).toBe(90);
  });

  it('clamps a value the venue could never send rather than swinging off the dial', () => {
    expect(gaugeAngle(-20)).toBe(-90);
    expect(gaugeAngle(140)).toBe(90);
    expect(gaugePoint(140)).toEqual(gaugePoint(100));
  });

  it('bands split at the venue’s own boundaries', () => {
    expect(fearGreedBand(0).key).toBe('market.fg.extremeFear');
    expect(fearGreedBand(24).key).toBe('market.fg.extremeFear');
    expect(fearGreedBand(25).key).toBe('market.fg.fear');
    expect(fearGreedBand(54).key).toBe('market.fg.neutral');
    expect(fearGreedBand(75).key).toBe('market.fg.extremeGreed');
  });

  it('the history line uses the fixed 0..100 scale, not the window’s min and max', () => {
    // three flat-ish values would fill the box if scaled to themselves; on a 0..100 dial they sit low
    const points = [40, 41, 42].map((value, i) => ({ day: `2026-09-0${i + 1}`, value, classification: 'Fear' }));
    const ys = fearGreedLine(points, 100, 40).split(' ').map((p) => Number(p.split(',')[1]));
    expect(ys.every((y) => y > 20 && y < 28)).toBe(true); // ~60 % down the box, where 40/100 belongs
  });
});

describe('lines', () => {
  it('a single point draws nothing — a dot reads as a trend', () => {
    expect(linePoints([5])).toEqual([]);
    expect(polyline([5])).toBe('');
  });

  it('a flat series runs down the middle rather than dividing by zero', () => {
    expect(linePoints([7, 7, 7], 100, 40).every((p) => p.y === 20)).toBe(true);
  });

  it('holes break the line instead of being interpolated over', () => {
    const points = linePoints([1, null, 3], 100, 40);
    expect(points.map((p) => p.x)).toEqual([0, 100]); // the middle day contributes no vertex
  });

  it('dominance reads btcPct and keeps its nulls', () => {
    const at = (ts: number, btcPct: number | null) => ({ ts, totalUsd: 1, btcPct, ethPct: null });
    expect(dominanceLine([at(1, 50), at(2, null), at(3, 60)], 100, 40).split(' ')).toHaveLength(2);
  });
});

describe('the stacked shares', () => {
  const days = [
    day('2026-09-01', { bitcoin: 0.5, ethereum: 0.3, solana: 0.2 }),
    day('2026-09-02', { bitcoin: 0.6, ethereum: 0.25, solana: 0.15 }),
  ];

  it('is one band per coin, in the order given, BTC in its own colour', () => {
    const bands = stackedBands(days);
    expect(bands.map((b) => b.coin)).toEqual(['bitcoin', 'ethereum', 'solana']);
    expect(bands[0].colour).toBe(BTC_COLOUR);
    expect(bands[1].colour).not.toBe(BTC_COLOUR);
    expect(bands.every((b) => b.path.startsWith('M ') && b.path.endsWith('Z'))).toBe(true);
  });

  it('stacks: each band starts where the one below ended, and the top band reaches the ceiling', () => {
    const [btc, eth] = stackedBands([day('2026-09-01', { bitcoin: 0.5, ethereum: 0.5 }), day('2026-09-02', { bitcoin: 0.5, ethereum: 0.5 })], 100, 40);
    expect(btc.path).toContain('0 20'); // BTC's top edge at half height
    expect(eth.path).toContain('0 0'); // ETH stacked on top, reaching the ceiling
  });

  it('a day with nothing collected leaves a gap rather than a straight line through it', () => {
    const withHole = [days[0], day('2026-09-02', { bitcoin: null, ethereum: null, solana: null }), days[1]];
    const btc = stackedBands(withHole)[0];
    expect(btc.path.split('L').length).toBeLessThan(stackedBands([days[0], days[1], days[1]])[0].path.split('L').length);
  });

  it('fewer than two days draws nothing at all', () => {
    expect(stackedBands([days[0]])).toEqual([]);
    expect(btcShareLine([days[0]])).toBe('');
  });

  it('the legend is the newest day, largest share first, coloured to match its band', () => {
    const legend = shareLegend(days);
    expect(legend.map((l) => l.coin)).toEqual(['bitcoin', 'ethereum', 'solana']);
    expect(legend[0].colour).toBe(BTC_COLOUR);
    expect(legend[0].share).toBe(0.6);
  });

  it('the BTC share line is of Σ top-20 — the field the server derived, not /global dominance', () => {
    expect(btcShareLine(days, 100, 40)).toBe('0,40 100,0'); // 0.5 -> 0.6 over its own min/max
  });
});
