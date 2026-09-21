/**
 * architecture/backtest-app-system-design.md §4, §9.2 — screenshot bytes live in a
 * `ScreenshotStore` (file locally, S3 in production), never in the database. Keys follow the
 * Hive-style candle layout, so a session delete is one prefix delete and a user's footprint is
 * one prefix:
 *   backtest/screenshots/user=<userId>/session=<sessionId>/order=<orderId>/<kind>.png
 */
export interface ScreenshotObject {
  bytes: Buffer;
  contentType: string;
}

export interface ScreenshotStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** null when there is no object at `key`. */
  get(key: string): Promise<ScreenshotObject | null>;
  /**
   * Deletes every object under `prefix` and returns how many there were. `prefix` must be a
   * directory-style screenshots prefix (see `assertScreenshotPrefix`); anything broader is refused.
   */
  deleteByPrefix(prefix: string): Promise<number>;
}

export const SCREENSHOT_STORE = Symbol('SCREENSHOT_STORE');

export const SCREENSHOT_ROOT = 'backtest/screenshots/';
export type ScreenshotKindSegment = 'entry' | 'exit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidSegment(name: string, value: string): string {
  if (!UUID.test(value)) throw new Error(`screenshot key: ${name} must be a uuid`);
  return value.toLowerCase();
}

/**
 * The session's prefix, `backtest/screenshots/user=<u>/session=<s>/`. Built only from
 * server-resolved ids (the cookie user, a session found through the tenancy-scoped repository),
 * and refuses anything that is not a uuid, so no client string can reach a key.
 */
export function sessionScreenshotPrefix(userId: string, sessionId: string): string {
  return `${SCREENSHOT_ROOT}user=${uuidSegment('userId', userId)}/session=${uuidSegment('sessionId', sessionId)}/`;
}

export function screenshotKey(userId: string, sessionId: string, orderId: string, kind: ScreenshotKindSegment): string {
  if (kind !== 'entry' && kind !== 'exit') throw new Error('screenshot key: kind must be entry or exit');
  return `${sessionScreenshotPrefix(userId, sessionId)}order=${uuidSegment('orderId', orderId)}/${kind}.png`;
}

/**
 * Guards `deleteByPrefix`: the prefix must be a directory-style path strictly below
 * `backtest/screenshots/user=<something>/`. So an empty prefix, the store root, the screenshots
 * root and any `..` or absolute path are refused.
 */
export function assertScreenshotPrefix(prefix: string): void {
  const ok =
    prefix.startsWith(`${SCREENSHOT_ROOT}user=`) &&
    prefix.endsWith('/') &&
    !prefix.split('/').some((segment) => segment === '..' || segment === '.') &&
    prefix.length > `${SCREENSHOT_ROOT}user=/`.length &&
    !prefix.includes('\\');
  if (!ok) throw new Error(`refusing to delete by prefix '${prefix}'`);
}
