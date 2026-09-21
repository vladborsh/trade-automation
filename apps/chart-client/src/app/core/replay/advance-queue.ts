import type {
  AdvanceRequest,
  AdvanceResult,
  CancelRequest,
  CloseRequest,
  CloseResponse,
  ModifyOrderRequest,
  Order,
  PlaceOrderRequest,
  PlaceOrderResponse,
} from '@trade-automation/contracts';
import { advanceTarget, backoffMs, coalesceHead, isRetryable, type MutationInput } from './mutation-rules';

/** The five mutating endpoints (§7.2), each taking the exact request body to send. */
export interface MutationTransport {
  advance(body: AdvanceRequest): Promise<AdvanceResult>;
  place(body: PlaceOrderRequest): Promise<PlaceOrderResponse>;
  cancel(orderId: string, body: CancelRequest): Promise<Order>;
  close(orderId: string, body: CloseRequest): Promise<CloseResponse>;
  modify(orderId: string, body: ModifyOrderRequest): Promise<Order>;
}

export type MutationOutcome =
  | { kind: 'advance'; result: AdvanceResult }
  | { kind: 'place'; result: PlaceOrderResponse }
  | { kind: 'cancel'; result: Order }
  | { kind: 'close'; result: CloseResponse }
  | { kind: 'modify'; result: Order };

export interface AdvanceQueueHooks {
  /** Every response, in queue order. */
  onOutcome(outcome: MutationOutcome): void;
  /** A request the server refused (any 4xx). The queue has stopped and dropped what was left. */
  onRefused(err: unknown, op: MutationInput): void;
  /** Whether a request is currently being retried after a network error or 5xx. */
  onRetrying?(retrying: boolean): void;
  /** The queue has answered everything it was given (after at least one outcome). */
  onIdle?(): void;
}

export interface AdvanceQueueOptions {
  newOpId?: () => string;
  delay?: (ms: number) => Promise<void>;
}

/** A queued op with its request frozen: a retry must resend these exact bytes (BUG-004). */
interface Frozen {
  op: MutationInput;
  send: () => Promise<MutationOutcome>;
}

/**
 * backtest-app-system-design.md §5.5 — every mutation of a session, in one serialised chain.
 *
 * - Consecutive advances **waiting** in the queue are coalesced into one with the latest target and
 *   a **new** opId (reusing a queued advance's opId with another target is a 409 since BUG-004).
 *   An advance already in flight is never touched.
 * - An order op is never reordered or merged across the advances around it: it is sent only after
 *   the advance before it has completed, so its `cursorMs` equals the server cursor.
 * - Order ops get their opId and body when they are pushed; an advance when it is sent. A network
 *   error or 5xx resends the **identical** request (same opId, same body) with capped backoff —
 *   if the first attempt was applied, the server replays its stored response. A 4xx is final: the
 *   queue stops, drops what is left (it was built on a state the server rejected) and reports it.
 *
 * `push` never waits: stepping stays instant and the UI never awaits the queue.
 */
export class AdvanceQueue {
  private readonly queue: Array<MutationInput | Frozen> = [];
  private running = false;
  private stopped = false;
  private readonly newOpId: () => string;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(
    private readonly transport: MutationTransport,
    private readonly hooks: AdvanceQueueHooks,
    options: AdvanceQueueOptions = {},
  ) {
    this.newOpId = options.newOpId ?? (() => crypto.randomUUID());
    this.delay = options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Requests not yet answered, the one in flight included. */
  get pending(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  push(op: MutationInput): void {
    if (this.stopped) return;
    // Advances stay raw until sent so they can be coalesced; order ops are frozen now.
    this.queue.push(op.kind === 'advance' ? op : this.freeze(op));
    void this.drain();
  }

  /** Stops sending; used when the workspace reloads the session or is left. */
  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.stopped && this.queue.length > 0) {
        const next = this.takeHead();
        const outcome = await this.sendWithRetry(next);
        if (outcome === null) return; // refused: the queue has stopped
        if (!this.stopped) this.hooks.onOutcome(outcome);
      }
    } finally {
      this.running = false;
    }
    if (!this.stopped) this.hooks.onIdle?.();
  }

  /** The head of the queue, frozen: waiting advances coalesced into one with a fresh opId. */
  private takeHead(): Frozen {
    const head = this.queue[0];
    if (!isRaw(head)) {
      this.queue.shift();
      return head;
    }
    const raw: MutationInput[] = []; // the advances waiting at the head, up to the first order op
    for (const q of this.queue) {
      if (!isRaw(q)) break;
      raw.push(q);
    }
    const { op, consumed } = coalesceHead(raw)!;
    this.queue.splice(0, consumed);
    return this.freeze(op);
  }

  private freeze(op: MutationInput): Frozen {
    const opId = this.newOpId();
    const t = this.transport;
    switch (op.kind) {
      case 'advance': {
        const body: AdvanceRequest = { opId, toCursorMs: advanceTarget(op.toCursorMs) };
        return { op, send: async () => ({ kind: 'advance', result: await t.advance(body) }) };
      }
      case 'place': {
        const { kind: _kind, ...rest } = op;
        const body: PlaceOrderRequest = { opId, ...rest };
        return { op, send: async () => ({ kind: 'place', result: await t.place(body) }) };
      }
      case 'cancel': {
        const body: CancelRequest = { opId, cursorMs: op.cursorMs };
        return { op, send: async () => ({ kind: 'cancel', result: await t.cancel(op.orderId, body) }) };
      }
      case 'close': {
        const body: CloseRequest = { opId, cursorMs: op.cursorMs };
        return { op, send: async () => ({ kind: 'close', result: await t.close(op.orderId, body) }) };
      }
      case 'modify': {
        const body: ModifyOrderRequest = { opId, cursorMs: op.cursorMs, sl: op.sl, tp: op.tp };
        return { op, send: async () => ({ kind: 'modify', result: await t.modify(op.orderId, body) }) };
      }
    }
  }

  /** The outcome, or null when the server refused the request (and the queue has stopped). */
  private async sendWithRetry(frozen: Frozen): Promise<MutationOutcome | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        const outcome = await frozen.send();
        if (attempt > 0) this.hooks.onRetrying?.(false);
        return outcome;
      } catch (err) {
        if (this.stopped) return null;
        if (!isRetryable(err)) {
          if (attempt > 0) this.hooks.onRetrying?.(false);
          this.stop();
          this.hooks.onRefused(err, frozen.op);
          return null;
        }
        if (attempt === 0) this.hooks.onRetrying?.(true);
        await this.delay(backoffMs(attempt));
        if (this.stopped) return null;
      }
    }
  }
}

function isRaw(q: MutationInput | Frozen | undefined): q is MutationInput {
  return q !== undefined && 'kind' in q;
}
