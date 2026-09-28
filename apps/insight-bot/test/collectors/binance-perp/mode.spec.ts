import { DEFAULT_MODE_POLICY, ModePolicy, degradedWeightPerMinute, klinePollIntervalMs } from '../../../src/collectors/binance-perp/mode';

/**
 * IB-005 / design §16.1 — the WS → degraded → WS transitions. Time is an argument, so every edge
 * is exact: the mute socket the IB-013 probe found, the silence a flowing socket falls into, the
 * 5-minute retry and the recovery on the first message.
 */

const T = 1_727_481_600_000;

describe('ModePolicy (§16.1)', () => {
  it('starts in ws mode and asks for the socket to be opened', () => {
    const p = new ModePolicy();
    expect(p.mode).toBe('ws');
    expect(p.tick(T)).toEqual({ kind: 'reconnect' });
  });

  it('asks for a socket ONCE while the handshake is in flight — no reconnect storm (found live)', () => {
    const p = new ModePolicy();
    expect(p.tick(T)).toEqual({ kind: 'reconnect' }); // the first ask
    for (let s = 1; s < 30; s++) expect(p.tick(T + s * 1_000)).toBeNull(); // ticking every second asks for nothing more
    // a connect that never completes is as mute as one that opens and says nothing
    expect(p.tick(T + 30_000)).toEqual({ kind: 'degrade', reason: 'silent-after-open' });
  });

  it('a socket that closes is left to the socket layer to retry; the policy only counts the silence', () => {
    const p = new ModePolicy();
    p.tick(T); // ask
    p.onOpen(T + 3_000);
    p.onMessage(T + 4_000);
    p.onClosed(T + 5_000);
    expect(p.tick(T + 6_000)).toBeNull(); // PerpSocket is reconnecting with backoff — do not open a second one
    expect(p.tick(T + 5_000 + DEFAULT_MODE_POLICY.silentAfterOpenMs)).toEqual({ kind: 'degrade', reason: 'silent-after-open' });
  });

  it('a socket that opens and never speaks degrades after 30 s, and not a tick before', () => {
    const p = new ModePolicy();
    p.onOpen(T);
    expect(p.tick(T + DEFAULT_MODE_POLICY.silentAfterOpenMs - 1)).toBeNull();
    expect(p.tick(T + DEFAULT_MODE_POLICY.silentAfterOpenMs)).toEqual({ kind: 'degrade', reason: 'silent-after-open' });
    expect(p.mode).toBe('degraded');
    expect(p.reason).toBe('silent-after-open');
  });

  it('a flowing socket degrades only after 90 s of silence — the case the old fallback missed (§16.2)', () => {
    const p = new ModePolicy();
    p.onOpen(T);
    p.onMessage(T + 1_000);
    expect(p.tick(T + 1_000 + DEFAULT_MODE_POLICY.silenceMs - 1)).toBeNull();
    expect(p.tick(T + 1_000 + DEFAULT_MODE_POLICY.silenceMs)).toEqual({ kind: 'degrade', reason: 'silence' });
    expect(p.reason).toBe('silence');
  });

  it('messages keep a flowing socket in ws mode indefinitely', () => {
    const p = new ModePolicy();
    p.onOpen(T);
    for (let i = 1; i <= 10; i++) {
      p.onMessage(T + i * 60_000);
      expect(p.tick(T + i * 60_000 + 1_000)).toBeNull();
    }
    expect(p.mode).toBe('ws');
  });

  it('while degraded it retries the socket every 5 min, not more often', () => {
    const p = new ModePolicy();
    p.onOpen(T);
    p.tick(T + DEFAULT_MODE_POLICY.silentAfterOpenMs); // degrade
    expect(p.tick(T + DEFAULT_MODE_POLICY.silentAfterOpenMs + 1)).toBeNull();
    const retryAt = T + DEFAULT_MODE_POLICY.silentAfterOpenMs + DEFAULT_MODE_POLICY.retryMs;
    expect(p.tick(retryAt)).toEqual({ kind: 'reconnect' });
    expect(p.tick(retryAt + 1)).toBeNull(); // the retry resets the clock
    expect(p.tick(retryAt + DEFAULT_MODE_POLICY.retryMs)).toEqual({ kind: 'reconnect' });
  });

  it('the first message on a retried socket recovers to ws, once', () => {
    const p = new ModePolicy();
    p.onOpen(T);
    p.tick(T + DEFAULT_MODE_POLICY.silentAfterOpenMs);
    const retryAt = T + DEFAULT_MODE_POLICY.silentAfterOpenMs + DEFAULT_MODE_POLICY.retryMs;
    p.tick(retryAt);
    p.onOpen(retryAt);

    expect(p.onMessage(retryAt + 500)).toEqual({ kind: 'recover' });
    expect(p.mode).toBe('ws');
    expect(p.reason).toBeNull();
    expect(p.onMessage(retryAt + 600)).toBeNull(); // no second recovery
    expect(p.tick(retryAt + 1_000)).toBeNull();
  });

  it('degrade → recover → degrade again works, with the right reason each time', () => {
    const p = new ModePolicy();
    p.onOpen(T);
    expect(p.tick(T + 30_000)).toEqual({ kind: 'degrade', reason: 'silent-after-open' });
    const retryAt = T + 30_000 + DEFAULT_MODE_POLICY.retryMs;
    p.tick(retryAt);
    p.onOpen(retryAt);
    p.onMessage(retryAt + 100);
    expect(p.mode).toBe('ws');
    expect(p.tick(retryAt + 100 + DEFAULT_MODE_POLICY.silenceMs)).toEqual({ kind: 'degrade', reason: 'silence' });
  });

  it('a closed socket does not degrade while the socket layer reconnects inside the window', () => {
    const p = new ModePolicy();
    p.onOpen(T);
    p.onMessage(T + 1_000);
    p.onClosed(T + 2_000);
    expect(p.tick(T + 3_000)).toBeNull();
    p.onOpen(T + 4_000); // the socket layer's backoff reconnect succeeded
    p.onMessage(T + 4_500);
    expect(p.tick(T + 5_000)).toBeNull();
    expect(p.mode).toBe('ws');
  });

  it('honours overridden thresholds (the live run uses shorter ones)', () => {
    const p = new ModePolicy({ silentAfterOpenMs: 5_000, silenceMs: 10_000, retryMs: 20_000 });
    p.onOpen(T);
    expect(p.tick(T + 5_000)).toEqual({ kind: 'degrade', reason: 'silent-after-open' });
    expect(p.tick(T + 25_000)).toEqual({ kind: 'reconnect' });
  });
});

describe('degraded polling cadence and its weight (§16.1)', () => {
  it('signal set every 3 s, the rest every 15 s', () => {
    expect(klinePollIntervalMs(true)).toBe(3_000);
    expect(klinePollIntervalMs(false)).toBe(15_000);
  });

  it('a 30-symbol universe with 3 in the signal set costs ~178 weight/min — 7 % of the 2400 budget', () => {
    const weight = degradedWeightPerMinute(3, 27);
    expect(weight).toBe(3 * 20 + 27 * 4 + 10);
    expect(weight).toBe(178);
    expect(weight / 2400).toBeLessThan(0.1);
  });
});
