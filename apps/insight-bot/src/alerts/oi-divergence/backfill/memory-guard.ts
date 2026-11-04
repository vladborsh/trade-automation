/**
 * IB-116 (TL review, 2026-11-04) — the history run shares a small box with the live bot, which sends the owner's
 * alerts. Before each chunk, and every ~30 s while measuring paths, the run reads the box's MemAvailable and
 * steps back when it is low:
 * - at or above `MEM_FLOOR_MB` (120): go;
 * - below it: wait (a log line), re-reading every `MEM_RECHECK_MS`;
 * - still below after `MEM_ABORT_AFTER_MS` (5 min) of waiting: abort the run. A write run is idempotent, so a
 *   rerun later continues where it stopped (rows already written are not written twice; paths measured stay).
 * Where `/proc/meminfo` cannot be read (a Mac slot), the guard says so once and lets the run go.
 */
export const MEM_FLOOR_MB = 120;
/**
 * TL ruling (option A): a phase may only BEGIN with this much available. The CLI's own growth (~30 MB above its
 * module load, measured 109 MB peak on Linux) happens inside the first chunk, between two guard checks — so the
 * start needs the floor plus that growth plus margin. Checked before the replay and again before path measuring
 * (the long phase).
 */
export const MEM_START_FLOOR_MB = 170;
export const MEM_RECHECK_MS = 10_000;
export const MEM_ABORT_AFTER_MS = 5 * 60_000;
/** While measuring paths, the guard is consulted at most this often. */
export const MEM_CHECK_EVERY_MS = 30_000;

export type MemoryDecision = 'go' | 'wait' | 'abort';

/**
 * The decision, pure. `waitingSinceMs` is when the current low stretch began (null when not waiting).
 * Unknown availability (null) is `go`: the guard protects the box, where /proc/meminfo exists.
 */
export function memoryDecision(availableMb: number | null, waitingSinceMs: number | null, nowMs: number): MemoryDecision {
  if (availableMb === null || availableMb >= MEM_FLOOR_MB) return 'go';
  if (waitingSinceMs !== null && nowMs - waitingSinceMs >= MEM_ABORT_AFTER_MS) return 'abort';
  return 'wait';
}

/** The start gate, pure: refuse below MEM_START_FLOOR_MB; unknown availability (no /proc, a Mac slot) is go. */
export function startGateDecision(availableMb: number | null): 'go' | 'refuse' {
  return availableMb === null || availableMb >= MEM_START_FLOOR_MB ? 'go' : 'refuse';
}

/** MemAvailable in MB from the text of /proc/meminfo; null when the line is absent or malformed. */
export function parseMemAvailableMb(meminfo: string): number | null {
  const m = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo);
  return m ? Math.floor(Number(m[1]) / 1024) : null;
}

export interface MemoryGuardPorts {
  /** MemAvailable in MB, or null when it cannot be read. */
  availableMb(): Promise<number | null>;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
}

/** Waits until memory allows the next step; throws when it has stayed low for MEM_ABORT_AFTER_MS. */
export class MemoryGuard {
  private lastCheck = Number.NEGATIVE_INFINITY;
  private saidUnknown = false;
  /** The lowest MemAvailable seen, for the run's report. */
  minSeenMb: number | null = null;

  constructor(private readonly ports: MemoryGuardPorts) {}

  /** Checks now (before a chunk). */
  async check(label: string): Promise<void> {
    let waitingSince: number | null = null;
    for (;;) {
      const available = await this.ports.availableMb();
      this.lastCheck = this.ports.now();
      if (available === null && !this.saidUnknown) {
        this.saidUnknown = true;
        this.ports.log('memory guard: MemAvailable unreadable (no /proc/meminfo) — not guarding');
      }
      if (available !== null) this.minSeenMb = Math.min(this.minSeenMb ?? available, available);
      const decision = memoryDecision(available, waitingSince, this.ports.now());
      if (decision === 'go') {
        if (waitingSince !== null) this.ports.log(`memory guard: ${available} MB available, resuming (${label})`);
        return;
      }
      if (decision === 'abort') {
        throw new Error(`memory guard: MemAvailable ${available} MB < ${MEM_FLOOR_MB} MB for ${MEM_ABORT_AFTER_MS / 60_000} min — aborting before ${label}; a rerun continues where this stopped`);
      }
      if (waitingSince === null) {
        waitingSince = this.ports.now();
        this.ports.log(`memory guard: MemAvailable ${available} MB < ${MEM_FLOOR_MB} MB — pausing before ${label}`);
      }
      await this.ports.sleep(MEM_RECHECK_MS);
    }
  }

  /** The start gate before a phase: throws (nothing started) below MEM_START_FLOOR_MB. */
  async gate(phase: string): Promise<void> {
    const available = await this.ports.availableMb();
    if (available !== null) this.minSeenMb = Math.min(this.minSeenMb ?? available, available);
    if (startGateDecision(available) === 'refuse') {
      throw new Error(`memory gate: MemAvailable ${available} MB < ${MEM_START_FLOOR_MB} MB — not starting ${phase}; run it at a quieter hour (a rerun continues where this stopped)`);
    }
    this.ports.log(`memory gate: ${available ?? 'unreadable'} MB available — starting ${phase}`);
  }

  /** Checks when the last check is at least MEM_CHECK_EVERY_MS old (inside the path-measuring loop). */
  async every30s(label: string): Promise<void> {
    if (this.ports.now() - this.lastCheck >= MEM_CHECK_EVERY_MS) await this.check(label);
  }
}
