import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WEB_INSIGHT_KEYS } from '@trade-automation/contracts';
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

/** Tokens §11 keeps English in **every** template: units, codes, and names the venue owns. */
const ALLOWED_EVERYWHERE = new Set([
  // units and separators that read the same either way
  'GB', 'ms', 's', 'm', 'h', 'd', '%', '·', '?', '—', '/', ':', ',', '(', ')', '|', '+',
  // timeframes and modes come from the API as codes
  '1m', '5m', '15m', '1h', '4h', '1d', 'ws', 'degraded', 'perp', 'spot',
  // venue and series names, as the venue and the schema spell them
  'binance', 'bybit', 'okx', 'futures', 'candles_1m', 'candles_agg', 'open_interest_5m', 'long_short_5m',
]);

/**
 * Tokens allowed in ONE template, because that is where the argument for them was made.
 *
 * dev-3's observation on IB-BUG-004: a global allow-list hides its words everywhere, and `long`,
 * `short`, `time`, `price` and `side` are ordinary English. Allowed globally, a future single-word
 * heading or cell of prose would pass unchallenged in any page — the guard would be quietly weaker
 * than the rule it enforces. Scoped, the carve-out stays where it was argued: the liquidations
 * table, whose columns a reader matches against the venue's own UI and our logs.
 *
 * Adding a page does not inherit anything here; a new carve-out is a new entry, with its reason.
 */
const ALLOWED_BY_TEMPLATE: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    join('features', 'instrument', 'instrument.component.html'),
    // §11 "field names in tables of raw data": the liquidations table's columns and the stored
    // enum values the API sends as a row's side. Prose around them is translated; these are not
    // prose. If a member ever reports them as opaque, the answer is a legend or tooltip in their
    // language beside the table — never translating the field names themselves (ruled 2026-09-28).
    ['time', 'UTC', 'venue', 'side', 'price', 'qty', 'notional', 'long', 'short'],
  ],
  [
    join('features', 'market', 'market.component.html'),
    // §11 "field names in tables of raw data" again: the current-caps table. `B` and `USD` are
    // units; `coin`, `cap`, `price`, `share` name the columns of the venue's own figures. The
    // prose around the table — every sentence a reader actually reads — is in the tables.
    ['coin', 'cap', 'USD', 'price', 'share', '24h', '7d'],
  ],
];

/** The tokens allowed in `file`: the global set, plus any carve-out that names this template. */
export function allowedFor(file: string): ReadonlySet<string> {
  const scoped = ALLOWED_BY_TEMPLATE.filter(([suffix]) => file.endsWith(suffix)).flatMap(([, words]) => words);
  return new Set([...ALLOWED_EVERYWHERE, ...scoped]);
}

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
  const withoutTags = stripTags(withoutEntities);
  return withoutTags
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Removes tags, respecting quoted attribute values.
 *
 * A naive `/<[^>]*>/` ends the tag at the first `>`, and an Angular binding may hold one inside
 * quotes — `[class.up]="(row.change24h ?? 0) > 0"`. The tail of that attribute then leaked into
 * the scanned text and the check reported `class.down` and `row.change24h` as untranslated prose.
 * The tempting repair is to allow those words, which would blind the guard to real prose; the
 * right one is to parse the tag properly.
 */
export function stripTags(html: string): string {
  let out = '';
  let inTag = false;
  let quote: '"' | "'" | null = null;
  for (const char of html) {
    if (inTag) {
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        inTag = false;
        out += '\n';
      }
      continue;
    }
    if (char === '<') {
      inTag = true;
      continue;
    }
    out += char;
  }
  return out;
}

/** A fragment is suspicious when it contains a word of two or more letters that `allowed` lacks. */
export function suspiciousWords(fragment: string, allowed: ReadonlySet<string> = ALLOWED_EVERYWHERE): string[] {
  return fragment
    .split(/[\s|,:()/]+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}_%·?—]+|[^\p{L}\p{N}_%·?—]+$/gu, ''))
    .filter((word) => word.length > 0)
    .filter((word) => !allowed.has(word))
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
      const allowed = allowedFor(file);
      const offenders = userFacingText(readFileSync(file, 'utf8')).flatMap((fragment) => suspiciousWords(fragment, allowed));
      expect(offenders).toEqual([]);
    },
  );
});

describe('stripTags', () => {
  it('keeps a `>` inside a quoted attribute inside the tag', () => {
    // the binding that exposed this: its tail used to leak out and be read as prose
    expect(stripTags('<td [class.up]="(row.change24h ?? 0) > 0">x</td>').trim()).toBe('x');
  });

  it('still removes ordinary tags and keeps their text', () => {
    expect(stripTags('<p class="muted">hello</p>').trim()).toBe('hello');
  });
});

describe('the English-by-rule allow-list is scoped to where it was argued', () => {
  const instrument = join(APP_DIR, 'features', 'instrument', 'instrument.component.html');
  const health = join(APP_DIR, 'features', 'health', 'health.component.html');

  it("the liquidations table's field names pass in ITS template", () => {
    for (const word of ['time', 'venue', 'side', 'price', 'qty', 'notional', 'long', 'short']) {
      expect(suspiciousWords(word, allowedFor(instrument))).toEqual([]);
    }
  });

  it('the same words are caught in any other template — the carve-out does not leak', () => {
    for (const word of ['side', 'price', 'long', 'short']) {
      expect(suspiciousWords(word, allowedFor(health))).toEqual([word]);
    }
  });

  it('units and venue names stay allowed everywhere, in both', () => {
    for (const file of [instrument, health]) {
      expect(suspiciousWords('binance perp 1m ws', allowedFor(file))).toEqual([]);
    }
  });

  it('a new template inherits no carve-out', () => {
    const future = join(APP_DIR, 'features', 'market', 'market.component.html');
    expect(suspiciousWords('side', allowedFor(future))).toEqual(['side']);
  });

  it('prose is still caught in the template that owns the carve-out', () => {
    // the carve-out is a list of identifiers, not a licence for sentences in that file
    expect(suspiciousWords('Recent liquidations by venue', allowedFor(instrument))).toEqual(['Recent', 'liquidations', 'by']);
  });
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
    /**
     * IB-BUG-009: the L/S panel's title. The brief's six titles are «Цена, Открытый интерес,
     * Ликвидации лонг/шорт, Дельта/CVD, Фандинг, **Long/Short**» — the last written in English
     * on purpose, as the name of the ratio rather than a sentence about it. Named here, like the
     * switch, rather than widened into a pattern: one key, one reason, visible in the diff.
     *
     * Note the brief writes «лонг/шорт» in Cyrillic for the liquidations title, so this is a
     * judgement about one term of art, not a general carve-out for English titles.
     *
     * Ruled by the Tech Lead on 2026-10-07 reviewing IB-BUG-009: exempt it, because it is **the
     * venues' own term** and the brief's literal title. So this entry is settled, not pending —
     * if it ever changes it changes in `ru.ts`, and this line goes with it.
     */
    const TERMS_OF_ART: readonly StringKey[] = ['instrument.panel.longShort'];
    const exempt = new Set<StringKey>([SWITCH, ...TERMS_OF_ART]);
    const keys = (Object.keys(ru) as StringKey[]).filter((key) => !exempt.has(key));

    // A `{placeholder}` is a parameter name, not words a member reads: `'{value}%'` is the same
    // string in both tables because it is pure formatting, and reading `value` as untranslated
    // prose would make this guard reject every format-only entry. Stripped before the test.
    const prose = (text: string): string => text.replace(/\{\w+\}/g, '');
    const untranslated = keys.filter(
      (key) => !cyrillic.test(ru[key]) && /\p{L}{4,}/u.test(prose(ru[key])) && ru[key] === en[key],
    );
    expect(untranslated).toEqual([]);
    expect(keys.filter((key) => cyrillic.test(en[key]))).toEqual([]);
  });
});

/** Every `.ts` and `.html` under `dir`, specs excluded: a key used only by a spec is not used. */
function codeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...codeFiles(path));
    else if ((entry.endsWith('.ts') || entry.endsWith('.html')) && !entry.endsWith('.spec.ts')) out.push(path);
  }
  return out;
}

/**
 * WD-012 — every key in the tables is used. Parity between en, ru and keys.ts cannot see a key that
 * nothing reads: 12 such keys had piled up (IB-039's liquidation panel, the instrument redesign, the
 * market shell, the password pages) before WD-012 deleted them. A key counts as used when:
 * - it appears as a quoted literal in app code outside i18n/ (specs excluded);
 * - it starts with a prefix the code builds keys from (`prefix.${…}` or `'prefix.' + …`);
 * - or the SERVER emits it: the insight sentence keys (`WEB_INSIGHT_KEYS`, contracts) arrive as data.
 */
describe('every key is used', () => {
  const sources = codeFiles(APP_DIR)
    .filter((path) => !path.includes(`${join('app', 'i18n')}`))
    .map((path) => readFileSync(path, 'utf8'));
  const corpus = sources.join('\n');
  const prefixes = [
    ...[...corpus.matchAll(/`([a-zA-Z0-9_.]+\.)\$\{/g)].map((m) => m[1]),
    ...[...corpus.matchAll(/'([a-zA-Z0-9_.]+\.)'\s*\+/g)].map((m) => m[1]),
  ];
  const serverKeys = new Set<string>(WEB_INSIGHT_KEYS);
  const used = (key: string) =>
    corpus.includes(`'${key}'`) || corpus.includes(`"${key}"`) || serverKeys.has(key) || prefixes.some((p) => key.startsWith(p));

  it('reads the app code it claims to (the walk is not empty, and a known key is found)', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(used('nav.market')).toBe(true);
    expect(used('no.such.key.anywhere')).toBe(false);
  });

  it('has no key that nothing reads', () => {
    expect((Object.keys(en) as StringKey[]).filter((key) => !used(key))).toEqual([]);
  });
});
