import type { Playbook, PlaybookRegistry } from './playbook.port';
import { p3 } from './p3';

/**
 * IB-018 — the playbooks the runner iterates.
 *
 * **One entry playbook, P3** (§9.4): P1 and P2 are closed — the squeeze family failed its gate on
 * 2026-09-28 and there is no `p1.ts` or `p2.ts` to register — P4 is a feature with weight 0 rather
 * than a playbook, and P5's trading half is not built. A registry with one entry is the honest
 * state of stage 1, not a placeholder.
 *
 * Built from a list so a duplicate id cannot be registered silently: two playbooks under one id
 * would have the second quietly win the map, and every signal either wrote would reference the
 * same `playbook` string with different thresholds behind it.
 */
export const STAGE_1_PLAYBOOKS: readonly Playbook[] = [p3];

export function buildRegistry(playbooks: readonly Playbook[] = STAGE_1_PLAYBOOKS): PlaybookRegistry {
  const map = new Map<string, Playbook>();
  for (const playbook of playbooks) {
    if (map.has(playbook.id)) {
      throw new Error(`playbook id ${playbook.id} registered twice: one id, one set of thresholds`);
    }
    map.set(playbook.id, playbook);
  }
  return map;
}
