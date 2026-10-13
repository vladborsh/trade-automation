import { WebCoverageResponseSchema } from '@trade-automation/contracts';
import { WebCoverageController } from '../../src/web/coverage.controller';
import { ALL_GOPLUS_FIELDS } from '../../src/web/dex-field-presence';
import { FIELD_CONTRACTS } from '../../src/dex/goplus';
import type { AppConfigService } from '../../src/config/config.service';

/**
 * IB-028 — the coverage response carries the field-presence block, and carries it when there is
 * nothing to say.
 *
 * The no-database path is the one that matters most here: a page that renders a missing block as
 * "no fields are arriving" would read as the alarm the block exists to raise.
 */
describe('GET /api/web/coverage — the dex field block', () => {
  const config = { symbols: [] } as unknown as AppConfigService;

  it('is present and empty with no database, and still parses as the contract', () => {
    const controller = new WebCoverageController(config, null);
    return controller.get().then((response) => {
      expect(response.dexFields).toEqual([]);
      expect(() => WebCoverageResponseSchema.parse(response)).not.toThrow();
    });
  });

  it('asks the database for every field of both families, once each', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return [];
      },
    };
    const controller = new WebCoverageController(config, db as never);
    const response = await controller.get('7');

    const presence = queries.find((q) => q.sql.includes('dex_token_security'));
    expect(presence).toBeDefined();
    expect(presence!.params[1]).toEqual([...ALL_GOPLUS_FIELDS]);
    // and the window is the same `days` the rest of the page states, not a second basis
    const since = presence!.params[0] as Date;
    expect(Math.round((Date.now() - since.getTime()) / 86_400_000)).toBe(7);

    // no rows answered: every field reports a null rate rather than 0 %
    expect(response.dexFields).toHaveLength(FIELD_CONTRACTS.solana.length + FIELD_CONTRACTS.evm.length);
    expect(response.dexFields.every((f) => f.presentRate === null && f.answered === 0)).toBe(true);
    expect(() => WebCoverageResponseSchema.parse(response)).not.toThrow();
  });

  it('counts only ANSWERED asks, which the SQL must say and not the caller', async () => {
    const seen: string[] = [];
    const db = { query: async (sql: string) => { seen.push(sql); return []; } };
    await new WebCoverageController(config, db as never).get();
    const sql = seen.find((s) => s.includes('dex_token_security'))!;
    // a failed ask carries no information about the venue's field set; including it would make an
    // outage look like a vanished field
    expect(sql).toMatch(/where\s+s\.answered/);
    expect(sql).toMatch(/absent_fields/);
  });
});
