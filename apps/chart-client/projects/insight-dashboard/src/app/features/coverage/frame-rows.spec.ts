import type { WebFrameCoverage } from '@trade-automation/contracts';
import { frameTotals, toFrameViews } from './frame-rows';

/**
 * IB-015 — the feature-frame block of the coverage page.
 *
 * The assertions are about keeping three kinds of "not fine" apart. Only one of them is work:
 * a frame that was never written, a chaseable refusal past the heal window, and a permanent
 * refusal are three different states, and a page that renders them as one number either raises
 * an alarm nobody can clear or hides the one that matters.
 */
const row = (over: Partial<WebFrameCoverage> = {}): WebFrameCoverage => ({
  tf: '15m',
  expected: 96,
  written: 96,
  incomplete: 0,
  explainedOnly: 0,
  unhealed: 0,
  oldestUnhealed: null,
  ...over,
});

describe('toFrameViews', () => {
  it('shows written against EXPECTED, so the denominator is on the page', () => {
    const [view] = toFrameViews([row({ written: 90 })]);
    expect(view.writtenLabel).toBe('90 of 96');
    expect(view.missing).toBe(6);
  });

  it('calls a never-written frame MISSING, which no count of frames can show', () => {
    // IB-BUG-010 one layer up: "the pass was not running" and "nothing was wrong" must not
    // produce the same reading.
    const [view] = toFrameViews([row({ written: 40 })]);
    expect(view.state).toBe('missing');
  });

  it('ranks missing above unhealed — healing cannot produce a frame that was never written', () => {
    const views = toFrameViews([
      row({ tf: '4h', unhealed: 3 }),
      row({ tf: '15m', written: 10 }),
    ]);
    expect(views.map((v) => v.state)).toEqual(['missing', 'unhealed']);
  });

  it('does NOT raise an alarm for permanent refusals', () => {
    // These are `complete = false` for ever: the venue never produced those minutes. An alarm
    // that cannot be cleared stops being read.
    const [view] = toFrameViews([row({ explainedOnly: 12 })]);
    expect(view.state).toBe('explained');
    expect(view.missing).toBe(0);
  });

  it('is ok when every frame is written and nothing refuses', () => {
    expect(toFrameViews([row()])[0].state).toBe('ok');
  });

  it('treats incomplete-but-young as not yet an alarm', () => {
    // `incomplete` without `unhealed` is a frame inside the heal window. It is chaseable but
    // nobody should be chasing it yet, so the row is not called unhealed.
    const [view] = toFrameViews([row({ incomplete: 4, unhealed: 0 })]);
    expect(view.state).toBe('ok');
  });

  it('never reports a negative gap at a window edge', () => {
    // A close can land inside the window after `expected` was computed. More frames than
    // expected is not minus-two frames missing.
    const [view] = toFrameViews([row({ expected: 96, written: 98 })]);
    expect(view.missing).toBe(0);
  });

  it('formats the oldest unhealed close, and a dash when there is none', () => {
    const at = Date.UTC(2026, 9, 11, 3, 15);
    expect(toFrameViews([row({ unhealed: 1, oldestUnhealed: at })])[0].oldestUnhealedLabel)
      .toBe('2026-10-11 03:15');
    expect(toFrameViews([row()])[0].oldestUnhealedLabel).toBe('—');
  });
});

describe('frameTotals', () => {
  it('SUMS unhealed across timeframes rather than averaging', () => {
    // It is a work queue, not a rate: averaging would hide a 4h timeframe in trouble behind a
    // healthy 15m one.
    const totals = frameTotals([row({ tf: '15m' }), row({ tf: '4h', expected: 6, written: 6, unhealed: 5 })]);
    expect(totals.unhealed).toBe(5);
    expect(totals.timeframes).toBe(2);
  });

  it('sums the missing frames too, clamped per row', () => {
    const totals = frameTotals([row({ written: 90 }), row({ tf: '4h', expected: 6, written: 9 })]);
    expect(totals.missing).toBe(6); // 6 from the first, 0 (not -3) from the second
  });

  it('is all zeroes for an empty block, which is what a fresh database shows', () => {
    expect(frameTotals([])).toEqual({ timeframes: 0, written: 0, expected: 0, unhealed: 0, missing: 0 });
  });
});
