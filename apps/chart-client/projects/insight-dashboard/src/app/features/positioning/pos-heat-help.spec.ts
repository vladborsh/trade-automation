import { WEB_POSITIONING_SIGNALS } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { HEAT_HELP_LEVELS, SIGNAL_HELP, SIGNAL_HELP_IS_EXHAUSTIVE } from './pos-heat-help';
import { heatOf } from './pos-layout';

describe('heat-table help data (IB-121)', () => {
  it('explains every signal the rules can emit, each exactly once (the compile-time check, restated)', () => {
    expect(SIGNAL_HELP_IS_EXHAUSTIVE).toBe(true);
    const named = SIGNAL_HELP.flatMap((e) => [...e.signals]);
    expect(new Set(named).size).toBe(named.length);
    expect([...named].sort()).toEqual([...WEB_POSITIONING_SIGNALS].sort());
  });

  it('also explains the empty signal cell', () => {
    expect(SIGNAL_HELP.at(-1)).toMatchObject({ signals: [], label: 'positioning.help.signal.empty' });
  });

  it('«реже 1 из 4 / 10 / 100» are heatOf\'s thresholds, and the hatch is a missing rarity', () => {
    expect(HEAT_HELP_LEVELS.map((l) => l.heat)).toEqual(['notable', 'unusual', 'extreme', 'none']);
    expect([heatOf(1 - 1 / 4), heatOf(1 - 1 / 10), heatOf(1 - 1 / 100), heatOf(null)]).toEqual(['notable', 'unusual', 'extreme', 'none']);
    // just under each boundary is the level below
    expect([heatOf(0.7499), heatOf(0.8999), heatOf(0.9899)]).toEqual(['typical', 'notable', 'unusual']);
  });
});
