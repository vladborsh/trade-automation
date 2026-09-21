import type { AdvanceResult, Order } from '@trade-automation/contracts';
import { ApiError } from '../api/api-error';
import { AdvanceQueue, type MutationOutcome, type MutationTransport } from './advance-queue';

const M = 60_000;

/** A transport whose every call waits until the test answers it; records what was sent, in order. */
function fakeTransport() {
  const sent: Array<{ kind: string; body: unknown; answer: (v: unknown) => void; fail: (e: unknown) => void }> = [];
  const call = (kind: string) => (a: unknown, b?: unknown) =>
    new Promise<never>((resolve, reject) => {
      sent.push({ kind, body: b ?? a, answer: resolve as (v: unknown) => void, fail: reject });
    });
  const transport = {
    advance: call('advance'),
    place: call('place'),
    cancel: call('cancel'),
    close: call('close'),
    modify: call('modify'),
  } as unknown as MutationTransport;
  return { transport, sent };
}

const result = (cursorMs: number): AdvanceResult =>
  ({ cursorMs, status: 'active', balance: 10_000, events: [], orders: [], stats: {} }) as unknown as AdvanceResult;

/** Lets pending promise callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const { transport, sent } = fakeTransport();
  const outcomes: MutationOutcome[] = [];
  const refused: unknown[] = [];
  const retrying: boolean[] = [];
  const delays: number[] = [];
  let n = 0;
  const queue = new AdvanceQueue(
    transport,
    { onOutcome: (o) => outcomes.push(o), onRefused: (e) => refused.push(e), onRetrying: (r) => retrying.push(r) },
    { newOpId: () => `op-${++n}`, delay: async (ms) => void delays.push(ms) },
  );
  return { queue, sent, outcomes, refused, retrying, delays };
}

describe('AdvanceQueue (backtest-app-system-design.md §5.5)', () => {
  it('coalesces advances queued behind one in flight into ONE request with the last target and a fresh opId', async () => {
    const { queue, sent, outcomes } = setup();
    queue.push({ kind: 'advance', toCursorMs: 5 * M }); // goes out at once
    queue.push({ kind: 'advance', toCursorMs: 10 * M });
    queue.push({ kind: 'advance', toCursorMs: 15 * M });
    queue.push({ kind: 'advance', toCursorMs: 20 * M });
    await flush();
    expect(sent.map((s) => s.body)).toEqual([{ opId: 'op-1', toCursorMs: 5 * M }]);

    sent[0].answer(result(5 * M));
    await flush();
    expect(sent.map((s) => s.body)).toEqual([
      { opId: 'op-1', toCursorMs: 5 * M },
      { opId: 'op-2', toCursorMs: 20 * M }, // three queued advances, one request, a NEW opId
    ]);
    sent[1].answer(result(20 * M));
    await flush();
    expect(outcomes.map((o) => (o.result as AdvanceResult).cursorMs)).toEqual([5 * M, 20 * M]);
    expect(queue.pending).toBe(0);
  });

  it('sends an order op only after the advance before it, never merging advances across it', async () => {
    const { queue, sent } = setup();
    queue.push({ kind: 'advance', toCursorMs: 5 * M });
    queue.push({ kind: 'advance', toCursorMs: 10 * M });
    queue.push({ kind: 'cancel', cursorMs: 10 * M, orderId: 'o1' });
    queue.push({ kind: 'advance', toCursorMs: 15 * M });
    queue.push({ kind: 'advance', toCursorMs: 20 * M });
    await flush();

    sent[0].answer(result(5 * M));
    await flush();
    expect(sent[1].body).toEqual({ opId: 'op-3', toCursorMs: 10 * M }); // 10 only: the cancel comes next
    expect(sent).toHaveLength(2); // the cancel waits for that advance

    sent[1].answer(result(10 * M));
    await flush();
    expect(sent[2]).toMatchObject({ kind: 'cancel', body: { opId: 'op-2', cursorMs: 10 * M } }); // opId frozen at push
    expect(sent).toHaveLength(3);

    sent[2].answer({ id: 'o1' } as Order);
    await flush();
    expect(sent[3].body).toEqual({ opId: 'op-4', toCursorMs: 20 * M });
  });

  it('retries a network failure with the byte-identical request, backing off', async () => {
    const { queue, sent, outcomes, retrying, delays } = setup();
    queue.push({ kind: 'advance', toCursorMs: 5 * M });
    await flush();
    sent[0].fail(new TypeError('Failed to fetch'));
    await flush();
    sent[1].fail(new ApiError(503, null, 'unavailable'));
    await flush();
    sent[2].answer(result(5 * M));
    await flush();

    expect(sent.map((s) => s.body)).toEqual([
      { opId: 'op-1', toCursorMs: 5 * M },
      { opId: 'op-1', toCursorMs: 5 * M },
      { opId: 'op-1', toCursorMs: 5 * M },
    ]);
    expect(sent[1].body).toBe(sent[0].body); // the same object: the same bytes
    expect(delays).toEqual([250, 500]);
    expect(retrying).toEqual([true, false]);
    expect(outcomes).toHaveLength(1);
  });

  it('does not coalesce into a request being retried; later advances wait behind it', async () => {
    const { queue, sent } = setup();
    queue.push({ kind: 'advance', toCursorMs: 5 * M });
    await flush();
    queue.push({ kind: 'advance', toCursorMs: 10 * M });
    sent[0].fail(new TypeError('Failed to fetch'));
    await flush();
    expect(sent[1].body).toEqual({ opId: 'op-1', toCursorMs: 5 * M });
    sent[1].answer(result(5 * M));
    await flush();
    expect(sent[2].body).toEqual({ opId: 'op-2', toCursorMs: 10 * M });
  });

  it('a 4xx is final: no retry, the queue stops, drops the rest and reports it', async () => {
    const { queue, sent, refused, outcomes } = setup();
    queue.push({ kind: 'advance', toCursorMs: 5 * M });
    queue.push({ kind: 'cancel', cursorMs: 5 * M, orderId: 'o1' });
    await flush();
    const conflict = new ApiError(409, 'CURSOR_BACKWARDS', 'toCursorMs is before the cursor');
    sent[0].fail(conflict);
    await flush();

    expect(refused).toEqual([conflict]);
    expect(sent).toHaveLength(1);
    expect(outcomes).toEqual([]);
    queue.push({ kind: 'advance', toCursorMs: 10 * M });
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('T-023: a 422 on place is a rejection — reported, no stop, the rest of the queue still goes out', async () => {
    const { transport, sent } = fakeTransport();
    const outcomes: MutationOutcome[] = [];
    const refused: unknown[] = [];
    const rejected: Array<{ err: unknown; kind: string }> = [];
    let n = 0;
    const queue = new AdvanceQueue(
      transport,
      { onOutcome: (o) => outcomes.push(o), onRefused: (e) => refused.push(e), onRejected: (err, op) => rejected.push({ err, kind: op.kind }) },
      { newOpId: () => `op-${++n}` },
    );
    queue.push({ kind: 'place', cursorMs: 0, panelId: 'p', side: 'long', type: 'market', sl: 1, riskPct: 1 });
    queue.push({ kind: 'advance', toCursorMs: 5 * M });
    await flush();
    const invalid = new ApiError(422, 'SL_ON_WRONG_SIDE', 'A long stop must be below the entry.');
    sent[0].fail(invalid);
    await flush();
    expect(rejected).toEqual([{ err: invalid, kind: 'place' }]);
    expect(refused).toEqual([]);
    expect(sent.map((s) => s.kind)).toEqual(['place', 'advance']); // the queue carried on
    sent[1].answer(result(5 * M));
    await flush();
    expect(outcomes.map((o) => o.kind)).toEqual(['advance']);
  });

  it('without an onRejected hook a 422 on place is still a refusal (the old behaviour)', async () => {
    const { queue, sent, refused } = setup();
    queue.push({ kind: 'place', cursorMs: 0, panelId: 'p', side: 'long', type: 'market', sl: 1, riskPct: 1 });
    await flush();
    const invalid = new ApiError(422, 'SL_ON_WRONG_SIDE', 'x');
    sent[0].fail(invalid);
    await flush();
    expect(refused).toEqual([invalid]);
  });

  it('rounds a target that is not on a minute up (the server clamps it to the period end)', async () => {
    const { queue, sent } = setup();
    queue.push({ kind: 'advance', toCursorMs: 5 * M + 30_000 });
    await flush();
    expect(sent[0].body).toEqual({ opId: 'op-1', toCursorMs: 6 * M });
  });

  it('reports idle once, when everything queued has been answered', async () => {
    const { transport, sent } = fakeTransport();
    const idle: number[] = [];
    let n = 0;
    const queue = new AdvanceQueue(transport, { onOutcome: () => undefined, onRefused: () => undefined, onIdle: () => idle.push(sent.length) }, { newOpId: () => `op-${++n}` });
    queue.push({ kind: 'advance', toCursorMs: 5 * M });
    queue.push({ kind: 'advance', toCursorMs: 10 * M });
    await flush();
    sent[0].answer(result(5 * M));
    await flush();
    expect(idle).toEqual([]); // the coalesced advance is still out
    sent[1].answer(result(10 * M));
    await flush();
    expect(idle).toEqual([2]);
  });

  it('stop() drops queued work and ignores the answer in flight', async () => {
    const { queue, sent, outcomes } = setup();
    queue.push({ kind: 'advance', toCursorMs: 5 * M });
    queue.push({ kind: 'advance', toCursorMs: 10 * M });
    await flush();
    queue.stop();
    sent[0].answer(result(5 * M));
    await flush();
    expect(outcomes).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it('builds every order op body once, with its own opId', async () => {
    const { queue, sent } = setup();
    queue.push({ kind: 'place', cursorMs: 0, panelId: 'btc', side: 'long', type: 'limit', limitPrice: 99, sl: 95, tp: 110, riskPct: 1 });
    queue.push({ kind: 'modify', cursorMs: 0, orderId: 'o1', sl: 96 });
    queue.push({ kind: 'close', cursorMs: 0, orderId: 'o2' });
    await flush();
    expect(sent[0]).toMatchObject({
      kind: 'place',
      body: { opId: 'op-1', cursorMs: 0, panelId: 'btc', side: 'long', type: 'limit', limitPrice: 99, sl: 95, tp: 110, riskPct: 1 },
    });
    sent[0].answer({ order: {}, events: [] });
    await flush();
    expect(sent[1]).toMatchObject({ kind: 'modify', body: { opId: 'op-2', cursorMs: 0, sl: 96 } });
    sent[1].answer({});
    await flush();
    expect(sent[2]).toMatchObject({ kind: 'close', body: { opId: 'op-3', cursorMs: 0 } });
  });
});
