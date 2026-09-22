import { TestBed } from '@angular/core/testing';
import { TradeControlsComponent } from './trade-controls.component';

function render(disabled = false) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [TradeControlsComponent] });
  const fixture = TestBed.createComponent(TradeControlsComponent);
  fixture.componentRef.setInput('disabled', disabled);
  fixture.detectChanges();
  document.body.appendChild(fixture.nativeElement);
  const el = fixture.nativeElement as HTMLElement;
  const btn = (id: string) => el.querySelector<HTMLButtonElement>(`[data-testid="trade-${id}"]`)!;
  return { fixture, el, btn };
}

describe('TradeControlsComponent (T-048)', () => {
  afterEach(() => document.body.querySelectorAll('app-trade-controls').forEach((n) => n.remove()));

  it('Buy, Sell and Place, each tooltip naming its hotkey', () => {
    const { btn } = render();
    expect(btn('buy').textContent).toContain('Buy');
    expect(btn('buy').title).toContain('hotkey B');
    expect(btn('sell').title).toContain('hotkey S');
    expect(btn('place').title).toContain('hotkey Enter');
  });

  it('Buy / Sell ask for a long / short tool, Place for the order', () => {
    const { fixture, btn } = render();
    const drawn: string[] = [];
    let placed = 0;
    fixture.componentInstance.draw.subscribe((side) => drawn.push(side));
    fixture.componentInstance.place.subscribe(() => placed++);
    btn('buy').click();
    btn('sell').click();
    btn('place').click();
    expect(drawn).toEqual(['long', 'short']);
    expect(placed).toBe(1);
  });

  it('all disabled on a complete session', () => {
    const { btn } = render(true);
    expect(['buy', 'sell', 'place'].every((id) => btn(id).disabled)).toBe(true);
  });

  it('a mouse click hands focus back to the page; a keyboard press keeps it', () => {
    const { btn } = render();
    btn('buy').focus();
    btn('buy').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(document.activeElement).not.toBe(btn('buy'));
    btn('place').focus();
    btn('place').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(document.activeElement).toBe(btn('place'));
  });
});
