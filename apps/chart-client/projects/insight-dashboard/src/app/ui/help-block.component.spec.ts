import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP_SEEN_PREFIX } from './help-block-state';
import { HelpBlockComponent } from './help-block.component';

/** IB-120 — `app-help-block` as a host uses it: a title, projected body, a storage key. */
@Component({
  standalone: true,
  imports: [HelpBlockComponent],
  template: `<app-help-block [title]="'How to use this'" storageKey="spec" [openOnFirstVisit]="first()"><p class="projected">body text</p></app-help-block>`,
})
class HostComponent {
  readonly first = input(true);
}

function render(first = true) {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const f = TestBed.createComponent(HostComponent);
  f.componentRef.setInput('first', first);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { f, el, details: () => el.querySelector('details') as HTMLDetailsElement };
}

beforeEach(() => localStorage.removeItem(`${HELP_SEEN_PREFIX}spec`));
afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

describe('HelpBlockComponent', () => {
  it('shows the title as the summary and projects the host\'s body', () => {
    const { el } = render();
    expect(el.querySelector('summary')?.textContent?.trim()).toBe('How to use this');
    expect(el.querySelector('details .projected')?.textContent).toBe('body text');
  });

  it('open on the first visit, collapsed on the next', () => {
    expect(render().details().open).toBe(true);
    TestBed.resetTestingModule();
    expect(render().details().open).toBe(false);
  });

  it('renders open when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    expect(render().details().open).toBe(true);
  });

  it('openOnFirstVisit=false: one collapsed line, even on a first visit', () => {
    expect(render(false).details().open).toBe(false);
    expect(localStorage.getItem(`${HELP_SEEN_PREFIX}spec`)).toBeNull();
  });

  it('the reader can open it again after it collapsed, and the state follows', () => {
    render();
    TestBed.resetTestingModule();
    const { f, details } = render();
    details().open = true;
    details().dispatchEvent(new Event('toggle'));
    f.detectChanges();
    expect(details().open).toBe(true);
  });
});
