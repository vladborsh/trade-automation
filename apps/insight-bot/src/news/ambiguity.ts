import { AMBIGUOUS_TERMS } from './assets';

/**
 * IB-027 — makes the monthly hand revision of `universe.yaml` fail loudly when it is skipped.
 *
 * `AMBIGUOUS_TERMS` **fails open**: a ticker or coin name that is also an ordinary word, and which
 * nobody classified, matches bare prose and tags stories that never mentioned the asset. Until now
 * the only thing standing between a new listing and that was somebody remembering — a rule living
 * in a calendar, which is the one shape this branch otherwise does not use.
 *
 * So every term a new universe introduces must be **classified explicitly**, and an unclassified one
 * fails the build. Deliberately not a dictionary lookup: "is this an English word" is a judgement
 * (is `ENA` a word? is `SUI`?) and a heuristic that answers it would be wrong silently in both
 * directions. A reviewer answering it once per listing is both honest and cheap — there are thirty
 * symbols and the file is revised monthly.
 */

export type Classification = 'ambiguous' | 'distinct';

/**
 * Every ticker and coin name in the universe, and whether it can be matched bare.
 *
 * `ambiguous` — an ordinary English word, a common abbreviation, or a proper noun that appears in
 * news unrelated to the token. Needs a cashtag; never tags on the bare form.
 * `distinct` — a coined or technical term that nobody writes by accident.
 *
 * **Add a line when `universe.yaml` gains a symbol.** The spec will tell you exactly which term is
 * missing; the judgement is yours, not the test's.
 */
export const TERM_CLASSIFICATION: Readonly<Record<string, Classification>> = {
  // --- tickers that are ordinary words, abbreviations or names
  one: 'ambiguous', near: 'ambiguous', link: 'ambiguous', arb: 'ambiguous', dash: 'ambiguous',
  hype: 'ambiguous', pump: 'ambiguous', uni: 'ambiguous', sol: 'ambiguous', tao: 'ambiguous',
  ena: 'ambiguous', fil: 'ambiguous', trump: 'ambiguous',
  // --- coin NAMES that are ordinary words. The half that was missed first time round: NEAR's
  // coingecko id is literally `near`, and ONE's is `harmony`.
  harmony: 'ambiguous',
  // --- coined or technical: safe to match bare
  btc: 'distinct', bitcoin: 'distinct', eth: 'distinct', ethereum: 'distinct',
  bch: 'distinct', 'bitcoin cash': 'distinct', bnb: 'distinct', binancecoin: 'distinct',
  xrp: 'distinct', ripple: 'distinct', ada: 'distinct', cardano: 'distinct',
  'quant network': 'distinct',
  avax: 'distinct', avalanche: 'distinct', doge: 'distinct', dogecoin: 'distinct',
  ltc: 'distinct', litecoin: 'distinct', zec: 'distinct', zcash: 'distinct',
  aave: 'distinct', qnt: 'distinct', quant: 'distinct', wld: 'distinct',
  'worldcoin wld': 'distinct', sui: 'distinct', ondo: 'distinct', 'ondo finance': 'distinct',
  pepe: 'distinct', marscoin: 'distinct', arbitrum: 'distinct', chainlink: 'distinct',
  solana: 'distinct', bittensor: 'distinct', ethena: 'distinct', filecoin: 'distinct',
  'hyperliquid': 'distinct', 'official trump': 'distinct', 'pump fun': 'distinct',
  'uniswap': 'distinct', 'near protocol': 'distinct',
};

export interface UniverseTerm {
  term: string;
  /** Where it came from, so an error message can name the symbol a reviewer must look at. */
  symbol: string;
  kind: 'ticker' | 'name';
}

/** Every term the matcher could try to match bare, lower-cased, from a universe. */
export function universeTerms(
  symbols: ReadonlyArray<{ id: string; base: string; coingecko_id?: string | null }>,
  nameOf: (id: string | null | undefined) => string | null,
): UniverseTerm[] {
  const out: UniverseTerm[] = [];
  for (const s of symbols) {
    out.push({ term: s.base.toLowerCase(), symbol: s.id, kind: 'ticker' });
    const name = nameOf(s.coingecko_id);
    if (name !== null) out.push({ term: name.toLowerCase(), symbol: s.id, kind: 'name' });
  }
  return out;
}

/** Terms the universe contains that nobody has classified. Non-empty means the build fails. */
export function unclassifiedTerms(terms: readonly UniverseTerm[]): UniverseTerm[] {
  return terms.filter((t) => TERM_CLASSIFICATION[t.term] === undefined);
}

/**
 * Terms classified `ambiguous` here but missing from the set the matcher actually consults.
 *
 * The two lists are separate on purpose — one is the judgement, the other is what runs — so this
 * catches them drifting apart, which would make the classification decorative.
 */
export function classificationNotEnforced(): string[] {
  return Object.entries(TERM_CLASSIFICATION)
    .filter(([term, c]) => c === 'ambiguous' && !AMBIGUOUS_TERMS.has(term))
    .map(([term]) => term);
}

/**
 * Pairs where one name contains another, e.g. `bitcoin cash` ⊃ `bitcoin`.
 *
 * Reported rather than failed: containment is handled by matching names longest-first and claiming
 * the matched span, so these are correct by construction. The check exists so that a new listing
 * creating such a pair is visible to a reviewer, who can confirm the longest-first rule covers it
 * rather than discovering a mis-tag later.
 */
export function containmentPairs(terms: readonly UniverseTerm[]): Array<{ longer: string; shorter: string }> {
  const names = terms.filter((t) => t.kind === 'name').map((t) => t.term);
  const pairs: Array<{ longer: string; shorter: string }> = [];
  for (const a of names) {
    for (const b of names) {
      if (a === b) continue;
      // word-bounded containment: "bitcoin cash" contains "bitcoin", "ethena" does not contain "eth"
      if (new RegExp(`(?<![\\p{L}\\p{N}])${b}(?![\\p{L}\\p{N}])`, 'u').test(a)) {
        pairs.push({ longer: a, shorter: b });
      }
    }
  }
  return pairs;
}
