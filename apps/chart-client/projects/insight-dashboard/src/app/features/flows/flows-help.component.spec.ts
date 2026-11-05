import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nService } from '../../i18n/i18n.service';
import { HELP_SEEN_PREFIX } from '../../ui/help-block-state';
import { FlowsHelpComponent } from './flows-help.component';

/**
 * IB-138 — the flows block's help. The source it is compared against is the design itself:
 * `architecture/market-round3-design-2026-11-05.md` §5, «The text for the block», read from disk,
 * so an edit to either side without the other fails here.
 */
function mount(lang: 'ru' | 'en' = 'ru') {
  TestBed.configureTestingModule({ imports: [FlowsHelpComponent] });
  TestBed.inject(I18nService).setLang(lang);
  const f = TestBed.createComponent(FlowsHelpComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { el, details: el.querySelector('details') as HTMLDetailsElement };
}
const text = (n: Element | null) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
const items = (el: HTMLElement) => [...el.querySelectorAll('li')].map(text);

/** The design's bullets: `**Lead** — text` → `Lead — text`; the closing line is the «quoted» sentence. */
function designItems(): string[] {
  const md = readFileSync(join(process.cwd(), '..', '..', 'architecture', 'market-round3-design-2026-11-05.md'), 'utf8');
  const start = md.indexOf('### The text for the block');
  expect(start).toBeGreaterThan(0);
  const section = md.slice(start, md.indexOf('\n## ', start));
  return [...section.matchAll(/^- (.+)$/gm)].map((m) => {
    const closing = /^A closing line: «(.+)»\.?$/.exec(m[1]);
    return (closing ? closing[1] : m[1].replace(/\*\*/g, '')).replace(/\s+/g, ' ').trim();
  });
}

beforeEach(() => localStorage.removeItem(`${HELP_SEEN_PREFIX}flows`));
afterEach(() => TestBed.resetTestingModule());

describe('«Как читать эти показатели?» — the flows help (IB-138)', () => {
  it('is design §5\'s text, word for word, in the tiles\' order', () => {
    const expected = designItems();
    expect(expected).toHaveLength(5);
    expect(expected[0].startsWith('DVOL — ')).toBe(true);
    expect(expected[4]).toBe('Это описание того, что происходит сейчас, а не прогноз.');
    expect(items(mount('ru').el)).toEqual(expected);
  });

  it('one collapsed line that never opens by itself, and remembers nothing', () => {
    const first = mount();
    expect(text(first.el.querySelector('summary'))).toBe('Как читать эти показатели?');
    expect(first.details.open).toBe(false);
    expect(localStorage.getItem(`${HELP_SEEN_PREFIX}flows`)).toBeNull();
    TestBed.resetTestingModule();
    expect(mount().details.open).toBe(false);
  });

  it('en: the same five items, translated (no ru left, the venues and the 30 days kept)', () => {
    const en = items(mount('en').el);
    expect(en).toHaveLength(5);
    for (const line of en) expect(line).not.toMatch(/[а-яё]/i);
    expect(en[0]).toContain('30 days');
    expect(en[1]).toContain('on OKX');
    expect(en[2]).toContain('DefiLlama');
    expect(en[3]).toContain('the last hour');
    expect(en[4]).toContain('not a forecast');
  });
});
