import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvSchema, validateEnv } from '../src/config/env.schema';

/**
 * WD-004 — `.env.example` is the only place a new machine learns the variable names, so it is
 * pinned to the schema rather than kept in sync by hand:
 *  - every schema key is listed (a new key without a template line fails here, not on the new machine);
 *  - every line is commented out, so a fresh copy boots exactly like no .env at all;
 *  - a value shown is the schema default (or a `<placeholder>`), never an invented one;
 *  - a secret shows its name only.
 */
const EXAMPLE = readFileSync(join(__dirname, '..', '.env.example'), 'utf8');
const SECRETS = ['TELEGRAM_BOT_TOKEN', 'WEB_PUSH_VAPID_PRIVATE'];

const templateLines = [...EXAMPLE.matchAll(/^# ([A-Z][A-Z0-9_]*)=(.*)$/gm)].map(([, key, value]) => ({ key, value }));
const schemaKeys = Object.keys(EnvSchema.innerType().shape).sort();

describe('apps/insight-bot/.env.example', () => {
  it('lists every schema key exactly once, and nothing the schema does not know', () => {
    expect(templateLines.length).toBeGreaterThan(0); // the regex matched something: an empty match proves nothing
    const keys = templateLines.map((l) => l.key);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    expect([...keys].sort()).toEqual(schemaKeys);
  });

  it('assigns nothing: every non-blank line is a comment', () => {
    const live = EXAMPLE.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));
    expect(live).toEqual([]);
  });

  it('shows only schema defaults or <placeholders>', () => {
    const defaults = validateEnv({}) as Record<string, unknown>;
    const wrong = templateLines
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
