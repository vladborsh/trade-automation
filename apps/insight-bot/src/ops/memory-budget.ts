/**
 * IB-096 — the bot's memory cap on the 1 GB box, and the arithmetic behind it. The image's `CMD`
 * passes `nodeFlags()` (a spec reads the Dockerfile and fails if they drift apart).
 *
 * **Why a cap at all.** Uncapped, V8 sizes its heap for the machine, not for the box: on slot dev-3
 * the bot sat at 265–311 MB RSS under client cadence with heapUsed 63–111 MB and ~76 MB live (heap snapshot) — the rest
 * was heap V8 had grown into and kept (heapTotal up to 221 MB). With these flags the same load ran
 * at 154–175 MB RSS, heapTotal ≤ 86 MB, every request 200, no OOM (run C, 2026-11-04; run B at 160
 * gave 164–191 MB). Latency unchanged: median 62 vs 69 ms, p95 2.5 vs 2.8 s, the cold `insights`
 * build ~10 s in both.
 *
 * **The box (WD-010 and 78f47cc watches):** bot 104–168 MiB warm, Postgres 289–322 MiB, Caddy
 * 16–22 MiB, available min 165 MiB (`free -m`), rollback when available < 100 MiB for 10 min.
 *
 * Every figure below is from one occasion on a macOS slot unless it says otherwise — a note in the
 * AGENTS.md sense, to be replaced by the box's own `ib_process_memory_bytes` after deploy.
 */

/** V8 old space, MB (`--max-old-space-size`). */
export const HEAP_OLD_SPACE_MB = 128;
/** V8 semi-space, MB (`--max-semi-space-size`); the young generation is `YOUNG_GEN_SEMI_SPACES` of them. */
export const HEAP_SEMI_SPACE_MB = 8;
export const YOUNG_GEN_SEMI_SPACES = 3;

/**
 * Live heap under client cadence: 76 MB of reachable objects in a warm heap snapshot (taken after a
 * GC, before the IB-096 trims, so an upper figure). Not `heapUsed`: an uncapped sample of it
 * includes garbage awaiting collection (58–111 MB in the same load) and says little about what lives.
 */
export const MEASURED_PEAK_LIVE_HEAP_MB = 76;
/** Old space must hold the measured peak with this much room: below it, a busier day is an OOM. */
export const MIN_HEAP_HEADROOM_RATIO = 1.5;

/** Memory outside the V8 heap (RSS − heapTotal): 75–113 MB on the slot. macOS counts more here than Linux will. */
export const NATIVE_ALLOWANCE_MB = 113;

export const BOX_BOT_WARM_MAX_MIB = 168;
export const BOX_AVAILABLE_MIN_MIB = 165;
/** What the box must keep for the page cache and Postgres' own growth even at the bot's worst. */
export const BOX_KEEP_AVAILABLE_MIB = 50;

/** The node flags the image runs with. */
export function nodeFlags(): string[] {
  return [`--max-old-space-size=${HEAP_OLD_SPACE_MB}`, `--max-semi-space-size=${HEAP_SEMI_SPACE_MB}`];
}

/** The bot's worst case: a full heap at the cap plus the native allowance. 128 + 24 + 113 = 265. */
export function botCeilingMb(): number {
  return HEAP_OLD_SPACE_MB + YOUNG_GEN_SEMI_SPACES * HEAP_SEMI_SPACE_MB + NATIVE_ALLOWANCE_MB;
}

/**
 * What the box may give the bot at most: today's warm bot plus what is available beside it, less
 * what the box must keep. 168 + 165 − 50 = 283.
 *
 * Not the rollback floor: at the 265 ceiling, available would be ~68 MiB, under the 100 MiB rule.
 * That ceiling needs a full heap AND the slot's worst native figure at once; the measured warm RSS
 * is 154–175. The box measurement after deploy decides whether the native allowance is real there.
 */
export function boxRoomForBotMb(): number {
  return BOX_BOT_WARM_MAX_MIB + BOX_AVAILABLE_MIN_MIB - BOX_KEEP_AVAILABLE_MIB;
}
