import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvSchema, validateEnv } from '../src/config/env.schema';

/**
 * WD-004 — `.env.example` is the only place a new machine learns the variable names, so it is
 * pinned to the schema rather than kept in sync by hand:
 *  - every schema key is listed, plus the keys main.ts reads outside the schema;
 *  - every line is commented out, so a fresh copy boots exactly like no .env at all;
 *  - a value shown is the schema default (or a `<placeholder>`), never an invented one;
 *  - a secret shows its name only.
 */
const EXAMPLE = readFileSync(join(__dirname, '..', '.env.example'), 'utf8');
// Read straight from process.env in src/main.ts, not validated by the schema.
const OUTSIDE_SCHEMA = ['CORS_ORIGIN'];
const SECRETS = ['CAPITAL_COM_IDENTIFIER', 'CAPITAL_COM_PASSWORD', 'CAPITAL_COM_API_KEY', 'ADMIN_PASSWORD', 'WS_SHARED_TOKEN'];

const templateLines = [...EXAMPLE.matchAll(/^# ([A-Z][A-Z0-9_]*)=(.*)$/gm)].map(([, key, value]) => ({ key, value }));
const expectedKeys = [...Object.keys(EnvSchema.shape), ...OUTSIDE_SCHEMA].sort();

describe('apps/signal-server/.env.example', () => {
  it('lists every schema key (and the out-of-schema ones) exactly once, and nothing else', () => {
    expect(templateLines.length).toBeGreaterThan(0); // the regex matched something: an empty match proves nothing
    const keys = templateLines.map((l) => l.key);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    expect([...keys].sort()).toEqual(expectedKeys);
  });

  it('assigns nothing: every non-blank line is a comment', () => {
    const live = EXAMPLE.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));
    expect(live).toEqual([]);
  });

  it('shows only schema defaults or <placeholders>', () => {
    const defaults = validateEnv({}) as Record<string, unknown>;
    const wrong = templateLines
      .filter(({ key }) => !OUTSIDE_SCHEMA.includes(key))
      .filter(({ value }) => value !== '' && !/<[a-z_]+>/.test(value))
      .filter(({ key, value }) => String(defaults[key]) !== value)
      .map(({ key, value }) => `${key}=${value} (schema default: ${String(defaults[key])})`);
    expect(wrong).toEqual([]);
  });

  it('carries no value for a secret', () => {
    for (const key of SECRETS) {
      expect(templateLines.find((l) => l.key === key)).toEqual({ key, value: '' });
    }
  });
});
