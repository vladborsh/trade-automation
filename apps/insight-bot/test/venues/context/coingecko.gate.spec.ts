import { CoingeckoGate } from '../../../src/venues/context/coingecko.gate';

/**
 * A controllable clock, because the scheduling RULE is what is under test here. The brief is
 * explicit that this does not replace the wall-clock run: two schedulers sharing one external
 * allowance is a real-time property, and a fake clock cannot see it. This spec pins the ordering
 * so that a future edit cannot silently reorder the queue; the 30-minute run proves the effect.
 */
/** Drains the microtask queue: `setImmediate` runs after every pending `.then`. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function fakeClock() {
  let nowMs = 0;
  const sleepers: Array<{ at: number; wake: () => void }> = [];
  return {
    now: () => nowMs,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        sleepers.push({ at: nowMs + ms, wake: resolve });
      }),
    /** Moves the clock and lets everything due run, including anything queued while advancing. */
    async advance(ms: number): Promise<void> {
      const target = nowMs + ms;
      await flush();
      for (;;) {
        const due = sleepers.filter((s) => s.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        sleepers.splice(sleepers.indexOf(due), 1);
        nowMs = due.at;
        due.wake();
        await flush();
      }
      nowMs = target;
      await flush();
    },
  };
}

function build(minSpacingMs = 30_000) {
  const clock = fakeClock();
  const order: string[] = [];
  const preempts: Array<{ queuedBehind: number; waitedMs: number }> = [];
  const gate = new CoingeckoGate({
    minSpacingMs,
    now: clock.now,
    sleep: clock.sleep,
    onPreempt: (info) => preempts.push(info),
  });
  const call = (name: string, priority: 'forward-only' | 'backfill') =>
    gate.run(priority, async () => {
      order.push(`${name}@${clock.now()}`);
      return name;
    });
  return { gate, clock, order, preempts, call };
}

describe('the CoinGecko gate', () => {
  it('spaces requests by the measured interval rather than letting them burst', async () => {
    const { clock, order, call } = build();
    void call('a', 'backfill');
    void call('b', 'backfill');
    await clock.advance(0);
    expect(order).toEqual(['a@0']); // the second waits even though both were ready at once
    await clock.advance(30_000);
    expect(order).toEqual(['a@0', 'b@30000']);
  });

  it('lets the forward-only poll overtake a backfill that queued first', async () => {
    // THE BUG: the backfill queues twenty coins, /global arrives second and would wait ten
    // minutes behind them — long enough to miss its own slot, and that sample can never be
    // re-fetched because CoinGecko's history endpoint is paid.
    const { clock, order, call } = build();
    void call('coin-1', 'backfill');
    void call('coin-2', 'backfill');
    void call('coin-3', 'backfill');
    await clock.advance(0); // coin-1 is already in flight; the rest are queued
    void call('global', 'forward-only');
    await clock.advance(30_000);
    expect(order).toEqual(['coin-1@0', 'global@30000']);
    await clock.advance(30_000);
    expect(order[2]).toBe('coin-2@60000');
  });

  it('sorts at dispatch, not at enqueue, so a late arrival is not stuck behind an old queue', async () => {
    const { clock, order, call } = build();
    void call('coin-1', 'backfill');
    void call('coin-2', 'backfill');
    await clock.advance(0);
    // arrives while the gate is already holding the spacing for coin-2
    await clock.advance(15_000);
    void call('global', 'forward-only');
    await clock.advance(15_000);
    expect(order[1]).toBe('global@30000');
  });

  it('keeps FIFO within a priority, so no coin is left behind for ever', async () => {
    const { clock, order, call } = build();
    void call('coin-1', 'backfill');
    void call('coin-2', 'backfill');
    void call('coin-3', 'backfill');
    await clock.advance(90_000);
    expect(order).toEqual(['coin-1@0', 'coin-2@30000', 'coin-3@60000']);
  });

  it('holds EVERY caller back after a 429, including the forward-only one', async () => {
    // the 429 says the shared allowance is spent; sending /global into it turns one rate-limited
    // caller into two, and a ten-minute slot can absorb a minute of back-off without losing the
    // sample
    const { gate, clock, order, call } = build();
    void call('coin-1', 'backfill');
    await clock.advance(0);
    gate.backOff(60_000);
    void call('global', 'forward-only');
    await clock.advance(30_000);
    expect(order).toEqual(['coin-1@0']);
    await clock.advance(30_000);
    expect(order).toEqual(['coin-1@0', 'global@60000']);
  });

  it('reports the overtake, so the fix is visible in the log rather than assumed', async () => {
    const { clock, preempts, call } = build();
    void call('coin-1', 'backfill');
    void call('coin-2', 'backfill');
    await clock.advance(0);
    void call('global', 'forward-only');
    await clock.advance(30_000);
    expect(preempts).toEqual([{ queuedBehind: 1, waitedMs: 30_000 }]);
  });

  it('passes a result back and lets a failure reject its own caller only', async () => {
    const { gate, clock } = build();
    const ok = gate.run('backfill', async () => 'value');
    // the handler is attached here, not after `advance`: the rejection happens while the clock is
    // being advanced, and an unhandled one would fail the run rather than the assertion
    const bad = gate
      .run('backfill', async () => {
        throw new Error('boom');
      })
      .then(() => 'resolved', (err: Error) => err.message);
    const after = gate.run('backfill', async () => 'still running');
    await clock.advance(60_000);
    await expect(ok).resolves.toBe('value');
    await expect(bad).resolves.toBe('boom');
    await expect(after).resolves.toBe('still running'); // one failure does not stall the queue
  });
});
