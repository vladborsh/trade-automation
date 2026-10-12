/**
 * IB-027 — the dictionary prefilter that assigns candidate symbols to an article (§10, `news_assets`).
 *
 * A prefilter, not a classifier: it answers "which of our 30 symbols might this story be about",
 * and AI-1 decides later. So recall matters — but **precision matters more than a prefilter usually
 * implies**, because the output feeds `news_reactions`, which measures the 15m/1h/4h return of each
 * tagged symbol. A wrongly tagged symbol does not just add noise to a list; it records a price move
 * as a reaction to a story that never mentioned it, and that becomes training evidence.
 *
 * ## The problem this file exists for
 *
 * Crypto tickers collide with ordinary English. In the current universe alone: `ONE`, `NEAR`,
 * `LINK`, `ARB`, `DASH`, `HYPE`, `PUMP`, `UNI`, `SOL`, `TAO` — and `TRUMP`, which appears in
 * political coverage several times a day and is a token. Matching bare words would tag half the
 * tape with whatever happens to be listed.
 *
 * Three kinds of evidence, in decreasing strength:
 *
 * 1. **A cashtag** (`$BTC`) — unambiguous by construction; nobody writes `$NEAR` meaning "near".
 * 2. **The coin's name** (`bitcoin`, `bitcoin cash`, `arbitrum`) — a word nobody uses by accident.
 * 3. **A bare upper-case ticker** (`BTC`) — accepted only for tickers that are not also words,
 *    and only when the surrounding text is not itself shouting (see below).
 *
 * An ambiguous ticker therefore needs evidence 1 or 2: `TRUMP` alone is a surname, `$TRUMP` or
 * "official trump" is the token.
 *
 * ## Why ALL-CAPS text disables bare-ticker matching
 *
 * In a headline set entirely in capitals, every English word looks like a ticker: "SEC CHARGES FIRM
 * OVER ONE MILLION IN LOSSES" would tag ONE. The upper-case requirement is doing the work of
 * distinguishing a ticker from a word, so in text with no lower case it carries no information and
 * is switched off — cashtags and names still apply.
 */

export interface AssetDictionaryEntry {
  /** The universe id stored in `news_assets.symbol`, e.g. `BTCUSDT`. */
  symbol: string;
  /** The ticker, e.g. `BTC`. */
  base: string;
  /** The coin's name as words, from `coingecko_id` — `bitcoin-cash` becomes `bitcoin cash`. */
  name: string | null;
}

/**
 * Which rule fired. Stored with the tag because when a reaction turns out spurious, the only way to
 * tell whether the matcher or the market was wrong is to know what tagged it — a derived claim
 * carries what it was derived from.
 */
export type AssetMatchKind = 'cashtag' | 'name' | 'ticker';

export interface AssetMatch {
  symbol: string;
  kind: AssetMatchKind;
  /** The text that actually matched: `$BTC`, `bitcoin`, or `BTC`. */
  matched: string;
}

/**
 * Tickers that are also ordinary English words, proper nouns, or common abbreviations, and so
 * require a cashtag or the coin's name rather than the bare ticker.
 *
 * **Review this when `universe.yaml` is revised** — the file is revised by hand monthly, and a new
 * listing with a word-like ticker would otherwise start tagging prose. A ticker missing from here
 * fails open (it matches on the bare form), which is the direction that produces false tags, so the
 * spec pins the current universe's collisions explicitly.
 */
export const AMBIGUOUS_TERMS: ReadonlySet<string> = new Set([
  // tickers that are ordinary words
  'one', 'near', 'link', 'arb', 'dash', 'hype', 'pump', 'uni', 'sol', 'tao', 'ena', 'fil',
  // proper nouns that appear constantly in news that is not about the token
  'trump',
  // short enough to collide with an abbreviation in any headline
  'op', 'id', 'io', 'ai',
  // **NAMES, not only tickers.** A coin's name can be an ordinary word just as a ticker can:
  // NEAR's coingecko id is literally `near`, and ONE's is `harmony`. Treating a name as always
  // trustworthy tagged "the fund closed near its high" — found by the spec, not by reasoning.
  'harmony', 'polygon', 'compound', 'curve', 'balancer', 'immutable', 'injective', 'render',
]);

/** Ordinary word or proper noun, so it needs a cashtag rather than a bare mention. */
function isAmbiguous(term: string): boolean {
  return AMBIGUOUS_TERMS.has(term.toLowerCase());
}

/** `bitcoin-cash` → `bitcoin cash`; `avalanche-2` → `avalanche` (the id's disambiguating suffix). */
export function nameFromCoingeckoId(id: string | null | undefined): string | null {
  if (!id) return null;
  const words = id.split('-').filter((part) => !/^\d+$/.test(part));
  return words.length === 0 ? null : words.join(' ');
}

export function buildDictionary(
  symbols: ReadonlyArray<{ id: string; base: string; coingecko_id?: string | null }>,
): AssetDictionaryEntry[] {
  return symbols.map((s) => ({
    symbol: s.id,
    base: s.base.toUpperCase(),
    name: nameFromCoingeckoId(s.coingecko_id),
  }));
}

/** True when the text carries no lower case, so upper case says nothing about a token. */
export function isShouting(text: string): boolean {
  return !/\p{Ll}/u.test(text);
}

function wordBounded(needle: string, flags: string): RegExp {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b is wrong at a '$' and around digits in a name like "1000PEPE"; these lookarounds treat any
  // letter or digit as "inside a word", which is what a ticker boundary actually means
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, flags);
}

/**
 * The symbols an article might be about, with the evidence for each.
 *
 * At most one match per symbol, and the strongest evidence wins, so `matched` says the best reason
 * rather than an arbitrary one.
 */
export function matchAssets(text: string, dictionary: readonly AssetDictionaryEntry[]): AssetMatch[] {
  if (text.trim().length === 0) return [];
  const shouting = isShouting(text);
  const out: AssetMatch[] = [];

  // Spans already claimed by a longer name. "Bitcoin Cash" contains "bitcoin", so without this a
  // BCH story also tags BTC — the shorter name matching inside the longer one's text. Found by the
  // spec. Longest first, so the most specific name claims its span before a shorter one looks.
  const claimed: Array<{ start: number; end: number }> = [];
  const inClaimed = (start: number, end: number) =>
    claimed.some((c) => start >= c.start && end <= c.end);

  const byNameLength = [...dictionary].sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0));

  for (const entry of byNameLength) {
    if (wordBounded(`$${entry.base}`, 'iu').test(text)) {
      out.push({ symbol: entry.symbol, kind: 'cashtag', matched: `$${entry.base}` });
      continue;
    }

    if (entry.name !== null && !isAmbiguous(entry.name)) {
      // every occurrence, so a name also appearing inside a longer one still counts where it
      // stands alone
      const all = [...text.matchAll(wordBounded(entry.name, 'giu'))];
      const free = all.find((m) => !inClaimed(m.index ?? 0, (m.index ?? 0) + entry.name!.length));
      if (free !== undefined) {
        out.push({ symbol: entry.symbol, kind: 'name', matched: entry.name });
        for (const m of all) claimed.push({ start: m.index ?? 0, end: (m.index ?? 0) + entry.name.length });
        continue;
      }
    }

    // bare ticker: upper case only, never for an ambiguous one, never in shouting text
    if (!shouting && !isAmbiguous(entry.base) && wordBounded(entry.base, 'u').test(text)) {
      out.push({ symbol: entry.symbol, kind: 'ticker', matched: entry.base });
    }
  }

  return out;
}
