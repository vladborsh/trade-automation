import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

/**
 * Must be the FIRST import of an e2e spec: `ConfigModule.forRoot({ validate })` reads
 * `process.env` when config.module.ts is first evaluated (at import time), so the temp
 * candle root and the bootstrap admin have to be in the environment before any `src/` import.
 * `restoreE2eEnv()` puts the worker's environment back for the next spec file.
 */
const ENABLED = Boolean(process.env.DATABASE_URL); // a skipped spec must not touch the worker's env or disk
const before = { ...process.env };
export const RUN = randomUUID().slice(0, 8);
export const E2E_ROOT = ENABLED ? fs.mkdtempSync(path.join(os.tmpdir(), 'bt-e2e-')) : path.join(os.tmpdir(), 'bt-e2e-disabled');
export const E2E_PASSWORD = 'e2e-password-123';
export const E2E_ADMIN_EMAIL = `admin-${RUN}@bt-e2e.test`;

if (ENABLED) {
  process.env.FILE_STORE_ROOT = E2E_ROOT;
  process.env.ADMIN_EMAIL = E2E_ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = E2E_PASSWORD;
}

export function restoreE2eEnv(): void {
  if (!ENABLED) return;
  for (const k of ['FILE_STORE_ROOT', 'ADMIN_EMAIL', 'ADMIN_PASSWORD']) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
  fs.rmSync(E2E_ROOT, { recursive: true, force: true });
}
