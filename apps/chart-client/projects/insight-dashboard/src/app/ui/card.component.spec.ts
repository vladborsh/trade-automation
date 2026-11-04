import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CardComponent } from './card.component';

/** IB-106 — the card's slots land where §7.2 puts them, and the heading names the region. */
@Component({
  standalone: true,
  imports: [CardComponent],
  template: `
    <app-card heading="Где ликвидируют" [subtitle]="sub">
      <select cardActions><option>от $100k</option></select>
      <p class="content">rows</p>
      <p cardConclusion class="conclusion">Вывод: …</p>
    </app-card>`,
})
class HostComponent {
  sub: string | null = '24ч, кого выносит сильнее';
}

describe('CardComponent', () => {
  function render(sub: string | null = '24ч, кого выносит сильнее') {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.sub = sub;
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('app-card') as HTMLElement;
  }

  it('heading row: h2, subtitle, then the actions slot at its end; content; «Вывод» last', () => {
    const card = render();
    const head = card.querySelector('.head')!;
    expect([...head.children].map((c) => c.tagName.toLowerCase() + (c.className ? `.${c.className}` : ''))).toEqual(['h2', 'p.sub', 'div.actions']);
    expect(head.querySelector('.actions select')).not.toBeNull();
    expect(card.querySelector('.body .content')?.textContent).toBe('rows');
    expect(card.lastElementChild?.classList).toContain('conclusion');
  });

  it('the heading names the region, and every card gets its own id', () => {
    const card = render();
    const id = card.querySelector('h2')!.id;
    expect(card.getAttribute('role')).toBe('region');
    expect(card.getAttribute('aria-labelledby')).toBe(id);
    expect(id).toMatch(/^card-h-\d+$/);
    expect(render().querySelector('h2')!.id).not.toBe(id);
  });

  it('no subtitle → no empty line', () => {
    expect(render(null).querySelector('.sub')).toBeNull();
  });
});
