import { Injectable } from '@nestjs/common';

/** One collector stream's liveness, as `/health` reports it (§6.1). */
export interface StreamHealth {
  id: string;
  venue: string;
  lastMessageAgeSec: number | null;
  reconnects24h: number;
  gapsOpen: number;
  /** IB-005 / §16.1: `degraded` while the collector is on REST because its socket is mute. */
  mode: CollectorStreamMode;
  /** Why it is degraded, for the operator; null on a healthy stream. */
  degradedReason: string | null;
  /**
   * How often this stream is EXPECTED to speak, when that is known (a poller's period). A
   * socket that streams ticks leaves it null. The watchdog judges a stream against its own
   * cadence: a 5-minute poller is not late at 3 minutes (IB-011).
   */
  expectedIntervalSec: number | null;
}

/** A stream is either on its websocket or on the REST fallback of §16.1. */
export type CollectorStreamMode = 'ws' | 'degraded';

interface StreamState {
  venue: string;
  lastMessageAt: number | null;
  reconnects: number[]; // epoch ms, trimmed to the last 24h on read
  gapsOpen: number;
  mode: CollectorStreamMode;
  degradedReason: string | null;
  expectedIntervalSec: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * architecture/insight-bot-system-design.md §2.1 (`collectors/health`), §6.1, §6.2 — "a
 * `StreamRegistry` records every stream's last message time", and is what `/health`, the prom
 * gauges and the watchdog all read.
 *
 * IB-003 scaffolds it with no registered streams, so `/health` answers `streams: []`: no
 * collector exists yet (IB-005 onwards register theirs). Every method is deliberately
 * synchronous and allocation-light — the collectors call `recordMessage` on every frame.
 */
@Injectable()
export class StreamRegistry {
  private readonly streams = new Map<string, StreamState>();

  /**
   * Called by a collector when it starts a stream, before any message arrives.
   *
   * `expectedIntervalSec` is for streams that speak on a known period — a poller, not a socket.
   * Passing it is what stops the watchdog reporting a healthy 5- or 10-minute poller as silent
   * every cycle (IB-011, found on a live run).
   */
  register(id: string, venue: string, expectedIntervalSec: number | null = null): void {
    if (!this.streams.has(id)) {
      this.streams.set(id, { venue, lastMessageAt: null, reconnects: [], gapsOpen: 0, mode: 'ws', degradedReason: null, expectedIntervalSec });
    }
  }

  recordMessage(id: string, at = Date.now()): void {
    const state = this.streams.get(id);
    if (state) state.lastMessageAt = at;
  }

  recordReconnect(id: string, at = Date.now()): void {
    const state = this.streams.get(id);
    if (state) state.reconnects.push(at);
  }

  /**
   * IB-005 / §16.1: a collector that fell back to REST (or came back) says so here, and `/health`
   * shows it per stream — a degraded run must never look healthy.
   */
  setMode(id: string, mode: CollectorStreamMode, reason: string | null = null): void {
    const state = this.streams.get(id);
    if (state) {
      state.mode = mode;
      state.degradedReason = mode === 'degraded' ? reason : null;
    }
  }

  /** The number of gaps this stream has detected and not yet repaired (§6.2's gap report). */
  setGapsOpen(id: string, gapsOpen: number): void {
    const state = this.streams.get(id);
    if (state) state.gapsOpen = gapsOpen;
  }

  snapshot(now = Date.now()): StreamHealth[] {
    const out: StreamHealth[] = [];
    for (const [id, state] of this.streams) {
      state.reconnects = state.reconnects.filter((t) => now - t < DAY_MS);
      out.push({
        id,
        venue: state.venue,
        // null, not 0, until the stream's first message: "no message yet" and "a message just
        // now" are different states for the watchdog (§6.2).
        lastMessageAgeSec: state.lastMessageAt === null ? null : Math.max(0, Math.round((now - state.lastMessageAt) / 1000)),
        reconnects24h: state.reconnects.length,
        gapsOpen: state.gapsOpen,
        mode: state.mode,
        degradedReason: state.degradedReason,
        expectedIntervalSec: state.expectedIntervalSec,
      });
    }
    return out;
  }
}
