import * as fs from 'fs';
import * as path from 'path';
import { ScreenshotObject, ScreenshotStore, assertScreenshotPrefix } from '../screenshot-store.port';

/**
 * architecture/backtest-app-system-design.md §9.2 — screenshots as files under FILE_STORE_ROOT,
 * at the same relative path as the S3 key (like FileCandleStore mirrors the candle bucket).
 * Every key and prefix is resolved under the root, and anything that escapes it is refused.
 */
export class FileScreenshotStore implements ScreenshotStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** The absolute path for `key`, or an error when it would leave the root. */
  private resolve(key: string): string {
    if (key.length === 0 || path.isAbsolute(key) || key.includes('\0')) throw new Error(`invalid screenshot key '${key}'`);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error(`screenshot key escapes the store root: '${key}'`);
    return full;
  }

  async put(key: string, bytes: Buffer, _contentType: string): Promise<void> {
    const file = this.resolve(key);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    // write-then-rename so a reader never sees a half-written PNG
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmp, bytes);
    await fs.promises.rename(tmp, file);
  }

  async get(key: string): Promise<ScreenshotObject | null> {
    try {
      return { bytes: await fs.promises.readFile(this.resolve(key)), contentType: 'image/png' };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    assertScreenshotPrefix(prefix);
    const dir = this.resolve(prefix.slice(0, -1));
    const count = await countFiles(dir);
    await fs.promises.rm(dir, { recursive: true, force: true });
    return count;
  }
}

async function countFiles(dir: string): Promise<number> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  let n = 0;
  for (const e of entries) n += e.isDirectory() ? await countFiles(path.join(dir, e.name)) : 1;
  return n;
}
