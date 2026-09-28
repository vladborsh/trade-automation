import { Client } from 'pg';
import { similarity, SIMILARITY_THRESHOLD, trigrams } from '../../src/news/cluster';
import { normaliseTitle } from '../../src/news/normalise';

/**
 * IB-027 — the JS trigram measure must equal `pg_trgm`'s, because the threshold is specced in
 * TypeScript and applied in SQL. If they drift, the 0.6 in the specs is not the 0.6 in the query.
 *
 * This caught a real error: the first version padded the whole string instead of each word, so
 * it produced cross-word trigrams (`b c`) and missed per-word openers (`  c`). It agreed with
 * Postgres on four of five sample pairs and disagreed on the fifth (0.5769 vs 0.5800) — close
 * enough to pass a careless eye.
 *
 * Skipped without DATABASE_URL, like the other integration specs.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('trigram-parity.integration.spec.ts: DATABASE_URL not set — skipping pg_trgm parity.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

/** Headlines chosen to exercise the cases the measure must get right, not just easy ones. */
const TITLES = [
  'SEC approves spot bitcoin ETF',
  'SEC approves spot bitcoin ETF application from issuer',
  'sec approves spot bitcoin etf',
  'Bitcoin rallies 5%, traders say',
  'Bitcoin rallies to a new high',
  'Bitcoin slumps to a monthly low',
  'Fed holds rates steady',
  'CFTC fines derivatives exchange',
  'Binance lists ONDO perpetual futures',
  'Coinbase delists three tokens',
  'ab',
  'ab cd',
];

maybeDescribe('pg_trgm parity', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query('create extension if not exists pg_trgm');
  }, 60_000);

  afterAll(async () => {
    await client.end();
  });

  it('builds the same trigram set as show_trgm, per word and with no cross-word grams', async () => {
    for (const title of TITLES) {
      const normalised = normaliseTitle(title);
      const { rows } = await client.query<{ t: string[] }>('select show_trgm($1) as t', [normalised]);
      expect(new Set(rows[0].t)).toEqual(trigrams(normalised));
    }
  });

  it('scores every pair identically to pg_trgm.similarity()', async () => {
    for (let i = 0; i < TITLES.length; i += 1) {
      for (let j = i + 1; j < TITLES.length; j += 1) {
        const a = normaliseTitle(TITLES[i]);
        const b = normaliseTitle(TITLES[j]);
        const { rows } = await client.query<{ s: number }>('select similarity($1, $2)::float8 as s', [a, b]);
        expect(similarity(a, b)).toBeCloseTo(rows[0].s, 6);
      }
    }
  }, 60_000);

  it('puts the same pairs on the same side of the 0.6 threshold', async () => {
    // The parity that actually matters: not just close numbers, but the same clustering decision.
    for (let i = 0; i < TITLES.length; i += 1) {
      for (let j = i + 1; j < TITLES.length; j += 1) {
        const a = normaliseTitle(TITLES[i]);
        const b = normaliseTitle(TITLES[j]);
        const { rows } = await client.query<{ s: number }>('select similarity($1, $2)::float8 as s', [a, b]);
        expect(similarity(a, b) >= SIMILARITY_THRESHOLD).toBe(rows[0].s >= SIMILARITY_THRESHOLD);
      }
    }
  }, 60_000);
});
