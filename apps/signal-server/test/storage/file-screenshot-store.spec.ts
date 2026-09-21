import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileScreenshotStore } from '../../src/storage/file/file-screenshot-store';
import { screenshotKey, sessionScreenshotPrefix } from '../../src/storage/screenshot-store.port';

const U = '00000000-0000-4000-8000-00000000000a';
const S1 = '00000000-0000-4000-8000-0000000000b1';
const S2 = '00000000-0000-4000-8000-0000000000b2';
const O = '00000000-0000-4000-8000-00000000000c';

describe('FileScreenshotStore (tmp dir)', () => {
  let root: string;
  let store: FileScreenshotStore;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-store-'));
    store = new FileScreenshotStore(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('put/get round-trips the bytes at the key’s relative path under the root', async () => {
    const key = screenshotKey(U, S1, O, 'entry');
    const bytes = Buffer.from([0x89, 1, 2, 3, 255]);
    await store.put(key, bytes, 'image/png');
    expect(fs.readFileSync(path.join(root, key))).toEqual(bytes);
    await expect(store.get(key)).resolves.toEqual({ bytes, contentType: 'image/png' });
    await expect(store.get(screenshotKey(U, S1, O, 'exit'))).resolves.toBeNull();
    expect(fs.readdirSync(path.dirname(path.join(root, key)))).toEqual(['entry.png']); // no temp file left
  });

  it('deleteByPrefix removes exactly the session’s objects and counts them', async () => {
    await store.put(screenshotKey(U, S1, O, 'entry'), Buffer.from('a'), 'image/png');
    await store.put(screenshotKey(U, S1, O, 'exit'), Buffer.from('b'), 'image/png');
    await store.put(screenshotKey(U, S2, O, 'entry'), Buffer.from('c'), 'image/png');
    await expect(store.deleteByPrefix(sessionScreenshotPrefix(U, S1))).resolves.toBe(2);
    await expect(store.get(screenshotKey(U, S1, O, 'entry'))).resolves.toBeNull();
    await expect(store.get(screenshotKey(U, S2, O, 'entry'))).resolves.not.toBeNull();
    await expect(store.deleteByPrefix(sessionScreenshotPrefix(U, S1))).resolves.toBe(0); // already gone
  });

  it('refuses a key that escapes the root, and a broad prefix, before touching the disk', async () => {
    const outside = path.join(root, '..', 'escaped.png');
    await expect(store.put('../escaped.png', Buffer.from('x'), 'image/png')).rejects.toThrow(/escapes the store root/);
    await expect(store.put('backtest/../../escaped.png', Buffer.from('x'), 'image/png')).rejects.toThrow(/escapes/);
    await expect(store.put(outside, Buffer.from('x'), 'image/png')).rejects.toThrow(/invalid screenshot key/);
    await expect(store.get('../../etc/passwd')).rejects.toThrow(/escapes/);
    expect(fs.existsSync(outside)).toBe(false);
    for (const prefix of ['', 'backtest/screenshots/', `backtest/screenshots/user=${U}/../`]) {
      await expect(store.deleteByPrefix(prefix)).rejects.toThrow(/refusing/);
    }
  });
});
