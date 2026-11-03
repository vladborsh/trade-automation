import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FULLSCREEN_FALLBACK_CLASS, fullscreenMode } from './fullscreen';
import { FullscreenButtonComponent } from './fullscreen-button.component';

/** IB-099 item 3 — the mode choice, and the fallback layer the unit DOM (no Fullscreen API) gets. */
describe('fullscreenMode', () => {
  it('native only where the API is offered AND enabled; iOS Safari (enabled false) gets the layer', () => {
    expect(fullscreenMode({ fullscreenEnabled: true }, { requestFullscreen: () => undefined })).toBe('native');
    expect(fullscreenMode({ fullscreenEnabled: false }, { requestFullscreen: () => undefined })).toBe('fallback');
    expect(fullscreenMode({}, {})).toBe('fallback');
  });
});

@Component({
  standalone: true,
  imports: [FullscreenButtonComponent],
  template: `<div #box class="box"></div><app-fullscreen-button [target]="box" />`,
})
class Host {}

describe('FullscreenButtonComponent — fallback layer', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [Host] });
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    return { f, box: el.querySelector('.box') as HTMLElement, button: el.querySelector('button') as HTMLButtonElement };
  }

  it('the button enters and leaves; the SAME element is expanded, nothing is re-created', async () => {
    const { f, box, button } = setup();
    button.click();
    await f.whenStable();
    expect(box.classList.contains(FULLSCREEN_FALLBACK_CLASS)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(f.nativeElement.querySelector('.box')).toBe(box);
    button.click();
    await f.whenStable();
    expect(box.classList.contains(FULLSCREEN_FALLBACK_CLASS)).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('Esc leaves the layer', async () => {
    const { f, box, button } = setup();
    button.click();
    await f.whenStable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(box.classList.contains(FULLSCREEN_FALLBACK_CLASS)).toBe(false);
  });
});
