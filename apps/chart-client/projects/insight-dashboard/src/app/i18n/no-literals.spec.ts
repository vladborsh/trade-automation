import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from './en';
import { ru } from './ru';
import type { StringKey } from './keys';

/**
 * §11: "a hard-coded literal in a template is a review reject". This is that check, in a spec rather
 * than in a reviewer's eye — a rule nobody can enforce by reading every diff is not a rule.
 *
 * It scans the dashboard's templates for user-facing text and fails on anything that is not either
 * an interpolation or one of the tokens §11 keeps English everywhere (tickers, venue names, playbook
 * codes, timeframes, raw field names, units, punctuation, numbers).
 *
 * The allow-list is deliberately short and explicit. If it grows to cover a real sentence, the check
 * has stopped meaning anything — add the string to the tables instead.
 */

// `ng test` runs from apps/chart-client, and vitest runs in Node, so the templates are on disk.
// Built from cwd rather than `__dirname`, which does not exist in the ESM the runner loads.
const APP_DIR = join(process.cwd(), 'projects', 'insight-dashboard', 'src', 'app');

/** Tokens §11 keeps English in both languages, plus structural noise. */
const ALLOWED = new Set([
  // units and separators that read the same either way
  'GB', 'ms', 's', 'm', 'h', 'd', '%', '·', '?', '—', '/', ':', ',', '(', ')', '|', '+',
  // timeframes and modes come from the API as codes
  '1m', '5m', '15m', '1h', '4h', '1d', 'ws', 'degraded', 'perp', 'spot',
  // venue and series names, as the venue and the schema spell them
  'binance', 'bybit', 'okx', 'futures', 'candles_1m', 'candles_agg', 'open_interest_5m', 'long_short_5m',
  // §11 keeps "field names in tables of raw data" English in BOTH languages: these are the
  // columns and side values of the liquidations table, which a reader matches against the
  // venue's own data and our logs. Prose around them is translated; these are not prose.
  // `long`/`short` are the stored enum values the API sends, not words chosen for a reader.
  //
  // **The escape hatch, ruled 2026-09-28:** if a member ever reports that these columns read as
  // opaque, the answer is a legend or a tooltip IN THEIR LANGUAGE next to the table — not
  // translating the field names. Translating them would break the one thing they are for: matching
  // a row against the venue's own UI and our logs.
  'time', 'UTC', 'venue', 'side', 'price', 'qty', 'notional', 'long', 'short',
]);

function templateFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...templateFiles(path));
    else if (entry.endsWith('.html')) out.push(path);
  }
  return out;
}

/**
 * The text a member would read, with everything that is not prose removed: interpolations, control
 * flow, attributes, comments and tags.
 */
export function userFacingText(html: string): string[] {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const withoutInterpolation = withoutComments.replace(/\{\{[\s\S]*?\}\}/g, ' ');
  // Angular control flow blocks: keep their bodies, drop the `@if (…) {` headers. Everything up to
  // the opening brace goes, because a condition can hold parentheses of its own (`@if (error(); as
  // message) {`) and a lazier pattern leaks the tail of it into the scanned text.
  const withoutBlocks = withoutInterpolation.replace(/@[a-z]+[^{]*\{/g, ' ').replace(/\}/g, ' ');
  // HTML entities are markup, not prose: `&nbsp;` between two spans is a separator, and reading it
  // as the word "nbsp" made this check fail on its own punctuation.
  const withoutEntities = withoutBlocks.replace(/&[a-z]+;|&#\d+;/gi, ' ');
  const withoutTags = withoutEntities.replace(/<[^>]*>/g, '\n');
  return withoutTags
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** A fragment is suspicious when it contains a word of two or more letters that is not allowed. */
export function suspiciousWords(fragment: string): string[] {
  return fragment
    .split(/[\s|,:()/]+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}_%·?—]+|[^\p{L}\p{N}_%·?—]+$/gu, ''))
    .filter((word) => word.length > 0)
    .filter((word) => !ALLOWED.has(word))
    .filter((word) => /\p{L}{2,}/u.test(word));
}

describe('§11: no hard-coded user-facing literals in the dashboard templates', () => {
  const files = templateFiles(APP_DIR);

  it('finds the templates it is supposed to be checking', () => {
    // a check that silently scans nothing is worse than no check
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files.map((f) => [f.slice(f.indexOf('insight-dashboard')), f] as const))(
    '%s has no untranslated prose',
    (_label, file) => {
      const offenders = userFacingText(readFileSync(file, 'utf8')).flatMap(suspiciousWords);
      expect(offenders).toEqual([]);
    },
  );
});

describe('the string tables', () => {
  it('carry the same keys in both languages', () => {
    // `Strings` makes this a compile error too; asserted here so the failure names the key
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty string in either table', () => {
    for (const [lang, table] of [['ru', ru], ['en', en]] as const) {
      const empty = Object.entries(table).filter(([, value]) => value.trim().length === 0);
      expect(empty, `${lang} has empty strings`).toEqual([]);
    }
  });

  it('uses the same placeholders in both languages for every key', () => {
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of Object.keys(ru) as StringKey[]) {
      expect(placeholders(en[key]), `placeholders differ for ${key}`).toEqual(placeholders(ru[key]));
    }
  });

  it('keeps the Russian table actually Russian, and the English one free of Cyrillic', () => {
    // a mixed screen usually starts as one untranslated entry in the table (§11: no mixed screens)
    const cyrillic = /\p{Script=Cyrillic}/u;
    // The language switch is the one string deliberately written in the OTHER language: on a Russian
    // page it reads "English" and on an English page "Русский", because a member looking for the
    // switch is looking for the language they want, not the one they are reading.
    const SWITCH: StringKey = 'login.switchLang';
    const keys = (Object.keys(ru) as StringKey[]).filter((key) => key !== SWITCH);

    const untranslated = keys.filter((key) => !cyrillic.test(ru[key]) && /\p{L}{4,}/u.test(ru[key]) && ru[key] === en[key]);
    expect(untranslated).toEqual([]);
    expect(keys.filter((key) => cyrillic.test(en[key]))).toEqual([]);
  });
});
