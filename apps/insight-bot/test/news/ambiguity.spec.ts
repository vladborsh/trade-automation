import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseUniverse } from '../../src/config/universe.loader';
import {
  classificationNotEnforced, containmentPairs, TERM_CLASSIFICATION, unclassifiedTerms, universeTerms,
} from '../../src/news/ambiguity';
import { nameFromCoingeckoId } from '../../src/news/assets';

/**
 * IB-027 — the monthly revision of `universe.yaml` must fail loudly when it is skipped.
 *
 * `AMBIGUOUS_TERMS` fails OPEN: an unclassified ticker or coin name that happens to be an ordinary
 * word matches bare prose and tags stories that never mentioned the asset. Before this spec, the
 * only thing preventing that for a NEW listing was someone remembering — a rule living in a
 * calendar, which is the one shape this branch otherwise avoids.
 *
 * **Positive control (IB-027 rule).** The checks below are also exercised against a fabricated
 * universe containing an unclassified symbol, so a check that can never fail does not pass as a
 * check that never fires.
 */

const UNIVERSE_PATH = join(__dirname, '..', '..', 'config', 'universe.yaml');
const universe = parseUniverse(readFileSync(UNIVERSE_PATH, 'utf8'), UNIVERSE_PATH);
const terms = universeTerms(universe.symbols, nameFromCoingeckoId);

describe('every term in universe.yaml is classified', () => {
  it('reads the real universe, not a fixture — a stale copy would make this vacuous', () => {
    expect(universe.symbols.length).toBeGreaterThanOrEqual(20);
    expect(terms.length).toBeGreaterThan(universe.symbols.length); // tickers AND names
  });

  it('has no unclassified ticker or name', () => {
    const missing = unclassifiedTerms(terms);
    // the message names the symbol so a reviewer knows what to decide about, not merely that
    // something is wrong
    const described = missing.map((m) => `${m.term} (${m.kind} of ${m.symbol})`);
    expect(described).toEqual([]);
  });

  it('fails on a NEW listing nobody has classified — the positive control', () => {
    // this is what a monthly revision adding a symbol looks like before anyone thinks about it
    const withNewListing = universeTerms(
      [{ id: 'SPARKUSDT', base: 'SPARK', coingecko_id: 'spark-protocol' }],
      nameFromCoingeckoId,
    );
    const missing = unclassifiedTerms(withNewListing);
    expect(missing.map((m) => m.term).sort()).toEqual(['spark', 'spark protocol']);
  });
});

describe('the classification and the matcher cannot drift apart', () => {
  it('every term classed ambiguous is actually enforced by the matcher', () => {
    // two lists on purpose — one is the judgement, one is what runs — so this is the join that
    // stops the judgement becoming decorative
    expect(classificationNotEnforced()).toEqual([]);
  });

  it('would notice if an ambiguous term were dropped from the matcher', () => {
    // the check reads AMBIGUOUS_TERMS live, so removing an entry there surfaces here rather than
    // as a quietly wider matcher
    expect(TERM_CLASSIFICATION['trump']).toBe('ambiguous');
    expect(classificationNotEnforced()).not.toContain('trump');
  });
});

describe('names that contain other names', () => {
  it('reports them, so a reviewer can confirm longest-first covers the new one', () => {
    const pairs = containmentPairs(terms);
    // at least the known one: "bitcoin cash" contains "bitcoin", which tagged BTC on every BCH
    // story until names were matched longest-first
    expect(pairs).toContainEqual({ longer: 'bitcoin cash', shorter: 'bitcoin' });
  });

  it('does not report a substring that is not a whole word', () => {
    // "ethena" contains the letters of "eth" but is not a containment pair; treating it as one
    // would send a reviewer chasing a collision that cannot happen
    const pairs = containmentPairs([
      { term: 'ethena', symbol: 'ENAUSDT', kind: 'name' },
      { term: 'eth', symbol: 'ETHUSDT', kind: 'name' },
    ]);
    expect(pairs).toEqual([]);
  });
});
