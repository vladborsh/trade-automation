import { ResizeSettleTracker } from './resize-settle';

function harness() {
  const frames: Array<() => void> = [];
  const settled = { count: 0 };
  const tracker = new ResizeSettleTracker(
    () => settled.count++,
    (cb) => frames.push(cb),
  );
  const flushFrame = () => {
    const due = frames.splice(0, frames.length);
    due.forEach((cb) => cb());
  };
  return { tracker, settled, flushFrame };
}

describe('ResizeSettleTracker', () => {
  it('treats the first (mount-time) observation as a size, not a resize', () => {
    const { tracker, settled, flushFrame } = harness();
    tracker.observe(800, 400);
    expect(tracker.resizing).toBe(false);
    flushFrame();
    flushFrame();
    expect(settled.count).toBe(0);
  });

  it('is resizing from a size change until two frames later, then settles once', () => {
    const { tracker, settled, flushFrame } = harness();
    tracker.observe(800, 400);
    tracker.observe(600, 400);
    expect(tracker.resizing).toBe(true);
    flushFrame();
    expect(tracker.resizing).toBe(true);
    flushFrame();
    expect(tracker.resizing).toBe(false);
    expect(settled.count).toBe(1);
  });

  it('an identical size report is not a resize', () => {
    const { tracker } = harness();
    tracker.observe(800, 400);
    tracker.observe(800, 400);
    expect(tracker.resizing).toBe(false);
  });

  it('a resize arriving mid-wait restarts it; only the last one settles', () => {
    const { tracker, settled, flushFrame } = harness();
    tracker.observe(800, 400);
    tracker.observe(700, 400);
    flushFrame();
    tracker.observe(600, 400);
    flushFrame(); // first wait's 2nd frame: stale, ignored
    expect(tracker.resizing).toBe(true);
    flushFrame();
    expect(tracker.resizing).toBe(false);
    expect(settled.count).toBe(1);
  });

  it('dispose cancels a pending settle', () => {
    const { tracker, settled, flushFrame } = harness();
    tracker.observe(800, 400);
    tracker.observe(600, 400);
    tracker.dispose();
    flushFrame();
    flushFrame();
    expect(settled.count).toBe(0);
    expect(tracker.resizing).toBe(false);
  });
});
