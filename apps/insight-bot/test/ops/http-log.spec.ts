import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { INestApplication, Logger as NestLogger, Module, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger, LoggerModule } from 'nestjs-pino';
import { loggerModuleParams, REDACTED, scrubUrl } from '../../src/ops/http-log';
import { OpsModule } from '../../src/ops/ops.module';
import { CredentialsService } from '../../src/web/auth/credentials.service';
import { WebAuthController } from '../../src/web/auth/web-auth.controller';
import { WebAuthService } from '../../src/web/auth/web-auth.service';
import { DashboardStaticModule } from '../../src/web/static.module';

/**
 * IB-BUG-031 (P1, security) — no credential ever reaches the request log.
 *
 * Booted through the REAL options (`loggerModuleParams`, the function OpsModule calls), with only
 * the output stream swapped for a capture. Real `WebAuthController` (its own Set-Cookie on login),
 * real `DashboardStaticModule` (the SPA fallback that serves `/set-password?t=`, the link a member
 * taps in Telegram), `app.useLogger` as main.ts does, so a Nest `Logger` call inside a request is
 * covered too. The services behind the controller are stubs: what is under test is the log line,
 * not authentication.
 *
 * Each secret is a distinct, recognisable value, so a leak names itself.
 */
const SECRETS = {
  cookie: 'cookieTok_Q1w2E3r4T5y6U7i8O9p0',
  otherCookie: 'otherCookie_Z9x8C7v6B5n4M3',
  authorization: 'authTok_A1s2D3f4G5h6J7k8L9',
  urlToken: 'linkTok_P0o9I8u7Y6t5R4e3W2',
  password: 'pw_M1n2B3v4C5x6Z7l8K9',
  bodyToken: 'bodyTok_H1g2F3d4S5a6Q7w8E9',
  sessionIssued: 'sessTok_R1t2Y3u4I5o6P7a8S9',
} as const;

const USER = { id: 7, tgUserId: 70, chatId: 70, role: 'member', lang: 'ru' } as never;

async function boot(lines: string[]): Promise<{ app: INestApplication; root: string }> {
  const root = mkdtempSync(join(tmpdir(), 'ib-bug-031-spa-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><body>spa</body></html>');
  const capture = new Writable({
    write(chunk, _enc, done) {
      lines.push(...String(chunk).split('\n').filter((l) => l.length > 0));
      done();
    },
  });
  @Module({
    imports: [LoggerModule.forRoot(loggerModuleParams('info', 'production', capture)), DashboardStaticModule.register(root)],
    controllers: [WebAuthController],
    providers: [
      {
        provide: WebAuthService,
        useValue: { cookieSecure: true, clientIpHeader: undefined, botUsername: 'x_bot', logout: async () => undefined },
      },
      {
        provide: CredentialsService,
        useValue: {
          login: async () => ({ ok: true, user: USER, login: 'owner', token: SECRETS.sessionIssued, expiresAtMs: Date.now() + 3_600_000 }),
          credentialsInfo: async () => {
            new NestLogger('IbBug031Probe').warn('a log call inside a request');
            return { ok: true, hasLogin: false };
          },
          setCredentials: async () => ({ ok: true, created: true }),
        },
      },
    ],
  })
  class LogSpecModule {}
  const app = await NestFactory.create(LogSpecModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.listen(0, '127.0.0.1');
  return { app, root };
}

function request(
  app: INestApplication, method: string, path: string, headers: Record<string, string>, body?: unknown,
): Promise<{ status: number; setCookie: string[] }> {
  const port = (app.getHttpServer().address() as { port: number }).port;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers: { ...headers, ...(payload ? { 'content-type': 'application/json' } : {}) } },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, setCookie: [res.headers['set-cookie'] ?? []].flat() }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const withCredentials = {
  cookie: `ib_session=${SECRETS.cookie}; theme=${SECRETS.otherCookie}`,
  authorization: `Bearer ${SECRETS.authorization}`,
};

describe('IB-BUG-031 — the request log holds no credential (real logger options)', () => {
  let app: INestApplication;
  let root: string;
  const lines: string[] = [];

  beforeAll(async () => {
    ({ app, root } = await boot(lines));
  });
  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function completed(n: number): Promise<Array<Record<string, any>>> {
    // pino-http writes the line on the response's 'finish'; the client can see 'end' a tick earlier
    for (let i = 0; i < 50 && lines.filter((l) => l.includes('request completed')).length < n; i++) await new Promise((r) => setTimeout(r, 10));
    return lines.map((l) => JSON.parse(l)).filter((o) => o.msg === 'request completed');
  }

  it('cookie, Authorization, the ?t= token (API and SPA page), the body and the issued Set-Cookie: none in any line', async () => {
    // the pieces really were sent and really came back, or "absent from the log" proves nothing
    const info = await request(app, 'GET', `/api/web/auth/credentials?t=${SECRETS.urlToken}&lang=ru`, withCredentials);
    const page = await request(app, 'GET', `/set-password?t=${SECRETS.urlToken}`, withCredentials);
    const login = await request(app, 'POST', '/api/web/auth/login', withCredentials, { login: 'owner', password: SECRETS.password });
    const set = await request(app, 'POST', '/api/web/auth/credentials', withCredentials, { token: SECRETS.bodyToken, password: SECRETS.password });
    expect([info.status, page.status, login.status, set.status]).toEqual([200, 200, 200, 204]);
    expect(login.setCookie.join(';')).toContain(SECRETS.sessionIssued);

    const done = await completed(4);
    expect(done).toHaveLength(4);
    const all = lines.join('\n');
    for (const [what, value] of Object.entries(SECRETS)) {
      expect({ what, inLog: all.includes(value) }).toEqual({ what, inLog: false });
    }

    // and the line is still useful: path, the harmless query, status, agent all kept
    const byUrl = Object.fromEntries(done.map((o) => [o.req.url, o]));
    expect(Object.keys(byUrl).sort()).toEqual([
      '/api/web/auth/credentials',
      `/api/web/auth/credentials?t=${REDACTED}&lang=ru`,
      '/api/web/auth/login',
      `/set-password?t=${REDACTED}`,
    ]);
    const api = byUrl[`/api/web/auth/credentials?t=${REDACTED}&lang=ru`];
    expect(api.req.query).toEqual({ t: REDACTED, lang: 'ru' });
    expect(api.req.headers.cookie).toBe(REDACTED);
    expect(api.req.headers.authorization).toBe(REDACTED);
    expect(api.res.statusCode).toBe(200);
    expect(byUrl['/api/web/auth/login'].res.headers['set-cookie']).toBe(REDACTED);
  });

  it('a Nest Logger call made inside a request (with its bound req) carries no credential either', async () => {
    const before = lines.length;
    const { status } = await request(app, 'GET', `/api/web/auth/credentials?t=${SECRETS.urlToken}`, withCredentials);
    expect(status).toBe(200);
    await completed(5);
    const fresh = lines.slice(before).map((l) => JSON.parse(l));
    const inside = fresh.find((o) => o.msg === 'a log call inside a request');
    expect(inside?.req?.headers?.cookie).toBe(REDACTED); // the line exists and does carry the request
    expect(inside?.req?.url).toBe(`/api/web/auth/credentials?t=${REDACTED}`);
    const text = lines.slice(before).join('\n');
    for (const value of Object.values(SECRETS)) expect(text.includes(value)).toBe(false);
  });
});

describe('OpsModule uses exactly these options', () => {
  // the spec above boots loggerModuleParams; this pins that the app does too, not an inline copy
  it.each([['production'], ['development'], [undefined]])('NODE_ENV=%s: the module factory returns loggerModuleParams', (nodeEnv) => {
    const imports = Reflect.getMetadata('imports', OpsModule) as Array<DynamicModule | unknown>;
    const logger = imports.find((i): i is DynamicModule => (i as DynamicModule)?.module?.name === 'LoggerModule');
    const params = logger?.providers?.find((p) => (p as { provide?: unknown }).provide === 'pino-params') as { useFactory: (c: unknown) => unknown };
    const env: Record<string, unknown> = { LOG_LEVEL: 'warn', NODE_ENV: nodeEnv };
    const fromModule = params.useFactory({ env: { get: (k: string) => env[k] } }) as { pinoHttp: Record<string, unknown> };
    const expected = loggerModuleParams('warn', nodeEnv) as { pinoHttp: Record<string, unknown> };
    expect(JSON.stringify(fromModule)).toBe(JSON.stringify(expected));
    expect(String((fromModule.pinoHttp.serializers as Record<string, unknown>).req)).toBe(String((expected.pinoHttp.serializers as Record<string, unknown>).req));
    expect((fromModule.pinoHttp.redact as { paths: string[] }).paths).toEqual(expect.arrayContaining(['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', 'req.query.t']));
  });
});

describe('scrubUrl', () => {
  it.each([
    ['/set-password?t=abc', `/set-password?t=${REDACTED}`],
    ['/x?a=1&t=abc&b=2', `/x?a=1&t=${REDACTED}&b=2`],
    ['/x?token=abc', `/x?token=${REDACTED}`],
    ['/x?%74=abc', `/x?%74=${REDACTED}`], // an encoded key is the same key
    ['/x?t', `/x?t=${REDACTED}`],
    ['/x?t=abc#frag', `/x?t=${REDACTED}`],
    ['/x?bad=%E0%A4%A&t=1', `/x?bad=%E0%A4%A&t=${REDACTED}`],
    ['/x?%E0%A4%A=1', `/x?%E0%A4%A=${REDACTED}`],
    ['/api/web/market/flows?period=24h', '/api/web/market/flows?period=24h'],
    ['/healthz', '/healthz'],
    ['/x?tt=1&at=2', '/x?tt=1&at=2'],
  ])('%s → %s', (input, out) => expect(scrubUrl(input)).toBe(out));
});
