import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HEAP_OLD_SPACE_MB, MEASURED_PEAK_HEAP_USED_MB, MIN_HEAP_HEADROOM_RATIO, botCeilingMb, boxRoomForBotMb, nodeFlags,
} from '../../src/ops/memory-budget';

/** IB-096 — the image runs with the cap the arithmetic chose, and the arithmetic still fits the box. */
describe('memory budget (IB-096)', () => {
  const dockerfile = readFileSync(join(__dirname, '../../Dockerfile'), 'utf8');

  it('the image CMD passes exactly nodeFlags(), before the entry point', () => {
    const cmds = dockerfile.split('\n').filter((l) => l.startsWith('CMD '));
    expect(cmds).toHaveLength(1);
    expect(JSON.parse((cmds[0] as string).slice(4))).toEqual(['node', ...nodeFlags(), 'dist/main.js']);
  });

  it('old space holds the measured peak live heap with room: a lower cap is an OOM on a busier day', () => {
    expect(HEAP_OLD_SPACE_MB).toBeGreaterThanOrEqual(MEASURED_PEAK_HEAP_USED_MB * MIN_HEAP_HEADROOM_RATIO);
  });

  it("the bot's worst case fits what the box can give it: a higher cap needs a new box measurement", () => {
    expect(botCeilingMb()).toBe(265);
    expect(boxRoomForBotMb()).toBe(283);
    expect(botCeilingMb()).toBeLessThanOrEqual(boxRoomForBotMb());
  });
});
