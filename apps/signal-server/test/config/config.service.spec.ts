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

describe('AppConfigService metric-aggregates.yaml (architecture/aggregate-oi.md §3.3)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-server-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const AGGREGATES_YAML = `
aggregates:
  - id: btc-perp-oi
    displayName: "BTC perps · 3 venues"
    metric: openInterest
    members:
      - { id: "binance:BTCUSDT",  venue: binance,     symbol: BTCUSDT, quoteCurrency: USDT }
      - { id: "bybit:BTCUSDT",    venue: bybit,       symbol: BTCUSDT, quoteCurrency: USDT }
      - { id: "hyperliquid:BTC",  venue: hyperliquid, symbol: BTC,     quoteCurrency: USDC }
`;

  function boot(panelExtra: string, aggregatesYaml: string | null = AGGREGATES_YAML) {
    const paths: Record<string, string> = {
      INSTRUMENTS_FILE: writeTmpFile(dir, 'instruments.yaml', INSTRUMENTS_YAML),
      STRATEGIES_FILE: writeTmpFile(dir, 'strategies.yaml', STRATEGIES_YAML),
      LAYOUTS_FILE: writeTmpFile(
        dir,
        'layouts.yaml',
        `
layouts:
  - id: crypto
    name: "Crypto trading"
    grid: { columns: 1, rows: 1 }
    panels:
      - id: btc-oi
        kind: metric
        metric: openInterest
${panelExtra}
`,
      ),
    };
    if (aggregatesYaml !== null) paths.METRIC_AGGREGATES_FILE = writeTmpFile(dir, 'metric-aggregates.yaml', aggregatesYaml);
    return new AppConfigService(fakeNestConfig(paths));
  }

  it('loads the aggregate (convention defaulting to one-sided) for a panel that names it', () => {
    const config = boot('        instrument: "binance:BTCUSDT"\n        aggregate: btc-perp-oi');
    expect(config.metricAggregates).toHaveLength(1);
    expect(config.metricAggregates[0].countingConvention).toBe('one-sided');
    expect(config.layouts[0].panels[0].aggregate).toBe('btc-perp-oi');
  });

  it('refuses to boot on an unknown aggregate id in layouts.yaml', () => {
    expect(() => boot('        instrument: "binance:BTCUSDT"\n        aggregate: eth-perp-oi')).toThrow(
      /unknown aggregate 'eth-perp-oi'/,
    );
    expect(() => boot('        instrument: "binance:BTCUSDT"\n        aggregate: btc-perp-oi', null)).toThrow(
      /unknown aggregate 'btc-perp-oi'/,
    );
  });

  it('refuses to boot when the anchor instrument is not a member of the aggregate', () => {
    const yaml = AGGREGATES_YAML.replace('binance:BTCUSDT', 'binance:ETHUSDT');
    expect(() => boot('        instrument: "binance:BTCUSDT"\n        aggregate: btc-perp-oi', yaml)).toThrow(
      /not a member of aggregate 'btc-perp-oi'/,
    );
  });

  it('refuses to boot on a named METRIC_AGGREGATES_FILE that does not exist', () => {
    const paths = {
      INSTRUMENTS_FILE: writeTmpFile(dir, 'instruments.yaml', INSTRUMENTS_YAML),
      STRATEGIES_FILE: writeTmpFile(dir, 'strategies.yaml', STRATEGIES_YAML),
      LAYOUTS_FILE: writeTmpFile(dir, 'layouts.yaml', 'layouts:\n  - id: a\n    name: A\n    grid: { columns: 1, rows: 1 }\n    panels:\n      - { id: b, kind: candles, instrument: "binance:BTCUSDT" }\n'),
      METRIC_AGGREGATES_FILE: path.join(dir, 'missing.yaml'),
    };
    expect(() => new AppConfigService(fakeNestConfig(paths))).toThrow(/Config file not found/);
  });
});

