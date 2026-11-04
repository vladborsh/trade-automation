import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nService } from '../../i18n/i18n.service';
import { LEGENDS_HIDDEN_KEY } from './chart-prefs';
import { LegendToggleComponent } from './legend-toggle.component';

/** IB-105 — the on-chart legend switch: one state, remembered, read by the page's chart column. */
@Component({
  standalone: true,
  imports: [LegendToggleComponent],
  template: `<div class="column" [class.legends-hidden]="toggle.hidden()"><app-legend-toggle #toggle /></div>`,
})
class Host {}

describe('LegendToggleComponent', () => {
  beforeEach(() => localStorage.removeItem(LEGENDS_HIDDEN_KEY));
  afterEach(() => localStorage.removeItem(LEGENDS_HIDDEN_KEY));

  function setup() {
    TestBed.configureTestingModule({ imports: [Host] });
    TestBed.inject(I18nService).setLangFromUser('en');
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    return { f, column: el.querySelector('.column') as HTMLElement, button: () => el.querySelector('button.legend-toggle') as HTMLButtonElement };
  }

  it('shown by default; a click hides every legend (the column class), remembers it, and the same button brings them back', () => {
    const { f, column, button } = setup();
    expect(column.classList.contains('legends-hidden')).toBe(false);
    expect(button().getAttribute('aria-label')).toBe('Hide legend');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    button().click();
    f.detectChanges();
    expect(column.classList.contains('legends-hidden')).toBe(true);
    expect(localStorage.getItem(LEGENDS_HIDDEN_KEY)).toBe('1');
    expect(button().getAttribute('aria-label')).toBe('Show legend'); // the same control, at the same spot
    expect(button().querySelector('.strike')).not.toBeNull();
    button().click();
    f.detectChanges();
    expect(column.classList.contains('legends-hidden')).toBe(false);
    expect(localStorage.getItem(LEGENDS_HIDDEN_KEY)).toBe('0');
  });

  it('a remembered «hidden» opens hidden', () => {
    localStorage.setItem(LEGENDS_HIDDEN_KEY, '1');
    const { column, button } = setup();
    expect(column.classList.contains('legends-hidden')).toBe(true);
    expect(button().getAttribute('aria-label')).toBe('Show legend');
  });

  it('the glyph is an icon, not words', () => {
    const { button } = setup();
    expect(button().querySelector('svg')).not.toBeNull();
    expect(button().textContent?.trim()).toBe('');
  });
});
