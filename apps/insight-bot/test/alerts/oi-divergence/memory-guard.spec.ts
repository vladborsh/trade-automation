import { MEM_ABORT_AFTER_MS, MEM_FLOOR_MB, MEM_RECHECK_MS, MEM_START_FLOOR_MB, MemoryGuard, memoryDecision, parseMemAvailableMb, startGateDecision } from '../../../src/alerts/oi-divergence/backfill/memory-guard';

/** IB-116 (TL memory condition): the history run steps back when the box's MemAvailable is low. */
describe('memoryDecision', () => {
  it('go at or above 120 MB; wait below; abort after 5 min of waiting; unknown memory is go', () => {
    expect(memoryDecision(MEM_FLOOR_MB, null, 0)).toBe('go'); // on the floor passes
    expect(memoryDecision(MEM_FLOOR_MB - 1, null, 0)).toBe('wait');
    expect(memoryDecision(80, 1_000, 1_000 + MEM_ABORT_AFTER_MS - 1)).toBe('wait');
    expect(memoryDecision(80, 1_000, 1_000 + MEM_ABORT_AFTER_MS)).toBe('abort');
    expect(memoryDecision(200, 1_000, 1_000 + 10 * MEM_ABORT_AFTER_MS)).toBe('go'); // recovered: go, however long it waited
    expect(memoryDecision(null, 1_000, 1_000 + 10 * MEM_ABORT_AFTER_MS)).toBe('go');
  });
});

describe('startGateDecision (TL ruling: 170 MB to begin a phase)', () => {
  it('170 goes, 169 is refused; unknown memory goes', () => {
    expect(MEM_START_FLOOR_MB).toBe(170);
    expect(startGateDecision(170)).toBe('go');
    expect(startGateDecision(169)).toBe('refuse');
    expect(startGateDecision(null)).toBe('go');
  });
});

describe('parseMemAvailableMb', () => {
  it('reads the kB line of /proc/meminfo as whole MB; absent or malformed → null', () => {
    const meminfo = 'MemTotal:         936212 kB\nMemFree:           50000 kB\nMemAvailable:     186880 kB\nBuffers:            1000 kB\n';
    expect(parseMemAvailableMb(meminfo)).toBe(182);
    expect(parseMemAvailableMb('MemTotal: 936212 kB\n')).toBeNull();
    expect(parseMemAvailableMb('MemAvailable: lots\n')).toBeNull();
  });
});

describe('MemoryGuard', () => {
  const guard = (readings: Array<number | null>) => {
    let t = 0;
    const lines: string[] = [];
    const slept: number[] = [];
    let i = 0;
    const g = new MemoryGuard({
      availableMb: async () => readings[Math.min(i++, readings.length - 1)] ?? null,
      now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; }, log: (l) => lines.push(l),
    });
    return { g, lines, slept, reads: () => i, advance: (ms: number) => { t += ms; } };
  };

  it('plenty of memory: one read, no wait, no line', async () => {
    const x = guard([300]);
    await x.g.check('BTCUSDT 15m');
    expect([x.reads(), x.slept, x.lines]).toEqual([1, [], []]);
    expect(x.g.minSeenMb).toBe(300);
  });

  it('low, then recovered: pauses with a line, re-reads every 10 s, resumes with a line', async () => {
    const x = guard([90, 100, 130]);
    await x.g.check('ETHUSDT 1h');
    expect(x.slept).toEqual([MEM_RECHECK_MS, MEM_RECHECK_MS]);
    expect(x.lines).toEqual([
      'memory guard: MemAvailable 90 MB < 120 MB — pausing before ETHUSDT 1h',
      'memory guard: 130 MB available, resuming (ETHUSDT 1h)',
    ]);
    expect(x.g.minSeenMb).toBe(90);
  });

  it('low for 5 minutes: aborts, saying a rerun continues', async () => {
    const x = guard([80]);
    await expect(x.g.check('SOLUSDT 4h')).rejects.toThrow(/MemAvailable 80 MB < 120 MB for 5 min — aborting before SOLUSDT 4h; a rerun continues/);
    expect(x.slept).toHaveLength(MEM_ABORT_AFTER_MS / MEM_RECHECK_MS);
  });

  it('every30s: no read within 30 s of the last check, a read after', async () => {
    const x = guard([300]);
    await x.g.check('first');
    x.advance(29_999);
    await x.g.every30s('paths');
    expect(x.reads()).toBe(1);
    x.advance(1);
    await x.g.every30s('paths');
    expect(x.reads()).toBe(2);
  });

  it('unreadable memory (a Mac slot): says so once and lets the run go', async () => {
    const x = guard([null]);
    await x.g.check('a');
    await x.g.check('b');
    expect(x.lines).toEqual(['memory guard: MemAvailable unreadable (no /proc/meminfo) — not guarding']);
    expect(x.g.minSeenMb).toBeNull();
  });

  it('gate: refuses a phase below 170 MB without waiting, and starts one at 170 with a line; the reading counts toward the minimum', async () => {
    const low = guard([169]);
    await expect(low.g.gate('path measuring')).rejects.toThrow(/MemAvailable 169 MB < 170 MB — not starting path measuring/);
    expect(low.slept).toEqual([]);
    expect(low.g.minSeenMb).toBe(169);
    const ok = guard([170]);
    await ok.g.gate('the replay');
    expect(ok.lines).toEqual(['memory gate: 170 MB available — starting the replay']);
  });
});
