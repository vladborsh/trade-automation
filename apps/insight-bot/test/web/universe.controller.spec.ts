import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { WebUniverseTopResponseSchema } from '@trade-automation/contracts';
import type { AppConfigService } from '../../src/config/config.service';
import { UniverseFileSchema } from '../../src/config/universe.schema';
import { UniverseController } from '../../src/web/universe.controller';
import { universeTop } from '../../src/web/universe-top';

/**
 * WD-009 — the picker's list from `config/universe.yaml`, with no database. Run over the REAL file,
 * so a revision of the universe that breaks the list fails here rather than on the page.
 */
const FILE = path.join(__dirname, '..', '..', 'config', 'universe.yaml');
const universe = UniverseFileSchema.parse(yaml.load(fs.readFileSync(FILE, 'utf8')));
const config = { symbols: universe.symbols, signalSet: universe.signal_set } as unknown as AppConfigService;

describe('UniverseController /top over universe.yaml (WD-009)', () => {
  it('answers the contract, in the file order (rank = position unless stated), BTC first', async () => {
    const res = await new UniverseController(config).top('20');
    expect(WebUniverseTopResponseSchema.parse(res)).toEqual(res);
    expect(res.symbols).toHaveLength(Math.min(20, universe.symbols.length));
    expect(res.symbols[0].id).toBe(universe.symbols[0].id);
    const ranks = res.symbols.map((s) => s.volumeRank);
    expect([...ranks].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(ranks);
  });

  it('marks the signal set and the venues each symbol is listed on, from the file', async () => {
    const res = await new UniverseController(config).top('100');
    const btc = res.symbols.find((s) => s.id === 'BTCUSDT')!;
    expect(btc.venues).toEqual({ binancePerp: true, binanceSpot: true, bybitLinear: true, okxSwap: true });
    for (const s of res.symbols) expect(s.inSignalSet).toBe(universe.signal_set.includes(s.id));
  });

  it('caps n so the picker cannot be asked for the world, and a bad n is the default', async () => {
    const c = new UniverseController(config);
    expect((await c.top('100000')).symbols.length).toBe(Math.min(100, universe.symbols.length));
    expect((await c.top('abc')).symbols.length).toBe(Math.min(20, universe.symbols.length));
  });
});

describe('universeTop (pure)', () => {
  const sym = (id: string, extra: Record<string, unknown> = {}) => ({ id, base: id, quote: 'USDT', binance_perp: id, ...extra });

  it('a stated volume_rank wins over position; ties break by id', () => {
    // A is position 1, B position 2, C states rank 1 → ranks 1, 2, 1 → A, C (tie on 1, by id), B
    const rows = universeTop([sym('AUSDT'), sym('BUSDT'), sym('CUSDT', { volume_rank: 1 })] as never, [], 10);
    expect(rows.map((r) => [r.id, r.volumeRank])).toEqual([['AUSDT', 1], ['CUSDT', 1], ['BUSDT', 2]]);
  });

  it('a venue the file does not list is false, never assumed', () => {
    const [row] = universeTop([sym('XUSDT')] as never, [], 1);
    expect(row.venues).toEqual({ binancePerp: true, binanceSpot: false, bybitLinear: false, okxSwap: false });
  });
});
