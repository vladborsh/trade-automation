import { fundingStep, type FundingSideState, type FundingStepEvent } from '../../../src/alerts/funding/funding-state';

/**
 * IB-124 (F4, F5, F7) — one side's state machine over a scripted run of 5-minute checks. Each script entry is one
 * check: `x` = this side is extreme, `.` = normal with the side's own sign, `-` = normal with the OPPOSITE sign.
 */
const MIN = 60_000;
const H = 60 * MIN;
const STEP = 5 * MIN;
const PARAMS = { minEpisodeHours: 24, flipWithinHours: 72 };

function run(script: string, opts: { start?: number; state?: FundingSideState | null; params?: typeof PARAMS } = {}) {
  let state = opts.state ?? null;
  const events: Array<FundingStepEvent & { at: number }> = [];
  let at = opts.start ?? 0;
  for (const c of script) {
    if (c === ' ') continue;
    const r = fundingStep(state, 'high', at, c === 'x', c === '-' ? -0.0001 : 0.0001, opts.params ?? PARAMS);
    state = r.state;
    if (r.event) events.push({ ...r.event, at });
    at += STEP;
  }
  return { state: state as FundingSideState, events, at };
}
/** `n` copies of a check. */
const rep = (c: string, n: number): string => c.repeat(n);
const HOURS = (h: number): number => (h * H) / STEP;

describe('IB-124 funding state machine (F4, F5, F7)', () => {
  it('F4: one enter at the first extreme check, none while it stays extreme', () => {
    const { events, state } = run('..xxxxxx');
    expect(events).toEqual([{ kind: 'enter', episodeStartMs: 2 * STEP, at: 2 * STEP }]);
    expect(state).toMatchObject({ zone: 'extreme', since: 2 * STEP });
  });

  it('F4 hysteresis: two checks outside and back is the same episode; three re-arm, and the next entry alerts again', () => {
    expect(run('x..xx..x').events.map((e) => e.kind)).toEqual(['enter']);
    const r = run('x...x');
    expect(r.events.map((e) => [e.kind, e.at])).toEqual([['enter', 0], ['enter', 4 * STEP]]);
  });

  it('F4: the episode ends at the FIRST check of the re-arming streak (15 min of checks)', () => {
    const { state } = run(`x${rep('x', 10)}...`);
    expect(state).toMatchObject({ zone: 'normal', episodeStart: 0, episodeEnd: 11 * STEP, outChecks: 0 });
  });

  it('F5: after an episode of ≥ 24 h, three opposite-sign checks give ONE flip, at the first of them', () => {
    const ep = rep('x', HOURS(24) + 1); // 24 h 5 min of extreme checks
    const r = run(`${ep}...${rep('.', 5)}---${rep('-', 30)}`);
    const flips = r.events.filter((e) => e.kind === 'flip');
    expect(flips).toHaveLength(1);
    const end = (HOURS(24) + 1) * STEP;
    expect(flips[0]).toMatchObject({ episodeStartMs: 0, episodeEndMs: end, flipSinceMs: end + 8 * STEP, at: end + 10 * STEP });
    expect((flips[0] as { episodeHours: number }).episodeHours).toBeCloseTo(24 + 5 / 60, 9);
  });

  it('F5: a flip needs the sign held for 3 checks: two, a break, then three counts from the second run', () => {
    const ep = rep('x', HOURS(25));
    const end = HOURS(25) * STEP;
    const r = run(`${ep}...--.---`);
    expect(r.events.filter((e) => e.kind === 'flip').map((e) => (e as { flipSinceMs: number }).flipSinceMs)).toEqual([end + 6 * STEP]);
  });

  it('F5: no flip after an episode SHORTER than 24 h (23 h 55 min), however long the opposite sign holds', () => {
    const r = run(`${rep('x', HOURS(24) - 1)}...${rep('-', 20)}`);
    expect(r.events.map((e) => e.kind)).toEqual(['enter']);
  });

  it('F5: a flip that starts after 72 h of the episode end is not a flip; one starting at exactly 72 h is', () => {
    const ep = rep('x', HOURS(24));
    const late = run(`${ep}...${rep('.', HOURS(72) - 2)}---`); // first opposite check at end + 72 h + 5 min
    expect(late.events.map((e) => e.kind)).toEqual(['enter']);
    const edge = run(`${ep}...${rep('.', HOURS(72) - 3)}---`); // first opposite check at end + 72 h exactly
    expect(edge.events.map((e) => e.kind)).toEqual(['enter', 'flip']);
  });

  it('F5: exactly one flip per episode, even when the sign goes back and flips again', () => {
    const r = run(`${rep('x', HOURS(30))}...---...---...---`);
    expect(r.events.filter((e) => e.kind === 'flip')).toHaveLength(1);
  });

  it('F5: the opposite run may begin inside the re-arming streak; it still starts at or after the episode end', () => {
    const r = run(`${rep('x', HOURS(24))}---`);
    const flip = r.events.find((e) => e.kind === 'flip') as { flipSinceMs: number; episodeEndMs: number };
    expect(flip.flipSinceMs).toBe(flip.episodeEndMs);
  });

  it('F5: a second ≥ 24 h episode gets its own flip', () => {
    const r = run(`${rep('x', HOURS(24))}---${rep('x', HOURS(24))}---`);
    expect(r.events.map((e) => e.kind)).toEqual(['enter', 'flip', 'enter', 'flip']);
  });

  it('F5: a zero rate is no sign at all: it breaks an opposite run and never starts one', () => {
    const ep = rep('x', HOURS(24));
    let s = run(`${ep}...`).state;
    let at = (HOURS(24) + 3) * STEP;
    for (const r of [-0.0001, -0.0001, 0, -0.0001, -0.0001]) {
      const step = fundingStep(s, 'high', at, false, r, PARAMS);
      expect(step.event).toBeNull();
      s = step.state;
      at += STEP;
    }
    expect(fundingStep({ ...s, oppChecks: 0, oppSince: null }, 'high', at, false, 0, PARAMS).state.oppChecks).toBe(0);
  });

  it('F5: 24 and 72 are parameters', () => {
    const r = run(`${rep('x', HOURS(2))}...---`, { params: { minEpisodeHours: 2, flipWithinHours: 1 } });
    expect(r.events.map((e) => e.kind)).toEqual(['enter', 'flip']);
  });

  it('F7: checks more than 15 min apart are not in a row: the re-arming streak restarts, the episode is kept (no second enter)', () => {
    const a = run('xx..');
    expect(a.state.outChecks).toBe(2);
    // the process was down 20 min; the next check is outside: streak 1, not 3
    const b = run('.', { state: a.state, start: a.at + 20 * MIN });
    expect(b.state).toMatchObject({ zone: 'extreme', outChecks: 1, since: 0 });
    // and a still-extreme check after downtime is the same episode
    const c = run('x', { state: a.state, start: a.at + 60 * MIN });
    expect(c.events).toEqual([]);
  });

  it('F6: a restart mid-episode resumes from the stored state: no second enter, the streak goes on', () => {
    const before = run('xxxx.');
    const stored: FundingSideState = JSON.parse(JSON.stringify(before.state));
    const after = run('x..', { state: stored, start: before.at });
    expect(after.events).toEqual([]);
    expect(after.state).toMatchObject({ zone: 'extreme', since: 0, outChecks: 2 });
  });
});
