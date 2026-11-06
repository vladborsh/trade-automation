import { FUNDING_FLIP_CHECKS, FUNDING_LATE_SEC, FUNDING_REARM_CHECKS, type FundingSide } from '@trade-automation/contracts';

/**
 * IB-124 (design F4, F5, F6, F7) — one coin side's state machine, pure. The loop stores the result in
 * `alert_funding_state` (migration 034) after every check, so a restart resumes mid-episode.
 *
 * - **F4 entry:** `normal → extreme` at the first check where the side is extreme: one `enter`, at that check.
 *   While extreme, a check outside starts the re-arming streak. `FUNDING_REARM_CHECKS` (3) in a row end the
 *   episode. Its end is the FIRST of them, the moment it stopped being extreme. One check back inside clears the
 *   streak, and the episode goes on.
 * - **F5 flip:** after a completed episode of ≥ `minEpisodeHours`, the first run of `FUNDING_FLIP_CHECKS` (3)
 *   checks in a row with the opposite sign that STARTS within `flipWithinHours` of the episode's end gives one
 *   `flip`, at the run's first check. One per episode (`flipSent`, reset when the next episode completes). The run
 *   may begin inside the re-arming streak. An opposite sign is never extreme on this side, so the run starts at
 *   or after the episode's end.
 * - **F7:** checks further apart than `FUNDING_LATE_SEC` are not "in a row". Both streaks restart, and the zone is
 *   kept: a rate still extreme after downtime is the same episode, never a second `enter`. A STALE check (rate
 *   older than 15 min) never reaches this function (the loop drops it).
 */
export interface FundingSideState {
  zone: 'normal' | 'extreme';
  /** Since when the zone holds, epoch ms; while extreme, the episode's start. */
  since: number;
  outChecks: number;
  outSince: number | null;
  /** The last COMPLETED episode. */
  episodeStart: number | null;
  episodeEnd: number | null;
  oppChecks: number;
  oppSince: number | null;
  flipSent: boolean;
  lastCheckAt: number;
}

export interface FundingStepParams { minEpisodeHours: number; flipWithinHours: number }

export type FundingStepEvent =
  | { kind: 'enter'; episodeStartMs: number }
  | { kind: 'flip'; episodeStartMs: number; episodeEndMs: number; episodeHours: number; flipSinceMs: number };

export interface FundingStep { state: FundingSideState; event: FundingStepEvent | null }

const HOUR_MS = 3_600_000;
const GAP_MS = FUNDING_LATE_SEC * 1_000;

/**
 * One check of one side. `extreme`: this side's condition holds (`fundingCheck(...).extreme === side`).
 * `ratePer8h`: its sign is what a flip reads.
 */
export function fundingStep(
  prev: FundingSideState | null, side: FundingSide, atMs: number, extreme: boolean, ratePer8h: number, params: FundingStepParams,
): FundingStep {
  const s: FundingSideState = prev
    ? { ...prev }
    : { zone: 'normal', since: atMs, outChecks: 0, outSince: null, episodeStart: null, episodeEnd: null, oppChecks: 0, oppSince: null, flipSent: false, lastCheckAt: atMs };
  if (prev && atMs - prev.lastCheckAt > GAP_MS) {
    s.outChecks = 0;
    s.outSince = null;
    s.oppChecks = 0;
    s.oppSince = null;
  }
  s.lastCheckAt = atMs;

  const opposite = side === 'high' ? ratePer8h < 0 : ratePer8h > 0;
  if (opposite) {
    s.oppChecks += 1;
    s.oppSince ??= atMs;
  } else {
    s.oppChecks = 0;
    s.oppSince = null;
  }

  if (s.zone === 'normal') {
    if (extreme) {
      s.zone = 'extreme';
      s.since = atMs;
      return { state: s, event: { kind: 'enter', episodeStartMs: atMs } };
    }
  } else if (extreme) {
    s.outChecks = 0;
    s.outSince = null;
  } else {
    s.outChecks += 1;
    s.outSince ??= atMs;
    if (s.outChecks >= FUNDING_REARM_CHECKS) {
      s.episodeStart = s.since;
      s.episodeEnd = s.outSince;
      s.flipSent = false;
      s.zone = 'normal';
      s.since = atMs;
      s.outChecks = 0;
      s.outSince = null;
    }
  }

  if (
    s.zone === 'normal' && s.episodeStart !== null && s.episodeEnd !== null && !s.flipSent
    && s.oppChecks >= FUNDING_FLIP_CHECKS && s.oppSince !== null
    && s.episodeEnd - s.episodeStart >= params.minEpisodeHours * HOUR_MS
    && s.oppSince - s.episodeEnd <= params.flipWithinHours * HOUR_MS
  ) {
    s.flipSent = true;
    return {
      state: s,
      event: {
        kind: 'flip', episodeStartMs: s.episodeStart, episodeEndMs: s.episodeEnd,
        episodeHours: (s.episodeEnd - s.episodeStart) / HOUR_MS, flipSinceMs: s.oppSince,
      },
    };
  }
  return { state: s, event: null };
}
