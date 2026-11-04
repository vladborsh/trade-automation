import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OI_DIVERGENCE_DEFAULT_PARAMS, type OiDivergenceDirection, type OiDivergenceTf, type WebAlertSettings } from '@trade-automation/contracts';
import { oiDivergenceAlert } from '../../../src/delivery/templates/oi-divergence.texts';
import { OiAlertLoop, type OiAlertLoopPorts } from '../../../src/alerts/oi-divergence/oi-alert-loop';
import type { NewOiAlert, NewOiSkip, OiAlertRecipient, OiAlertStore, OutcomeDue } from '../../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import type { Bar } from '../../../src/insights/divergence/detector';

/**
 * IB-112 — the alert loop on REAL data: dev-1's positive control (ETHUSDT 1h, Binance's own bars and
 * OI, a bullish divergence confirmed at 1792296000) replayed through the loop with an in-memory store
 * that enforces the journal's once-key exactly as migration 025 does. What is checked is the loop's
 * contract: journal always, send only on time and only when switched on, never twice.
 */
interface Fixture { bars: Bar[]; oi5m: Array<{ time: number; oi: number }>; expected: { aTime: number; bTime: number; pricePct: number; oiPct: number } }
const F: Fixture = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'binance', 'oi-divergence-ethusdt-1h-bullish.json'), 'utf8'));
const CONFIRMED = 1_792_296_000; // the close of the bar that confirms the pair (B + N + 1 bars)
const H = 3_600;

class MemoryStore implements OiAlertStore {
  settingsRow: WebAlertSettings = { enabled: false, membersVisible: false, params: OI_DIVERGENCE_DEFAULT_PARAMS, updatedBy: null, updatedAt: 0 };
  symbols = ['ETHUSDT'];
  alerts: Array<NewOiAlert & { id: number; firedAt: number | null; recipients: number; priceAtFire: number | null; price4h: number | null; price24h: number | null; outcomeAt: number | null }> = [];
  skips: NewOiSkip[] = [];
  users: OiAlertRecipient[] = [{ userId: 1, chatId: 111, lang: 'ru' }, { userId: 2, chatId: 222, lang: 'en' }];
  async settings() { return this.settingsRow; }
  async enabledSymbols() { return this.symbols; }
  async insertAlert(x: NewOiAlert) {
    // migration 025's once-key: (symbol, tf, direction, a_time, b_time)
    if (this.alerts.some((a) => a.symbol === x.symbol && a.tf === x.tf && a.direction === x.direction && a.a.time === x.a.time && a.b.time === x.b.time)) return null;
    const id = this.alerts.length + 1;
    this.alerts.push({ ...x, id, firedAt: null, recipients: 0, priceAtFire: null, price4h: null, price24h: null, outcomeAt: null });
    return id;
  }
  async runFirstId(symbol: string, tf: OiDivergenceTf, direction: OiDivergenceDirection, bTime: number) {
    return this.alerts.find((a) => a.symbol === symbol && a.tf === tf && a.direction === direction && a.b.time === bTime)?.id ?? null;
  }
  async markFired(id: number, firedAt: number, recipients: number, priceAtFire: number | null) {
    Object.assign(this.alerts[id - 1] as object, { firedAt, recipients, priceAtFire });
  }
  async insertSkip(x: NewOiSkip) {
    if (this.skips.some((s) => s.symbol === x.symbol && s.tf === x.tf && s.barTime === x.barTime)) return false;
    this.skips.push(x);
    return true;
  }
  async recipients() { return this.users; }
  async outcomesDue(now: number): Promise<OutcomeDue[]> {
    return this.alerts.filter((a) => a.firedAt !== null && a.outcomeAt === null && ((a.price4h === null && a.firedAt + 4 * H <= now) || (a.price24h === null && a.firedAt + 24 * H <= now)))
      .map((a) => ({ id: a.id, symbol: a.symbol, firedAt: a.firedAt as number, price4h: a.price4h, price24h: a.price24h }));
  }
  async setOutcome(id: number, field: 'price_4h' | 'price_24h', price: number, completeAt: number | null) {
    const a = this.alerts[id - 1] as (typeof this.alerts)[number];
    if (field === 'price_4h') a.price4h = price; else a.price24h = price;
    if (completeAt !== null) a.outcomeAt = completeAt;
  }
}

function loop(store: MemoryStore, over: Partial<OiAlertLoopPorts> = {}) {
  const sent: Array<{ chatId: number; text: string }> = [];
  const klineCalls: Array<[string, OiDivergenceTf, number, number]> = [];
  const ports: OiAlertLoopPorts = {
    store,
    // the venue: closed bars with open in [from, to) — only the 1h fixture exists, other TFs have none
    klines: async (symbol, tf, from, to) => { klineCalls.push([symbol, tf, from, to]); return tf === '1h' ? F.bars.filter((b) => b.time >= from && b.time < to) : []; },
    oiWindow: async (_s, from, to) => ({ oi5m: F.oi5m.filter((o) => o.time > from && o.time <= to), venueSilent: [] }),
    closeAt: async (_s, at) => 2_000 + (at % 7),
    send: async (chatId, text) => { sent.push({ chatId, text }); return chatId !== 999; },
    webBaseUrl: 'https://box.example',
    ...over,
  };
  return { loop: new OiAlertLoop(ports), sent, klineCalls };
}

describe('IB-112: the OI divergence loop on the real ETHUSDT 1h divergence', () => {
  it('switched OFF (the default): the divergence is journalled, nothing is sent', async () => {
    const store = new MemoryStore();
    const { loop: l, sent } = loop(store);
    const r = await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    expect(r).toMatchObject({ journalled: 1, late: 0, sent: 0, failed: [] });
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0]).toMatchObject({ symbol: 'ETHUSDT', tf: '1h', direction: 'bullish', late: false, firedAt: null, runLength: 2, runOf: null, confirmedAt: CONFIRMED });
    expect(store.alerts[0]?.a.time).toBe(F.expected.aTime);
    expect(store.alerts[0]?.b.time).toBe(F.expected.bTime);
    expect(store.alerts[0]?.params).toEqual(OI_DIVERGENCE_DEFAULT_PARAMS); // the row keeps the params it was made with
    expect(sent).toEqual([]);
  });

  it('switched ON: sent once to each recipient in their language, with the link; the row records who got it and the price', async () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, enabled: true };
    const { loop: l, sent } = loop(store);
    await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    const text = oiDivergenceAlert({ symbol: 'ETHUSDT', base: 'ETH', tf: '1h', direction: 'bullish', pricePct: F.expected.pricePct, oiPct: F.expected.oiPct, runLength: 2, bTime: F.expected.bTime }, 'https://box.example');
    expect(sent.map((s) => s.chatId)).toEqual([111, 222]);
    // the percentages are the detector's exact values; the fixture rounds them to 4 places
    expect(sent[0]?.text.split('\n')[0]).toBe(text.ru.split('\n')[0]);
    expect(sent[1]?.text.split('\n')[0]).toBe(text.en.split('\n')[0]);
    expect(sent[0]?.text).toContain(`https://box.example/instrument/ETHUSDT?at=${F.expected.bTime}&tf=1h`);
    const lastClose = F.bars.filter((b) => b.time + H <= CONFIRMED).at(-1)?.close;
    expect(store.alerts[0]).toMatchObject({ firedAt: CONFIRMED + 6 * 60, recipients: 2, priceAtFire: lastClose });
  });

  it('a restart re-evaluating the same bar journals nothing new and sends nothing twice (V8)', async () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, enabled: true };
    await loop(store).loop.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    const again = loop(store); // a new process: no memory of the first
    const r = await again.loop.evaluate('1h', CONFIRMED, CONFIRMED + 7 * 60);
    expect(r).toMatchObject({ journalled: 0, sent: 0 });
    expect(again.sent).toEqual([]);
    expect(store.alerts).toHaveLength(1);
  });

  it('LATE (the box was down): evaluated more than a bar + 10 min after confirmation → journalled late, never sent (V10)', async () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, enabled: true };
    const { loop: l, sent } = loop(store);
    const r = await l.evaluate('1h', CONFIRMED, CONFIRMED + H + 10 * 60 + 1);
    expect(r).toMatchObject({ journalled: 1, late: 1, sent: 0 });
    expect(store.alerts[0]).toMatchObject({ late: true, firedAt: null });
    expect(sent).toEqual([]);
  });

  it('one bar later (the next evaluation) the same divergence is no longer in the guarded range: not journalled twice, not missed', async () => {
    const store = new MemoryStore();
    const { loop: l } = loop(store);
    await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    const r = await l.evaluate('1h', CONFIRMED + H, CONFIRMED + H + 6 * 60);
    expect(r.journalled).toBe(0);
    expect(store.alerts).toHaveLength(1);
  });

  it('a hole in OI the venue did not cause → a skip, logged once, and no alert (V9)', async () => {
    const store = new MemoryStore();
    const holeFrom = F.expected.bTime - 2 * H;
    const { loop: l } = loop(store, { oiWindow: async (_s, from, to) => ({ oi5m: F.oi5m.filter((o) => o.time > from && o.time <= to && (o.time < holeFrom || o.time > holeFrom + 1_800)), venueSilent: [] }) });
    const r = await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    expect(r.journalled).toBe(0);
    expect(r.skips).toBeGreaterThan(0);
    const again = await l.evaluate('1h', CONFIRMED, CONFIRMED + 7 * 60);
    expect(again.skips).toBe(0); // once per (symbol, TF, bar)
  });

  it('…and the same slots marked «the venue did not publish» are not a hole: the alert stands', async () => {
    const store = new MemoryStore();
    const holeFrom = F.expected.bTime - 2 * H;
    const { loop: l } = loop(store, {
      oiWindow: async (_s, from, to) => ({ oi5m: F.oi5m.filter((o) => o.time > from && o.time <= to && (o.time < holeFrom || o.time > holeFrom + 1_800)), venueSilent: [{ from: holeFrom, to: holeFrom + 1_800 }] }),
    });
    const r = await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    expect(r).toMatchObject({ journalled: 1, skips: 0 });
  });

  it('reads barsForEvaluation + W closed bars (185 + 168 = 353 on 1h, round-2 defaults), ending at the due close; fewer than barsForEvaluation → not evaluated', async () => {
    const store = new MemoryStore();
    const { loop: l, klineCalls } = loop(store);
    await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    expect(klineCalls).toEqual([['ETHUSDT', '1h', CONFIRMED - 353 * H, CONFIRMED]]);
    const young = new MemoryStore();
    const short = loop(young, { klines: async (_s, _tf, _from, to) => F.bars.filter((b) => b.time >= to - 184 * H && b.time < to) });
    expect(await short.loop.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60)).toMatchObject({ journalled: 0, failed: [] });
    // a coin with exactly barsForEvaluation bars (younger than the + W) is evaluated: the venue has no earlier run
    const exact = loop(new MemoryStore(), { klines: async (_s, _tf, _from, to) => F.bars.filter((b) => b.time >= to - 185 * H && b.time < to) });
    expect(await exact.loop.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60)).toMatchObject({ journalled: 1, failed: [] });
  });

  it('the coin list is re-read each evaluation, and a failing coin does not stop the others', async () => {
    const store = new MemoryStore();
    store.symbols = ['BROKENUSDT', 'ETHUSDT'];
    const { loop: l } = loop(store, {
      klines: async (symbol, tf, from, to) => { if (symbol === 'BROKENUSDT') throw new Error('venue 503'); return tf === '1h' ? F.bars.filter((b) => b.time >= from && b.time < to) : []; },
    });
    const r = await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    expect(r).toMatchObject({ journalled: 1, failed: ['BROKENUSDT'] });
    store.symbols = [];
    expect((await l.evaluate('1h', CONFIRMED + H, CONFIRMED + H + 6 * 60)).journalled).toBe(0);
  });

  it('params come from the settings row at each evaluation (a change applies from the next one)', async () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, params: { ...OI_DIVERGENCE_DEFAULT_PARAMS, oiMedianMult: 50 } }; // an OI threshold nothing passes
    const { loop: l } = loop(store);
    expect((await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60)).journalled).toBe(0);
  });
});

describe('IB-112: scheduling and outcomes', () => {
  it('tick evaluates each TF once per due bar close (close + 6 min), and not before', async () => {
    const store = new MemoryStore();
    const { loop: l } = loop(store);
    const at = CONFIRMED + 6 * 60;
    expect((await l.tick(at)).map((r) => [r.tf, r.barClose])).toEqual([['15m', CONFIRMED], ['1h', CONFIRMED], ['4h', CONFIRMED - (CONFIRMED % 14_400)]]);
    expect(await l.tick(at + 60)).toEqual([]);
    expect((await l.tick(CONFIRMED + 15 * 60 + 6 * 60)).map((r) => r.tf)).toEqual(['15m']);
  });

  it('fills the +4 h and +24 h closes of SENT alerts, each when due, and closes the row when both are in (V12)', async () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, enabled: true };
    const { loop: l } = loop(store, { closeAt: async (_s, at) => (at === CONFIRMED + 6 * 60 + 4 * H ? 2_100 : at === CONFIRMED + 6 * 60 + 24 * H ? 1_950 : null) });
    await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    const fired = CONFIRMED + 6 * 60;
    expect(await l.fillOutcomes(fired + 3 * H)).toBe(0);
    expect(await l.fillOutcomes(fired + 4 * H + 30)).toBe(1);
    expect(store.alerts[0]).toMatchObject({ price4h: 2_100, price24h: null, outcomeAt: null });
    expect(await l.fillOutcomes(fired + 24 * H + 30)).toBe(1);
    expect(store.alerts[0]).toMatchObject({ price24h: 1_950, outcomeAt: fired + 24 * H + 30 });
  });

  it('an unsent (journal-only) alert gets no outcome fetch', async () => {
    const store = new MemoryStore();
    let calls = 0;
    const { loop: l } = loop(store, { closeAt: async () => { calls++; return 1; } });
    await l.evaluate('1h', CONFIRMED, CONFIRMED + 6 * 60);
    await l.fillOutcomes(CONFIRMED + 30 * H);
    expect(calls).toBe(0);
  });
});
