import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { installNetworkGuard } from '../network-guard';

/**
 * BUG-008 — specs are hermetic against the checkout they run in. A checkout may hold an
 * apps/signal-server/.env (the coordinator's does: live mode, a real DATABASE_URL). Under the suite
 * config.module.ts must not read it; and no spec may reach a non-loopback host.
 *
 * The .env used here is synthetic, written to a temp directory that becomes the cwd (where
 * NestConfigModule looks for `.env`).
 */
describe('hermetic env (BUG-008)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermetic-env-'));
  const cwd = process.cwd();
  const saved = { ...process.env };

  beforeAll(() => {
    fs.writeFileSync(
      path.join(dir, '.env'),
      ['MARKET_DATA_MODE=live', 'DATABASE_URL=postgres://nobody@db.example.invalid:5432/nope'].join('\n'),
    );
    process.chdir(dir);
  });

  beforeEach(() => {
    // The scenario: the shell leaves these unset, so only a .env could supply them. (The suite's
    // DB pass exports DATABASE_URL, which would rightly win over any .env.)
    delete process.env.DATABASE_URL;
    delete process.env.MARKET_DATA_MODE;
  });

  afterEach(() => {
    // ConfigModule writes every validated key back into process.env; undo that for the next spec.
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  afterAll(() => {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A fresh copy of config.module.ts (its forRoot options are fixed at import), booted; read through
   * Nest's ConfigService from the same isolated registry (AppConfigService also loads YAML files
   * relative to the cwd, which is the temp dir here).
   */
  async function bootConfig(): Promise<{ mode: unknown; db: unknown }> {
    let mod!: typeof import('../../src/config/config.module');
    let svc!: typeof import('../../src/config/config.service');
    let nestConfig!: typeof import('@nestjs/config');
    jest.isolateModules(() => {
      mod = require('../../src/config/config.module');
      svc = require('../../src/config/config.service');
      nestConfig = require('@nestjs/config');
    });
    const app = await Test.createTestingModule({ imports: [mod.AppConfigModule] })
      .overrideProvider(svc.AppConfigService)
      .useValue({})
      .compile();
    const config = app.get(nestConfig.ConfigService);
    const out = { mode: config.get('MARKET_DATA_MODE'), db: config.get('DATABASE_URL') };
    await app.close();
    return out;
  }

  it('the suite runs with IGNORE_ENV_FILE=true (test/setup.ts)', () => {
    expect(process.env.IGNORE_ENV_FILE).toBe('true');
  });

  it('under the suite, a .env in the cwd is not read: unset keys mean the schema defaults', async () => {
    expect(await bootConfig()).toEqual({ mode: 'replay', db: undefined });
    expect(process.env.DATABASE_URL).toBeUndefined(); // nothing for later spec files in this worker
  });

  it('control: without the switch the same .env would leak in (the BUG-008 failure)', async () => {
    delete process.env.IGNORE_ENV_FILE;
    expect(await bootConfig()).toEqual({ mode: 'live', db: 'postgres://nobody@db.example.invalid:5432/nope' });
    // ConfigModule also writes validated keys back into process.env, so the leak outlived the boot
    expect(process.env.DATABASE_URL).toBe('postgres://nobody@db.example.invalid:5432/nope');
  });
});

describe('network guard (BUG-008)', () => {
  const guard = installNetworkGuard();

  it('refuses and records a connection to a non-loopback host, before any DNS lookup', async () => {
    const before = guard.blocked.length;
    const err = await new Promise<NodeJS.ErrnoException>((resolve) => {
      net.connect({ host: 'api.binance.example.invalid', port: 443 }).on('error', resolve);
    });
    expect(err.code).toBe('ECONNREFUSED');
    expect(err.message).toContain('network-guard');
    expect(guard.blocked.slice(before)).toEqual(['api.binance.example.invalid:443']);
    guard.blocked.splice(before); // expected here: keep this file's afterAll check green
  });

  it('refuses global fetch to a remote host too', async () => {
    const before = guard.blocked.length;
    await expect(fetch('https://nfs.example.invalid/ff_calendar_thisweek.json')).rejects.toThrow();
    expect(guard.blocked.slice(before)).toEqual(['nfs.example.invalid:443']);
    guard.blocked.splice(before);
  });

  it('lets loopback through', async () => {
    const server = net.createServer((s) => s.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as net.AddressInfo;
    const got = await new Promise<string>((resolve, reject) => {
      const s = net.connect({ host: '127.0.0.1', port });
      let data = '';
      s.on('data', (d) => (data += d)).on('end', () => resolve(data)).on('error', reject);
    });
    server.close();
    expect(got).toBe('ok');
  });
});
