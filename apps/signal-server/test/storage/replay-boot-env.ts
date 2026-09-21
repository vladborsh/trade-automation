import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Must be the FIRST import of replay-no-persist.boot.spec.ts: ConfigModule validates
 * `process.env` when config.module.ts is first evaluated, so the replay-mode environment has to
 * be in place before any `src/` import. `restoreReplayBootEnv()` puts the worker's env back.
 *
 * Replay mode (MARKET_DATA_MODE unset → the default, 'replay'), fast replay of test/fixtures, the
 * calendar on its fixture feed, no database, quiet logs.
 */
const KEYS = ['FILE_STORE_ROOT', 'MARKET_DATA_MODE', 'REPLAY_SPEED', 'CALENDAR_ENABLED', 'DATABASE_URL', 'NODE_ENV', 'LOG_LEVEL', 'CANDLE_STORE'] as const;
const before: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};
for (const k of KEYS) before[k] = process.env[k];

export const REPLAY_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-no-persist-'));
process.env.FILE_STORE_ROOT = REPLAY_ROOT;
delete process.env.MARKET_DATA_MODE; // the default is replay: the bug's exact reproduction
delete process.env.DATABASE_URL;
delete process.env.CANDLE_STORE;
process.env.REPLAY_SPEED = 'fast';
process.env.CALENDAR_ENABLED = 'true';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

export function restoreReplayBootEnv(): void {
  for (const k of KEYS) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
  fs.rmSync(REPLAY_ROOT, { recursive: true, force: true });
}
