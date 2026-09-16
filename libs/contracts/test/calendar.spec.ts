import { eventDayNY, eventWeekWindowNY, parseFeedValue } from '../src/calendar';

describe('eventDayNY', () => {
  it('returns the ET calendar day for an EDT (-04:00) instant', () => {
    // architecture/economic-calendar.md §1.2/§3.1 — Federal Funds Rate, 2026-09-16T14:00:00-04:00.
    const ms = Date.parse('2026-09-16T14:00:00-04:00');
    expect(eventDayNY(ms)).toBe('2026-09-16');
  });

  it('is DST-correct across the November fall-back boundary', () => {
    // 2026-11-01 02:00 America/New_York is the fall-back instant; before it EDT (-04:00), after EST (-05:00).
    const beforeFallBack = Date.parse('2026-11-01T00:30:00-04:00'); // still EDT, ET day 2026-11-01
    const afterFallBack = Date.parse('2026-11-01T01:30:00-05:00'); // already EST, same ET day 2026-11-01
    expect(eventDayNY(beforeFallBack)).toBe('2026-11-01');
    expect(eventDayNY(afterFallBack)).toBe('2026-11-01');

    const nextDayEst = Date.parse('2026-11-02T10:00:00-05:00');
    expect(eventDayNY(nextDayEst)).toBe('2026-11-02');
  });

  it('is DST-correct across the March spring-forward boundary', () => {
    const beforeSpringForward = Date.parse('2026-03-08T01:30:00-05:00'); // EST, ET day 2026-03-08
    const afterSpringForward = Date.parse('2026-03-08T03:30:00-04:00'); // EDT, same ET day 2026-03-08
    expect(eventDayNY(beforeSpringForward)).toBe('2026-03-08');
    expect(eventDayNY(afterSpringForward)).toBe('2026-03-08');
  });

  it('rolls to the next ET day just after midnight ET, regardless of UTC day', () => {
    // 2026-09-16T00:05:00-04:00 ET is 2026-09-16T04:05:00Z — same UTC day, ET day 09-16.
    const justAfterMidnight = Date.parse('2026-09-16T00:05:00-04:00');
    expect(eventDayNY(justAfterMidnight)).toBe('2026-09-16');
  });
});

describe('eventWeekWindowNY', () => {
  it('returns the Sun 00:00 -> Sat 24:00 ET window for the committed 2026-09-16 fixture week', () => {
    // architecture/economic-calendar.md §1.2 — first event Sun 2026-09-13T04:15-04:00, last Sat 2026-09-19T06:15-04:00.
    const midWeek = Date.parse('2026-09-16T14:00:00-04:00');
    const { from, to } = eventWeekWindowNY(midWeek);
    expect(new Date(from).toISOString()).toBe(new Date(Date.parse('2026-09-13T00:00:00-04:00')).toISOString());
    expect(new Date(to).toISOString()).toBe(new Date(Date.parse('2026-09-20T00:00:00-04:00')).toISOString());

    const firstEvent = Date.parse('2026-09-13T04:15:00-04:00');
    const lastEvent = Date.parse('2026-09-19T06:15:00-04:00');
    expect(firstEvent).toBeGreaterThanOrEqual(from);
    expect(lastEvent).toBeLessThan(to);
  });

  it('holds across the November DST change (window boundary spans EST/EDT)', () => {
    // 2026-11-01 is the fall-back Sunday; the window itself is still exactly one ET week.
    const midWeek = Date.parse('2026-11-04T12:00:00-05:00');
    const { from, to } = eventWeekWindowNY(midWeek);
    expect(new Date(from).toISOString()).toBe(new Date(Date.parse('2026-11-01T00:00:00-04:00')).toISOString());
    expect(new Date(to).toISOString()).toBe(new Date(Date.parse('2026-11-08T00:00:00-05:00')).toISOString());
  });

  it('holds across the March DST change', () => {
    const midWeek = Date.parse('2026-03-11T12:00:00-04:00');
    const { from, to } = eventWeekWindowNY(midWeek);
    expect(new Date(from).toISOString()).toBe(new Date(Date.parse('2026-03-08T00:00:00-05:00')).toISOString());
    expect(new Date(to).toISOString()).toBe(new Date(Date.parse('2026-03-15T00:00:00-04:00')).toISOString());
  });

  it('the next week window starts exactly where this one ends (no gap, no overlap)', () => {
    const week1 = eventWeekWindowNY(Date.parse('2026-09-16T14:00:00-04:00'));
    const week2 = eventWeekWindowNY(week1.to + 1000);
    expect(week2.from).toBe(week1.to);
  });
});

describe('parseFeedValue', () => {
  it.each([
    ['3.75%', 3.75],
    ['8.3K', 8300],
    ['480B', 4.8e11],
    ['-2.57B', -2.57e9],
    ['0.9%', 0.9],
    ['49B', 49e9],
    ['76.4%', 76.4],
  ])('%s -> %d', (raw, expected) => {
    expect(parseFeedValue(raw)).toBeCloseTo(expected);
  });

  it.each([
    ['3-0-6'], // vote split
    ['<1.25%'], // BoJ rate band
    ['3.65|1.3'], // bond-auction yield|bid-to-cover
    [''],
  ])('%s -> null', (raw) => {
    expect(parseFeedValue(raw)).toBeNull();
  });

  it('null in -> null out', () => {
    expect(parseFeedValue(null)).toBeNull();
  });
});
