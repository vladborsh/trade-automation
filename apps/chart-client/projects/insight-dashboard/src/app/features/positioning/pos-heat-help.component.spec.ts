import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { WEB_POSITIONING_SIGNALS } from '@trade-automation/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { HELP_SEEN_PREFIX } from '../../ui/help-block-state';
import { PosHeatHelpComponent } from './pos-heat-help.component';
import { SIGNAL_HELP } from './pos-heat-help';

/**
 * IB-121 — the heat table's help: the mockup's text (as corrected by the TL ruling) word for word,
 * one collapsed line on Market, open on the first /positioning visit, a word for every signal, and
 * swatches painted by the cells' own rules.
 */
function mount(compact: boolean, lang: 'ru' | 'en' = 'ru') {
  TestBed.configureTestingModule({ imports: [PosHeatHelpComponent] });
  const i18n = TestBed.inject(I18nService);
  i18n.setLang(lang);
  const f = TestBed.createComponent(PosHeatHelpComponent);
  f.componentRef.setInput('compact', compact);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const details = () => el.querySelector('details') as HTMLDetailsElement;
  return { el, details, t: (k: StringKey) => i18n.t(k) };
}
const text = (n: Element | null) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();

beforeEach(() => localStorage.removeItem(`${HELP_SEEN_PREFIX}positioning-heat`));
afterEach(() => TestBed.resetTestingModule());

describe('«Что значит подсветка и как читать таблицу» (IB-121)', () => {
  function mockupItems(): string[] {
    const html = readFileSync(join(process.cwd(), '..', '..', 'architecture', 'mockups', 'market-2-2026-11-05', 'mockup.html'), 'utf8');
    const start = html.indexOf('<summary>Что значит подсветка и как читать таблицу</summary>');
    expect(start).toBeGreaterThan(0);
    const block = html.slice(start, html.indexOf('</details>', start));
    return [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').replace(/ ([.,;:)])/g, '$1').trim());
  }
  const rendered = (el: HTMLElement) =>
    [...el.querySelectorAll('li')].map((li) => text(li).replace(/ ([.,;:)])/g, '$1'));

  it('is the mockup\'s text, word for word', () => {
    const expected = mockupItems();
    expect(expected).toHaveLength(7);
    expect(expected[0]).toContain('оценить нельзя — данных мало или нет');
    const { el } = mount(false);
    expect(text(el.querySelector('summary'))).toBe('Что значит подсветка и как читать таблицу');
    expect(rendered(el)).toEqual(expected);
  });

  it('on /positioning: open on the first visit, collapsed on the next', () => {
    expect(mount(false).details().open).toBe(true);
    TestBed.resetTestingModule();
    expect(mount(false).details().open).toBe(false);
  });

  it('on Market: one collapsed line «Что значит подсветка?», and it does not use up /positioning\'s first visit', () => {
    const market = mount(true);
    expect(text(market.el.querySelector('summary'))).toBe('Что значит подсветка?');
    expect(market.details().open).toBe(false);
    expect(localStorage.getItem(`${HELP_SEEN_PREFIX}positioning-heat`)).toBeNull();
    TestBed.resetTestingModule();
    expect(mount(false).details().open).toBe(true);
  });

  for (const lang of ['ru', 'en'] as const) {
    it(`names every signal word the table can show (${lang})`, () => {
      const { el, t } = mount(false, lang);
      const labels = [...el.querySelectorAll('.signal-help i')].map(text);
      expect(labels).toEqual(SIGNAL_HELP.map((e) => t(e.label)));
      for (const s of WEB_POSITIONING_SIGNALS) {
        const word = t(`positioning.signal.${s}` as StringKey);
        const entry = SIGNAL_HELP.find((e) => (e.signals as readonly string[]).includes(s));
        const label = t(entry!.label);
        if (entry!.signals.length === 1) expect(label).toBe(word);
        // the shared crowd line: «толпа в лонгах / шортах» — the long word whole, the short one's last word
        else expect(label.startsWith(word) || label.endsWith(word.split(' ').at(-1) as string)).toBe(true);
      }
    });
  }

  it('draws one swatch per level with the cells\' data-heat values', () => {
    const { el } = mount(false);
    expect([...el.querySelectorAll('.sw')].map((s) => s.getAttribute('data-heat'))).toEqual(['notable', 'unusual', 'extreme', 'none']);
  });

  it('the swatches and the table cells take their fill from the same rules (_heat.scss), and neither restates them', () => {
    const dir = join(process.cwd(), 'projects', 'insight-dashboard', 'src', 'app', 'features', 'positioning');
    const read = (f: string) => readFileSync(join(dir, f), 'utf8');
    expect(read('_heat.scss')).toContain("&[data-heat='none']");
    for (const f of ['pos-heat.component.scss', 'pos-heat-help.component.scss']) {
      const scss = read(f);
      expect(scss).toContain("@use './heat'");
      expect(scss).toContain('@include heat.fills');
      expect(scss).not.toContain('data-heat');
    }
  });
});
