import { LiveGateway } from '../../src/api/ws/live.gateway';
import { MetricCache } from '../../src/market-data/metrics/metric-cache.service';
import { FakeAuthRepositories, fastHasher, makeAuthService } from '../auth/fake-auth';

class FakeSocket {
  readyState = 1;
  sent: { type: string }[] = [];
  closed = false;
  private handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
  }
  on(event: string, cb: (...args: unknown[]) => void): void {
    (this.handlers[event] ??= []).push(cb);
  }
  emitMessage(payload: unknown): void {
    for (const cb of this.handlers['message'] ?? []) cb(JSON.stringify(payload));
  }
}

const flush = () => new Promise((r) => setImmediate(r));
const metrics = () => ({ wsClients: { set: jest.fn() }, wsFramesSent: { inc: jest.fn() } }) as never;
const config = (env: Record<string, string> = {}) => ({ env: { get: (k: string) => env[k] } }) as never;
const request = (headers: Record<string, string> = {}, url = '/') => ({ headers, url }) as never;

/** backtest-app-system-design.md §7.1 — WS handleConnection checks the bt_session cookie when the DB is enabled. */
describe('LiveGateway connection auth', () => {
  describe('DB enabled: bt_session cookie', () => {
    let gateway: LiveGateway;
    let cookie: string;

    beforeEach(async () => {
      const repos = new FakeAuthRepositories();
      repos.addUser('alice@x.test', await fastHasher().hash('alice-password'));
      const auth = makeAuthService(repos);
      cookie = `bt_session=${(await auth.login('alice@x.test', 'alice-password', null)).token}`;
      // WS_SHARED_TOKEN is ignored once cookies are in force
      gateway = new LiveGateway({} as never, config({ WS_SHARED_TOKEN: 'shh' }), metrics(), new MetricCache(), auth);
    });

    it('accepts a valid cookie and replays a frame sent before the session check resolved', async () => {
      const socket = new FakeSocket();
      gateway.handleConnection(socket, request({ cookie: `other=1; ${cookie}` }));
      socket.emitMessage({ type: 'ping' }); // arrives while the lookup is in flight
      await flush();
      expect(socket.closed).toBe(false);
      expect(socket.sent.map((m) => m.type)).toEqual(['pong']);
    });

    it.each([
      ['no cookie', {}],
      ['an unknown session', { cookie: 'bt_session=bogus' }],
    ])('rejects %s and never answers its frames', async (_label, headers) => {
      const socket = new FakeSocket();
      gateway.handleConnection(socket, request(headers));
      socket.emitMessage({ type: 'ping' });
      await flush();
      expect(socket.sent).toEqual([{ type: 'error', message: 'unauthorized' }]);
      expect(socket.closed).toBe(true);
    });
  });

  describe('DB disabled: the WS_SHARED_TOKEN check stays', () => {
    const disabledAuth = () => makeAuthService(null);

    it('requires ?token= when WS_SHARED_TOKEN is set', () => {
      const gateway = new LiveGateway({} as never, config({ WS_SHARED_TOKEN: 'shh' }), metrics(), new MetricCache(), disabledAuth());
      const bad = new FakeSocket();
      gateway.handleConnection(bad, request({}, '/?token=nope'));
      expect(bad.closed).toBe(true);

      const good = new FakeSocket();
      gateway.handleConnection(good, request({}, '/?token=shh'));
      good.emitMessage({ type: 'ping' });
      expect(good.sent.map((m) => m.type)).toEqual(['pong']); // synchronous, as before
    });

    it('accepts everyone when no shared token is configured', () => {
      const gateway = new LiveGateway({} as never, config(), metrics(), new MetricCache(), disabledAuth());
      const socket = new FakeSocket();
      gateway.handleConnection(socket, request());
      socket.emitMessage({ type: 'ping' });
      expect(socket.sent.map((m) => m.type)).toEqual(['pong']);
    });
  });
});
