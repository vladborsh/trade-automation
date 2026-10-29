import { TestBed } from '@angular/core/testing';
import { LoaderComponent } from './loader.component';

describe('LoaderComponent', () => {
  function render(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(LoaderComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('is a status with the label as its accessible name', () => {
    const el = render({ variant: 'block', label: 'Loading chart' });
    const status = el.querySelector('[role="status"]')!;
    expect(status.getAttribute('aria-label')).toBe('Loading chart');
    expect(el.textContent).toContain('Loading chart');
    expect(el.classList).toContain('block');
  });

  it('a skeleton draws the asked number of bars and no ring', () => {
    const el = render({ variant: 'skeleton', lines: 4, label: 'x' });
    expect(el.querySelectorAll('.bar').length).toBe(4);
    expect(el.querySelector('.ring')).toBeNull();
  });

  it('never draws zero bars', () => {
    expect(render({ variant: 'skeleton', lines: 0 }).querySelectorAll('.bar').length).toBe(1);
  });
});
