import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppConfigService } from '../../src/config/config.service';

const INSTRUMENTS_YAML = `
instruments:
  - id: "binance:BTCUSDT"
    venue: binance
    symbol: BTCUSDT
    assetClass: crypto-perp
    displayName: "BTC/USDT Perp"
    pricePrecision: 2
    quoteCurrency: USDT
    sessionTimezone: UTC
`;

const STRATEGIES_YAML = `
strategies: []
`;

function writeTmpFile(dir: string, name: string, contents: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, contents, 'utf8');
  return p;
}

function fakeNestConfig(paths: Record<string, string>) {
  return { get: (key: string) => paths[key] } as never;
}

describe('AppConfigService layouts cross-file check (architecture/chart-layouts.md §2.2)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-server-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('boots fine when every layout panel references a known instrument', () => {
    const instrumentsFile = writeTmpFile(dir, 'instruments.yaml', INSTRUMENTS_YAML);
    const strategiesFile = writeTmpFile(dir, 'strategies.yaml', STRATEGIES_YAML);
    const layoutsFile = writeTmpFile(
      dir,
      'layouts.yaml',
      `
layouts:
  - id: crypto
    name: "Crypto trading"
    grid: { columns: 1, rows: 1 }
    panels:
      - id: btc
        kind: candles
        instrument: "binance:BTCUSDT"
        signals: true
`,
    );

    const config = new AppConfigService(
      fakeNestConfig({
        INSTRUMENTS_FILE: instrumentsFile,
        STRATEGIES_FILE: strategiesFile,
        LAYOUTS_FILE: layoutsFile,
      }),
    );

    expect(config.layouts).toHaveLength(1);
    expect(config.layouts[0].panels[0].instrument).toBe('binance:BTCUSDT');
  });

  it('refuses to boot when a layout panel references an instrument absent from instruments.yaml', () => {
    const instrumentsFile = writeTmpFile(dir, 'instruments.yaml', INSTRUMENTS_YAML);
    const strategiesFile = writeTmpFile(dir, 'strategies.yaml', STRATEGIES_YAML);
    const layoutsFile = writeTmpFile(
      dir,
      'layouts.yaml',
      `
layouts:
  - id: crypto
    name: "Crypto trading"
    grid: { columns: 1, rows: 1 }
    panels:
      - id: dxy
        kind: candles
        instrument: "capitalcom:DXY"
        signals: false
`,
    );

    expect(
      () =>
        new AppConfigService(
          fakeNestConfig({
            INSTRUMENTS_FILE: instrumentsFile,
            STRATEGIES_FILE: strategiesFile,
            LAYOUTS_FILE: layoutsFile,
          }),
        ),
    ).toThrow(/unknown instrument 'capitalcom:DXY'/);
  });

  it('refuses to boot when layouts.yaml is missing', () => {
    const instrumentsFile = writeTmpFile(dir, 'instruments.yaml', INSTRUMENTS_YAML);
    const strategiesFile = writeTmpFile(dir, 'strategies.yaml', STRATEGIES_YAML);

    expect(
      () =>
        new AppConfigService(
          fakeNestConfig({
            INSTRUMENTS_FILE: instrumentsFile,
            STRATEGIES_FILE: strategiesFile,
            LAYOUTS_FILE: path.join(dir, 'does-not-exist.yaml'),
          }),
        ),
    ).toThrow(/Config file not found/);
  });
});
