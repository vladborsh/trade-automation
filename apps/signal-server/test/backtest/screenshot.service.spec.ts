import { HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Readable } from 'stream';
import { OrderService } from '../../src/backtest/order.service';
import { MAX_SCREENSHOT_BYTES, ScreenshotService } from '../../src/backtest/screenshot.service';
import { screenshotKey, sessionScreenshotPrefix } from '../../src/storage/screenshot-store.port';
import { DAY, FakeBacktestRepositories, FakeScreenshotStore, T0, createBody, fakeStore, makeSessionService } from './fake-backtest';
import { makePng } from './png-fixture';
import { expectSameBytes } from '../bytes';

const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';

const config = (maxWidth = 1280) => ({ env: { get: (k: string) => (k === 'SCREENSHOT_MAX_WIDTH_PX' ? maxWidth : undefined) } }) as never;

function upload(bytes: Buffer, contentType = 'image/png', declared: string | undefined = String(bytes.length)) {
  let read = false;
  const body = Readable.from((async function* () {
    read = true;
    yield bytes;
  })());
  return { upload: { contentType, contentLength: declared, body }, wasRead: () => read };
}

async function statusOf(p: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await p;
  } catch (err) {
    const e = err as HttpException;
    return { status: e.getStatus(), body: e.getResponse() };
  }
  throw new Error('expected a rejection');
}

describe('ScreenshotService (design §7.2, §9.2)', () => {
  let repos: FakeBacktestRepositories;
  let store: FakeScreenshotStore;
  let service: ScreenshotService;
  let sessionId: string;
  let orderId: string;
  let placedAtMs: number;

  beforeEach(async () => {
    repos = new FakeBacktestRepositories();
    store = new FakeScreenshotStore();
    service = new ScreenshotService(repos, store, config());
    const session = await makeSessionService(repos).create(ALICE, createBody());
    sessionId = session.id;
    placedAtMs = T0 + 5 * DAY + 60_000;
    const order = await repos.orders.insert({
      sessionId,
      seq: 1,
      panelId: 'btc',
      instrument: 'binance:BTCUSDT',
      side: 'long',
      type: 'market',
      status: 'open',
      placedAtMs,
      limitPrice: null,
      entryPrice: 100,
      entryTimeMs: placedAtMs - 60_000,
      qty: 1,
      riskPct: 1,
      riskAmountCcy: 100,
      sl: 90,
      tp: null,
      fillResolution: '1m',
    });
    orderId = order.id;
  });

  it('stores a PNG once: key, dimensions, bytes, the row, and captured_at = placement for entry', async () => {
    const png = makePng(640, 360);
    const res = await service.put(ALICE, sessionId, orderId, 'entry', upload(png).upload);
    const key = screenshotKey(ALICE, sessionId, orderId, 'entry');
    expect(res).toEqual({ key, width: 640, height: 360, bytes: png.length });
    expectSameBytes(store.objects.get(key)?.bytes, png);
    expect(await repos.screenshots.find(orderId, 'entry')).toMatchObject({ storeKey: key, widthPx: 640, heightPx: 360, bytes: png.length, capturedAtMs: placedAtMs });
    expectSameBytes(await service.get(ALICE, sessionId, orderId, 'entry'), png);
  });

  it('a second upload is 409 SCREENSHOT_EXISTS and its body is never read', async () => {
    await service.put(ALICE, sessionId, orderId, 'entry', upload(makePng(10, 10, 1)).upload);
    const second = upload(makePng(10, 10, 2));
    expect(await statusOf(service.put(ALICE, sessionId, orderId, 'entry', second.upload))).toEqual({
      status: 409,
      body: { error: { code: 'SCREENSHOT_EXISTS', message: expect.any(String) } },
    });
    expect(second.wasRead()).toBe(false);
    expectSameBytes(store.objects.get(screenshotKey(ALICE, sessionId, orderId, 'entry'))?.bytes, makePng(10, 10, 1));
    // the other kind is its own slot
    await expect(service.put(ALICE, sessionId, orderId, 'exit', upload(makePng(10, 10, 3)).upload)).resolves.toMatchObject({ width: 10 });
  });

  it('validates the upload: 415 media type, 413 over 2 MB (declared or streamed), 400 not a PNG, 400 too wide, 400 bad kind', async () => {
    expect((await statusOf(service.put(ALICE, sessionId, orderId, 'entry', upload(makePng(5, 5), 'image/jpeg').upload))).status).toBe(415);
    const big = upload(Buffer.alloc(10), 'image/png', String(MAX_SCREENSHOT_BYTES + 1));
    expect((await statusOf(service.put(ALICE, sessionId, orderId, 'entry', big.upload))).status).toBe(413);
    expect(big.wasRead()).toBe(false);
    expect((await statusOf(service.put(ALICE, sessionId, orderId, 'entry', upload(Buffer.alloc(MAX_SCREENSHOT_BYTES + 1), 'image/png', undefined).upload))).status).toBe(413);
    expect((await statusOf(service.put(ALICE, sessionId, orderId, 'entry', upload(Buffer.from('not a png, really not')).upload))).status).toBe(400);
    const narrow = new ScreenshotService(repos, store, config(100));
    expect(await statusOf(narrow.put(ALICE, sessionId, orderId, 'entry', upload(makePng(101, 10)).upload))).toMatchObject({ status: 400, body: { message: expect.stringMatching(/at most 100 px wide/) } });
    expect((await statusOf(service.put(ALICE, sessionId, orderId, 'thumb', upload(makePng(5, 5)).upload))).status).toBe(400);
    expect(store.objects.size).toBe(0);
    expect(repos.screenshotRows.size).toBe(0);
  });

  it('another user’s session or an unknown order is 404, and nothing is read or written', async () => {
    const u = upload(makePng(5, 5));
    await expect(service.put(BOB, sessionId, orderId, 'entry', u.upload)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.put(ALICE, sessionId, '00000000-0000-4000-8000-00000000dead', 'entry', u.upload)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.put(ALICE, 'nope', orderId, 'entry', u.upload)).rejects.toBeInstanceOf(NotFoundException);
    expect(u.wasRead()).toBe(false);
    await service.put(ALICE, sessionId, orderId, 'entry', upload(makePng(5, 5)).upload);
    await expect(service.get(BOB, sessionId, orderId, 'entry')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.get(ALICE, sessionId, orderId, 'exit')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a failed store write is a 500 (the Postgres spec proves the claim rolls back)', async () => {
    store.failNext.put = new Error('disk full');
    expect((await statusOf(service.put(ALICE, sessionId, orderId, 'entry', upload(makePng(5, 5)).upload))).status).toBe(500);
  });

  it('GET …/orders/:orderId lists the stored screenshots as relative API URLs', async () => {
    const orders = new OrderService(repos, fakeStore());
    expect((await orders.get(ALICE, sessionId, orderId)).screenshots).toEqual({});
    await service.put(ALICE, sessionId, orderId, 'entry', upload(makePng(5, 5)).upload);
    expect((await orders.get(ALICE, sessionId, orderId)).screenshots).toEqual({
      entry: `/api/backtest/sessions/${sessionId}/orders/${orderId}/screenshots/entry`,
    });
  });

  it('503 without a database', async () => {
    const off = new ScreenshotService(null, store, config());
    await expect(off.put(ALICE, sessionId, orderId, 'entry', upload(makePng(5, 5)).upload)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(off.get(ALICE, sessionId, orderId, 'entry')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('SessionService.delete: screenshot prefix first, then the row (design §3, decision 30b)', () => {
  it('deletes the session’s prefix, then the row', async () => {
    const repos = new FakeBacktestRepositories();
    const store = new FakeScreenshotStore();
    const sessions = makeSessionService(repos, fakeStore(), store);
    const s = await sessions.create(ALICE, createBody());
    store.objects.set(`${sessionScreenshotPrefix(ALICE, s.id)}order=00000000-0000-4000-8000-00000000000c/entry.png`, { bytes: Buffer.from('x'), contentType: 'image/png' });
    await sessions.delete(ALICE, s.id);
    expect(store.deletedPrefixes).toEqual([sessionScreenshotPrefix(ALICE, s.id)]);
    expect(store.objects.size).toBe(0);
    expect(repos.rows.has(s.id)).toBe(false);
  });

  it('a failed prefix delete answers 500 and leaves the session in place', async () => {
    const repos = new FakeBacktestRepositories();
    const store = new FakeScreenshotStore();
    const sessions = makeSessionService(repos, fakeStore(), store);
    const s = await sessions.create(ALICE, createBody());
    store.failNext.deleteByPrefix = new Error('S3 unavailable');
    const err = (await sessions.delete(ALICE, s.id).catch((e) => e)) as HttpException;
    expect(err.getStatus()).toBe(500);
    expect(repos.rows.has(s.id)).toBe(true);
    await sessions.delete(ALICE, s.id); // the retry succeeds
    expect(repos.rows.has(s.id)).toBe(false);
  });

  it('another user’s session is a 404 and its prefix is never touched', async () => {
    const repos = new FakeBacktestRepositories();
    const store = new FakeScreenshotStore();
    const sessions = makeSessionService(repos, fakeStore(), store);
    const s = await sessions.create(ALICE, createBody());
    await expect(sessions.delete(BOB, s.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(store.deletedPrefixes).toEqual([]);
  });
});
