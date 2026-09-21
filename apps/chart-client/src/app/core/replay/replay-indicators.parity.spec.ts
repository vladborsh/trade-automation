import { vi } from 'vitest';
import type { AheadResponse, Candle, ReplayHistoryResponse, SessionPanel, Timeframe } from '@trade-automation/contracts';
import { INDICATOR_CATALOG, defaultParams } from '@trade-automation/indicators';
import { foldOneMinute } from '@trade-automation/replay-core';
import { ReplayEngine, type ReplayApi } from './replay-engine';
import { ReplayPanelSource } from './replay-panel-source';

/**
 * T-028 parity: after N steps, every catalogue indicator on a replay panel shows exactly what the
 * lib function gives when run directly over the server's bars — `GET …/candles?before=<cursor>`
 * plus the forming bar — over the same bars the panel shows. The tape and fake server follow
 * T-020's parity fixture (replay-engine.spec.ts).
 */
const M = 60_000;
const at = (d: number, h: number, m = 0) => Date.UTC(2026, 8, d, h, m);

function tape(): Candle[] {
  const out: Candle[] = [];
  for (let t = at(18, 12); t < at(19, 0); t += M) {
    const i = t / M;
    const close = 100 + ((i * 7) % 23) * 0.25 + Math.sin(i / 50) * 4;
    out.push({ instrument: 'binance:BTCUSDT', timeframe: '1m', openTime: t, open: close - 0.5, high: close + (i % 5), low: close - (i % 4), close, volume: (i % 11) + 1, closed: true, source: 'storage' });
  }
  return out;
}
const TAPE = tape();
const PERIOD_TO = at(19, 0);

function fakeServer() {
  return {
    history: vi.fn(async (_p: string, tf: Timeframe, before: number, limit: number): Promise<ReplayHistoryResponse> => {
      const { closed, forming } = foldOneMinute(TAPE, tf, before);
      return { bars: closed.slice(-limit), forming };
    }),
    ahead: vi.fn(async (_p: string, fromMs: number, limit: number): Promise<AheadResponse> => {
      const rest = TAPE.filter((c) => c.openTime >= fromMs && c.openTime + M <= PERIOD_TO);
      return { candles: rest.slice(0, limit).map((c) => [c.openTime, c.open, c.high, c.low, c.close, c.volume]), endOfTape: rest.length <= limit };
    }),
    patchTimeframe: vi.fn(async () => undefined),
  } satisfies ReplayApi;
}

const PANEL: SessionPanel = {
  id: 'btc',
  kind: 'candles',
  instrument: 'binance:BTCUSDT',
  signals: false,
  indicators: INDICATOR_CATALOG.map((e) => ({ id: e.id, params: defaultParams(e) })),
};

describe('replay panel indicators: parity with the lib over the server bars (T-028)', () => {
  it.each(['1m', '5m', '15m'] as const)('every catalogue indicator on %s after N steps, and after a timeframe switch', async (tf) => {
    const api = fakeServer();
    const start = at(18, 21, 7); // mid-bar on 5m/15m
    const engine = new ReplayEngine(api, { panels: [PANEL], cursorMs: start, serverCursorMs: start, timeframe: tf, periodToMs: PERIOD_TO, skipWeekends: false });
    await engine.start();
    for (let i = 0; i < 12; i++) await engine.step();
    engine.confirmServerCursor(engine.cursor());

    const check = async (timeframe: Timeframe) => {
      const source = new ReplayPanelSource(PANEL, engine);
      const shown = source.candles();
      const res = await api.history('btc', timeframe, engine.cursor(), 1500);
      const serverBars = [...res.bars, ...(res.forming ? [res.forming] : [])];
      const sameBars = serverBars.slice(-shown.length);
      expect(shown).toEqual(sameBars); // T-020 parity: the panel shows the server's bars
      INDICATOR_CATALOG.forEach((entry, i) => {
        const direct = entry.compute(sameBars, defaultParams(entry));
        const points = source.indicatorPoints().filter((p) => p.seriesId === `${entry.id}-${i}`);
        for (const o of entry.outputs) {
          const panelValues = points.filter((p) => p.values[o.key] !== null).map((p) => ({ time: p.time, value: p.values[o.key] }));
          expect([timeframe, entry.id, o.key, panelValues]).toEqual([timeframe, entry.id, o.key, direct[o.key]]);
        }
        expect(points.every((p) => p.timeframe === timeframe)).toBe(true);
      });
    };
    await check(tf);
    const other: Timeframe = tf === '15m' ? '5m' : '15m';
    await engine.setTimeframe(other);
    await check(other);
  });
});
