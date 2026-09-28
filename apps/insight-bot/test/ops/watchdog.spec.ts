import type { StreamHealth } from '../../src/ops/stream-registry';
import { DEFAULT_REPEAT_MS, Watchdog, renderAlert } from '../../src/ops/watchdog';

/**
 * IB-011 — the watchdog's decisions (§6.2). The interesting half of this spec is what it must
 * NOT alert about: a report that cries wolf is worse than none.
 */

const T = Date.UTC(2026, 8, 28, 12, 0, 0);
const MIN = 60_000;

const stream = (over: Partial<StreamHealth> = {}): StreamHealth => ({
  id: 'binance-perp:kline_1m', venue: 'binance', lastMessageAgeSec: 1,
  reconnects24h: 0, gapsOpen: 0, mode: 'ws', degradedReason: null, expectedIntervalSec: null, ...over,
});

describe('Watchdog (§6.2)', () => {
  it('alerts once when a stream passes the threshold, and not before', () => {
    const w = new Watchdog({ silenceMin: 3 });
    expect(w.check([stream({ lastMessageAgeSec: 179 })], T)).toEqual([]);

    const alerts = w.check([stream({ lastMessageAgeSec: 181 })], T + 2_000);
    expect(alerts).toEqual([{ kind: 'silent', streamId: 'binance-perp:kline_1m', venue: 'binance', seconds: 181 }]);
  });

  it('rate-limits to one alert per stream per 30 minutes', () => {
    const w = new Watchdog({ silenceMin: 3 });
    expect(w.check([stream({ lastMessageAgeSec: 200 })], T)).toHaveLength(1);
    expect(w.check([stream({ lastMessageAgeSec: 400 })], T + 10 * MIN)).toEqual([]);
    expect(w.check([stream({ lastMessageAgeSec: 2_000 })], T + DEFAULT_REPEAT_MS)).toHaveLength(1);
  });

  it('sends exactly one recovery message, and only after an alert it actually sent', () => {
    const w = new Watchdog({ silenceMin: 3 });
    w.check([stream({ lastMessageAgeSec: 200 })], T);
    const recovered = w.check([stream({ lastMessageAgeSec: 1 })], T + 5 * MIN);
    expect(recovered.map((a) => a.kind)).toEqual(['recovered']);
    expect(w.check([stream({ lastMessageAgeSec: 1 })], T + 6 * MIN)).toEqual([]); // not again
    expect(w.alerting).toEqual([]);
  });

  it('a healthy stream never produces an alert, so nothing is sent on a good day', () => {
    const w = new Watchdog({ silenceMin: 3 });
    for (let i = 0; i < 200; i++) expect(w.check([stream({ lastMessageAgeSec: 2 })], T + i * 30_000)).toEqual([]);
  });

  describe('refusals to cry wolf', () => {
    it('a DEGRADED stream is not reported silent — it is working on the REST fallback (IB-005)', () => {
      const w = new Watchdog({ silenceMin: 3 });
      const degraded = stream({ mode: 'degraded', degradedReason: 'silent-after-open', lastMessageAgeSec: 2 });
      expect(w.check([degraded], T)).toEqual([]);
      // even the liquidation stream, which genuinely has no data while degraded: /health and its
      // collector_gaps row already say so, and an alert every 30 min would bury the real ones
      const noData = stream({ id: 'binance-perp:forceOrder', mode: 'degraded', degradedReason: 'silence', lastMessageAgeSec: null });
      expect(w.check([noData], T + MIN)).toEqual([]);
    });

    it('a stream that has never spoken gets its window from registration, not from epoch', () => {
      const w = new Watchdog({ silenceMin: 3 });
      const fresh = stream({ lastMessageAgeSec: null });
      expect(w.check([fresh], T)).toEqual([]); // just registered at boot
      expect(w.check([fresh], T + 2 * MIN)).toEqual([]);
      expect(w.check([fresh], T + 4 * MIN)).toHaveLength(1); // now it really has been quiet too long
    });

    it('a POLLER is judged by its own period: 5-minute quiet is normal for a 5-minute poller', () => {
      // found on the IB-011 live run — oi-ls-5m and the calendar (600 s) were alerted on a
      // healthy box, every cycle, because the flat threshold is 3 min
      const w = new Watchdog({ silenceMin: 3 });
      expect(w.check([stream({ id: 'binance-perp:oi-ls-5m', expectedIntervalSec: 300, lastMessageAgeSec: 290 })], T)).toEqual([]);
      // still fine after one missed cycle...
      expect(w.check([stream({ id: 'binance-perp:oi-ls-5m', expectedIntervalSec: 300, lastMessageAgeSec: 550 })], T + MIN)).toEqual([]);
      // ...but two missed cycles is a real stall
      expect(w.check([stream({ id: 'binance-perp:oi-ls-5m', expectedIntervalSec: 300, lastMessageAgeSec: 700 })], T + 2 * MIN)).toHaveLength(1);
    });

    it('a stream that recovers by going degraded does not also emit a recovery message', () => {
      const w = new Watchdog({ silenceMin: 3 });
      w.check([stream({ lastMessageAgeSec: 200 })], T);
      expect(w.check([stream({ mode: 'degraded', lastMessageAgeSec: 1 })], T + MIN)).toEqual([]);
    });
  });

  it('tracks each stream separately', () => {
    const w = new Watchdog({ silenceMin: 3 });
    const alerts = w.check([stream({ lastMessageAgeSec: 500 }), stream({ id: 'bybit:tickers', venue: 'bybit', lastMessageAgeSec: 1 })], T);
    expect(alerts.map((a) => a.streamId)).toEqual(['binance-perp:kline_1m']);
    expect(w.alerting).toEqual(['binance-perp:kline_1m']);
  });
});

describe('renderAlert', () => {
  it('says how long, against what threshold, and what the reader should do', () => {
    const text = renderAlert({ kind: 'silent', streamId: 'bybit:tickers', venue: 'bybit', seconds: 240 }, 3);
    expect(text).toContain('bybit:tickers');
    expect(text).toContain('4 мин');
    expect(text).toContain('порога в 3 мин');
    expect(text).toContain('RUNBOOK');
  });

  it('the recovery message says how long the silence lasted', () => {
    expect(renderAlert({ kind: 'recovered', streamId: 'bybit:tickers', venue: 'bybit', seconds: 600 }, 3)).toContain('Молчал 10 мин');
  });
});
