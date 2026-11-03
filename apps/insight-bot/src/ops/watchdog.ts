import type { StreamHealth } from './stream-registry';

/**
 * IB-011 — the watchdog's decisions (design §6.2), pure: given the registry's snapshot and the
 * clock, which alerts to send now.
 *
 * The rule the design states: one alert when a stream has been silent longer than
 * `WATCHDOG_SILENCE_MIN`, one recovery message when it returns, and at most one alert per stream
 * per 30 minutes.
 *
 * Three refusals to cry wolf, each of which would otherwise fire on a perfectly healthy box:
 *
 * 1. **A degraded stream is not a silent stream.** IB-005's collector records a message on every
 *    answered REST poll precisely so this can tell "working on the fallback" from "dead", and a
 *    degraded spell is already reported by the admin health page (`/api/web/health/streams`) and by its own `collector_gaps` row. Alerting
 *    every 30 minutes for the hours a venue is unreachable would bury the one alert that matters.
 * 2. **A stream that has never spoken is given its window from registration, not from epoch.**
 *    `lastMessageAgeSec` is null until the first message; at boot that is every stream.
 * 3. **The recovery message only follows an alert we actually sent.** No alert, no "recovered".
 * 4. **A poller is judged against its own period, not the flat threshold.** Found on the IB-011
 *    live run: `binance-perp:oi-ls-5m` speaks every 5 minutes and the calendar every 10, so a
 *    3-minute threshold reported both as silent forever on a perfectly healthy box. A stream
 *    that declares `expectedIntervalSec` is late only after it misses two of its own cycles.
 */

export interface WatchdogAlert {
  kind: 'silent' | 'recovered';
  streamId: string;
  venue: string;
  /** How long it had been silent, in seconds; for a recovery, how long the spell lasted. */
  seconds: number;
}

export interface WatchdogOptions {
  silenceMin: number;
  /** One alert per stream per this long while it stays silent. */
  repeatMs?: number;
}

export const DEFAULT_REPEAT_MS = 30 * 60_000;
/** A poller has to miss this many of its own cycles before it counts as silent. */
export const MISSED_CYCLES = 2;

interface StreamMemory {
  firstSeenAt: number;
  alertedAt: number | null;
  silentSince: number | null;
}

export class Watchdog {
  private readonly memory = new Map<string, StreamMemory>();
  private readonly silenceMs: number;
  private readonly repeatMs: number;

  constructor(options: WatchdogOptions) {
    this.silenceMs = options.silenceMin * 60_000;
    this.repeatMs = options.repeatMs ?? DEFAULT_REPEAT_MS;
  }

  /** The alerts to send for this snapshot. Call it on every tick; it owns no clock of its own. */
  check(streams: readonly StreamHealth[], now: number): WatchdogAlert[] {
    const alerts: WatchdogAlert[] = [];

    for (const stream of streams) {
      const memory = this.memory.get(stream.id) ?? { firstSeenAt: now, alertedAt: null, silentSince: null };
      this.memory.set(stream.id, memory);

      // (1) working on the REST fallback: loud in the admin health page, not here
      if (stream.mode === 'degraded') {
        memory.silentSince = null;
        memory.alertedAt = null;
        continue;
      }

      const ageMs = stream.lastMessageAgeSec === null ? now - memory.firstSeenAt : stream.lastMessageAgeSec * 1000;
      const silent = ageMs > this.thresholdFor(stream);

      if (!silent) {
        if (memory.alertedAt !== null) {
          alerts.push({ kind: 'recovered', streamId: stream.id, venue: stream.venue, seconds: Math.round((now - (memory.silentSince ?? now)) / 1000) });
        }
        memory.alertedAt = null;
        memory.silentSince = null;
        continue;
      }

      memory.silentSince ??= now - ageMs;
      const due = memory.alertedAt === null || now - memory.alertedAt >= this.repeatMs;
      if (due) {
        memory.alertedAt = now;
        alerts.push({ kind: 'silent', streamId: stream.id, venue: stream.venue, seconds: Math.round(ageMs / 1000) });
      }
    }

    return alerts;
  }

  /**
   * The silence a stream is allowed. A socket gets the configured threshold; a poller gets the
   * longer of that and two of its own cycles, so its normal quiet period is not an incident.
   */
  private thresholdFor(stream: StreamHealth): number {
    const cadenceMs = (stream.expectedIntervalSec ?? 0) * 1000 * MISSED_CYCLES;
    return Math.max(this.silenceMs, cadenceMs);
  }

  /** Streams currently in an alerted state (for the admin health page and specs). */
  get alerting(): string[] {
    return [...this.memory.entries()].filter(([, m]) => m.alertedAt !== null).map(([id]) => id);
  }
}

/** The alert as the operator reads it: plain Russian, and it says what to do. */
export function renderAlert(alert: WatchdogAlert, silenceMin: number): string {
  const minutes = Math.round(alert.seconds / 60);
  if (alert.kind === 'recovered') {
    return `✅ Поток ${alert.streamId} снова получает данные. Молчал ${minutes} мин.`;
  }
  return (
    `⚠️ Поток ${alert.streamId} (${alert.venue}) молчит ${minutes} мин — это дольше порога в ${silenceMin} мин.\n` +
    'Обычно это разрыв связи с биржей и он чинится сам: переподключение автоматическое, ' +
    'пропущенные минутные свечи дозагрузятся. Если тишина держится дольше 15 мин — см. RUNBOOK, раздел 7.'
  );
}
