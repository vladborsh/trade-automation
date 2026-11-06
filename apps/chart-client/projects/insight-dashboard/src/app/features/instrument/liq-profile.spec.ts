import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { foldProfile, groupRows, profileGrid, type LiqProfilePrint, type WebLiqProfileResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { bandDetail, bandDetailAt, missingVenues, phoneRows, placeBands, stripWidth } from './liq-profile-geometry';
import { coinOf, detailText, outsideView } from './liq-profile-text';
import { answerServes, profileWindow, type ProfileView } from './liq-profile-view';
import { LiqProfileStore, PROFILE_DEBOUNCE_MS } from './liq-profile.store';

/** IB-153 — the liquidation profile on the page: the request a view makes, the strip's shapes, the words, the store. */

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 3, 17, 53, 30);
const LO = 76_200;
const HI = 78_100;

function answer(prints: LiqProfilePrint[], over: Partial<WebLiqProfileResponse> = {}): WebLiqProfileResponse {
  const grid = profileGrid(LO, HI);
  return {
    symbol: 'BTCUSDT', from: NOW - DAY, to: NOW, ...grid, ...foldProfile(groupRows(prints, grid.step), grid),
    venues: [{ venue: 'binance', state: 'recorded' }, { venue: 'bybit', state: 'recorded' }, { venue: 'okx', state: 'not_recorded' }],
    undercounted: true, ...over,
  };
}
const prints: LiqProfilePrint[] = [
  { price: 77_610, side: 'short', venue: 'binance', usd: 300_000 },
  { price: 77_620, side: 'short', venue: 'bybit', usd: 50_000 },
  { price: 77_620, side: 'long', venue: 'bybit', usd: 20_000 },
  { price: 76_900, side: 'long', venue: 'binance', usd: 120_000 },
  { price: 90_000, side: 'short', venue: 'binance', usd: 7_000 }, // above the cover
];

describe('the window a view asks for', () => {
  it('first bar open to last bar close, not past the current minute, at most 90 days', () => {
    const fromSec = (NOW - DAY) / 1000;
    expect(profileWindow(fromSec, (NOW - 10 * MIN) / 1000, 60, NOW)).toEqual({ fromMs: NOW - DAY, toMs: NOW - 9 * MIN });
    // whitespace slots after the last candle do not widen it: clamped to the end of the current minute
    expect(profileWindow(fromSec, (NOW + 3_600_000) / 1000, 60, NOW)!.toMs).toBe(Date.UTC(2026, 10, 3, 17, 54));
    // a two-year weekly view reads its last 90 days
    const w = profileWindow((NOW - 728 * DAY) / 1000, (NOW - 7 * DAY) / 1000, 7 * 86_400, NOW)!;
    expect(w.toMs - w.fromMs).toBe(90 * DAY);
    // all in the future: nothing to read
    expect(profileWindow((NOW + DAY) / 1000, (NOW + 2 * DAY) / 1000, 60, NOW)).toBeNull();
  });

  it('the answer on hand serves the same window and a price span inside its cover, nothing else', () => {
    const a = answer(prints);
    const view: ProfileView = { symbol: 'BTCUSDT', fromMs: a.from, toMs: a.to, lo: LO, hi: HI };
    expect(answerServes(a, view)).toBe(true);
    expect(answerServes(a, { ...view, lo: LO - 300, hi: HI - 300 })).toBe(true); // scrolled down inside
    expect(answerServes(a, { ...view, symbol: 'ETHUSDT' })).toBe(false);
    expect(answerServes(a, { ...view, toMs: a.to + MIN })).toBe(false); // panned
    expect(answerServes(a, { ...view, hi: HI + 3_000 })).toBe(false); // zoomed out: another step
    expect(answerServes(null, view)).toBe(false);
  });
});

describe('the strip and the histogram', () => {
  it('no strip on a phone-wide pane; a bounded share of a desktop one', () => {
    expect(stripWidth(390)).toBe(0);
    expect(stripWidth(700)).toBe(140);
    expect(stripWidth(2_000)).toBe(180);
    expect(stripWidth(610)).toBe(122);
  });

  it('places each band between its edges\' y, scaled to the largest side on screen', () => {
    const a = answer(prints);
    // a linear scale: HI at y 0, LO at y 500
    const toY = (p: number) => ((HI - p) / (HI - LO)) * 500;
    const placed = placeBands(a, toY, 500, 70);
    const band = placed.find((b) => b.band === Math.floor(77_610 / 50))!;
    expect(band.yTop).toBeCloseTo(toY(77_650), 9);
    expect(band.yBottom).toBeCloseTo(toY(77_600), 9);
    expect(band.shortPx).toBeCloseTo(68, 9); // the largest side on screen fills the half strip less 2 px
    expect(band.longPx).toBeCloseTo((20_000 / 350_000) * 68, 9);
    // a band off the pane is not placed
    expect(placeBands(a, (p) => toY(p) - 10_000, 500, 70)).toEqual([]);
  });

  it('the phone rows: every band of the view, high price on top, empties included, the current price marked', () => {
    const a = answer(prints);
    const rows = phoneRows(a, LO, HI, 77_605);
    expect(rows[0]!.price).toBeGreaterThan(rows[rows.length - 1]!.price);
    expect(rows.length).toBe(Math.floor(HI / 50) - Math.floor(LO / 50) + 1);
    const current = rows.filter((r) => r.current);
    expect(current.map((r) => r.price)).toEqual([77_600]);
    expect(current[0]!.shortUsd).toBe(350_000);
    expect(current[0]!.shortShare).toBe(1);
    expect(rows.some((r) => r.longUsd === 0 && r.shortUsd === 0)).toBe(true);
  });

  it('a band\'s details carry the venue split; an empty band is zeros, not missing', () => {
    const a = answer(prints);
    const d = bandDetailAt(a, 77_615);
    expect(d).toMatchObject({ lo: 77_600, hi: 77_650, longUsd: 20_000, shortUsd: 350_000, count: 3 });
    expect(d.venues.map((v) => v.venue)).toEqual(['binance', 'bybit']);
    expect(bandDetail(a, 1)).toMatchObject({ longUsd: 0, shortUsd: 0, count: 0, venues: [] });
  });
});

describe('the words', () => {
  it('a venue that was not listening is «no data» in the details, never $0; one not listed is left out', () => {
    const a = answer(prints, {
      venues: [{ venue: 'binance', state: 'recorded' }, { venue: 'bybit', state: 'no_events' }, { venue: 'okx', state: 'not_recorded' }],
    });
    const text = detailText(a, bandDetailAt(a, 77_615));
    expect(text.range).toBe('77600 – 77650');
    expect(text.venues).toEqual([
      { name: 'Binance', longUsd: '$0', shortUsd: '$300K' },
      { name: 'Bybit', longUsd: '$20K', shortUsd: '$50K' },
      { name: 'OKX', longUsd: null, shortUsd: null },
    ]);
    expect(missingVenues(a)).toEqual(['okx']);
    const unlisted = answer(prints, { venues: [{ venue: 'binance', state: 'recorded' }, { venue: 'bybit', state: 'recorded' }, { venue: 'okx', state: 'not_listed' }] });
    expect(detailText(unlisted, bandDetailAt(unlisted, 77_615)).venues.map((v) => v.name)).toEqual(['Binance', 'Bybit']);
    expect(missingVenues(unlisted)).toEqual([]);
  });

  it('money outside the visible prices is said, beyond the cover included; none, no line', () => {
    const a = answer(prints);
    expect(outsideView(a, 77_000, HI)).toEqual({ above: '$7K', below: '$120K' });
    expect(outsideView(answer(prints.slice(0, 4)), LO, HI)).toBeNull();
    expect(outsideView(a, LO, HI)).toEqual({ above: '$7K', below: null }); // a side with none is not said
  });

  it('the link names the coin, not the pair', () => {
    expect(coinOf('BTCUSDT')).toBe('BTC');
    expect(coinOf('1000PEPEUSDT')).toBe('1000PEPE');
    expect(coinOf('USDT')).toBe('USDT');
  });
});

describe('LiqProfileStore — no storm on pan or zoom', () => {
  afterEach(() => vi.useRealTimers());

  function store(read: (...args: unknown[]) => Promise<WebLiqProfileResponse>) {
    TestBed.configureTestingModule({ providers: [LiqProfileStore, { provide: InsightApiClient, useValue: { liquidationProfile: read } }] });
    return TestBed.inject(LiqProfileStore);
  }
  const view = (over: Partial<ProfileView> = {}): ProfileView => ({ symbol: 'BTCUSDT', fromMs: NOW - DAY, toMs: NOW, lo: LO, hi: HI, ...over });

  it('a burst of views makes ONE read, for the last of them, after the quiet time', async () => {
    vi.useFakeTimers();
    const calls: unknown[][] = [];
    const s = store(async (...args) => { calls.push(args); return answer(prints); });
    for (let i = 0; i < 20; i++) s.setView(view({ toMs: NOW - (20 - i) * MIN }));
    await vi.advanceTimersByTimeAsync(PROFILE_DEBOUNCE_MS - 1);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([['BTCUSDT', NOW - DAY, NOW - MIN, LO, HI]]);
  });

  it('a view the answer still serves reads nothing; an answer for a view left behind is dropped', async () => {
    vi.useFakeTimers();
    let release: (a: WebLiqProfileResponse) => void = () => undefined;
    const reads: number[] = [];
    const s = store((_sym, _from, to) => { reads.push(to as number); return new Promise((r) => (release = r)); });
    s.setView(view());
    await vi.advanceTimersByTimeAsync(PROFILE_DEBOUNCE_MS);
    release(answer(prints));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.answer()?.to).toBe(NOW);
    s.setView(view({ lo: LO - 200, hi: HI - 200 })); // a vertical scroll inside the cover
    await vi.advanceTimersByTimeAsync(PROFILE_DEBOUNCE_MS * 2);
    expect(reads).toEqual([NOW]);

    s.setView(view({ toMs: NOW - MIN })); // pan: a read starts…
    await vi.advanceTimersByTimeAsync(PROFILE_DEBOUNCE_MS);
    s.setView(view()); // …and the reader pans back to what the answer on hand serves
    release(answer(prints, { to: NOW - MIN }));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.answer()?.to).toBe(NOW);
  });

  it('a symbol switch clears the last coin\'s bars at once; a failed read says so', async () => {
    vi.useFakeTimers();
    let fail = false;
    const s = store(async () => { if (fail) throw new Error('503'); return answer(prints); });
    s.setView(view());
    await vi.advanceTimersByTimeAsync(PROFILE_DEBOUNCE_MS);
    expect(s.answer()).not.toBeNull();
    fail = true;
    s.setView(view({ symbol: 'ETHUSDT' }));
    expect(s.answer()).toBeNull();
    await vi.advanceTimersByTimeAsync(PROFILE_DEBOUNCE_MS);
    expect(s.failed()).toBe(true);
  });
});
