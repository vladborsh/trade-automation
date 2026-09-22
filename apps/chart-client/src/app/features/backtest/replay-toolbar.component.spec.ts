import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Timeframe } from '@trade-automation/contracts';
import { ReplayToolbarComponent } from './replay-toolbar.component';

function render(extra: Record<string, unknown> = {}) {
  TestBed.configureTestingModule({ imports: [ReplayToolbarComponent], providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(ReplayToolbarComponent);
  const inputs = { sessionName: 'BTC practice', sessionId: 's1', cursorMs: Date.UTC(2026, 8, 18, 23, 45), timeframe: '5m', balance: 10000, currency: 'USD', ...extra };
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, cmp: fixture.componentInstance };
}

describe('ReplayToolbarComponent', () => {
  it('shows the session, the cursor in UTC, the active timeframe and the balance', () => {
    const { el } = render();
    expect(el.querySelector('.name')?.textContent).toBe('BTC practice');
    expect(el.querySelector('[data-testid="replay-cursor"]')?.textContent).toBe('2026-09-18 23:45 UTC');
    expect(el.querySelector('.tf-btn.active')?.textContent?.trim()).toBe('5m');
    expect(el.querySelector('[data-testid="replay-balance"]')?.textContent).toBe('10,000.00 USD');
  });

  it('emits step and timeframe changes', () => {
    const { el, cmp } = render();
    const steps: unknown[] = [];
    const tfs: Timeframe[] = [];
    cmp.step.subscribe(() => steps.push(1));
    cmp.timeframeChange.subscribe((tf) => tfs.push(tf));
    el.querySelector<HTMLButtonElement>('[data-testid="replay-step"]')!.click();
    [...el.querySelectorAll<HTMLButtonElement>('.tf-btn')].find((b) => b.textContent?.trim() === '1h')!.click();
    expect(steps).toHaveLength(1);
    expect(tfs).toEqual(['1h']);
  });

  it('shows loading while candles are on their way; the step stays pressable, to queue one (T-037)', () => {
    const { el } = render({ loading: true });
    expect(el.querySelector('[data-testid="replay-loading"]')).not.toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-testid="replay-step"]')!.disabled).toBe(false);
    expect(el.querySelector('[data-testid="replay-step-queued"]')).toBeNull();
  });

  it('shows the queued step (T-037)', () => {
    const { el } = render({ loading: true, stepQueued: true });
    expect(el.querySelector('[data-testid="replay-step-queued"]')?.textContent).toBe('+1 step queued');
  });

  it('disables the step while the engine takes no presses (not started yet, or reloading)', () => {
    const { el } = render({ loading: true, stepReady: false });
    expect(el.querySelector<HTMLButtonElement>('[data-testid="replay-step"]')!.disabled).toBe(true);
  });

  it('shows the end of the period and any error', () => {
    const { el } = render({ atEnd: true, error: 'HTTP 503' });
    expect(el.querySelector('[data-testid="replay-end"]')).not.toBeNull();
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('HTTP 503');
  });

  it('a completed session says so and cannot be stepped or switched', () => {
    const { el } = render({ completed: true });
    expect(el.querySelector('[data-testid="replay-completed"]')?.textContent).toBe('completed');
    expect(el.querySelector<HTMLButtonElement>('[data-testid="replay-step"]')!.disabled).toBe(true);
    expect([...el.querySelectorAll<HTMLButtonElement>('.tf-btn')].every((b) => b.disabled)).toBe(true);
  });

  it('T-059: a halted session shows the numeric-limit message persistently and cannot be stepped or switched', () => {
    const message = 'This session has reached the numeric limit; create a new session';
    const { el } = render({ halted: message });
    const status = el.querySelector('[data-testid="replay-halted"]')!;
    expect(status.textContent).toBe(message);
    expect(status.getAttribute('role')).toBe('alert');
    expect(el.querySelector('[data-testid="replay-completed"]')).toBeNull(); // not "completed": it is not
    expect(el.querySelector<HTMLButtonElement>('[data-testid="replay-step"]')!.disabled).toBe(true);
    expect([...el.querySelectorAll<HTMLButtonElement>('.tf-btn')].every((b) => b.disabled)).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[data-testid="replay-play"]')!.disabled).toBe(true); // T-052's Play too
  });

  it('view-only: "viewing … — read only", no stepping, the timeframe still switchable, a way back', () => {
    const { el } = render({ viewingAt: Date.UTC(2026, 8, 16, 10, 5), cursorMs: Date.UTC(2026, 8, 16, 10, 5), completed: true });
    expect(el.querySelector('[data-testid="replay-viewing"]')?.textContent).toBe('viewing 2026-09-16 10:05 UTC — read only');
    expect(el.querySelector<HTMLButtonElement>('[data-testid="replay-step"]')!.disabled).toBe(true);
    expect([...el.querySelectorAll<HTMLButtonElement>('.tf-btn')].some((b) => b.disabled)).toBe(false);
    expect(el.querySelector('[data-testid="replay-back"]')?.getAttribute('href')).toBe('/sessions/s1');
    expect(el.querySelector('[data-testid="replay-completed"]')).toBeNull();
  });

  it('shows retrying and a one-line notice', () => {
    const { el } = render({ retrying: true, notice: 'Resynced with the server.' });
    expect(el.querySelector('[data-testid="replay-retrying"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="replay-notice"]')?.textContent).toBe('Resynced with the server.');
  });

  it('T-054: margin utilisation next to open risk, amber above 80 %; none when the account cannot be marked', () => {
    const margin = (u: number | null) => {
      TestBed.resetTestingModule();
      return render({ marginUtilisation: u }).el.querySelector('[data-testid="replay-margin"]');
    };
    expect(margin(0.34)?.textContent?.trim()).toBe('margin 34 %');
    expect(margin(0.34)!.classList.contains('amber')).toBe(false);
    expect(margin(0.8)!.classList.contains('amber')).toBe(false); // at 80 %: not yet
    expect(margin(0.81)!.classList.contains('amber')).toBe(true);
    expect(margin(null)).toBeNull();
  });

  it('T-052: Play emits a toggle and shows Pause while playing; the speed picker emits the chosen seconds', () => {
    const { el, cmp, fixture } = render();
    const toggles: unknown[] = [];
    const speeds: number[] = [];
    cmp.playToggle.subscribe(() => toggles.push(1));
    cmp.speedChange.subscribe((ms) => speeds.push(ms));
    const play = el.querySelector<HTMLButtonElement>('[data-testid="replay-play"]')!;
    expect(play.textContent?.trim()).toBe('▶ Play');
    expect(play.getAttribute('aria-pressed')).toBe('false');
    play.click();
    expect(toggles).toHaveLength(1);
    fixture.componentRef.setInput('playing', true);
    fixture.detectChanges();
    expect(play.textContent?.trim()).toBe('❚❚ Pause');
    const speed = el.querySelector<HTMLSelectElement>('[data-testid="replay-speed"]')!;
    expect([...speed.options].map((o) => o.textContent?.trim())).toEqual(['0.25 s', '0.5 s', '1 s', '2 s']);
    expect(speed.value).toBe('500'); // the default
    speed.value = '1000';
    speed.dispatchEvent(new Event('change'));
    expect(speeds).toEqual([1000]);
  });

  it('T-052: Play is off where a step is — not started, the end, completed — and absent while viewing', () => {
    const play = (extra: Record<string, unknown>) => {
      TestBed.resetTestingModule();
      return render(extra).el.querySelector<HTMLButtonElement>('[data-testid="replay-play"]');
    };
    expect(play({ stepReady: false })!.disabled).toBe(true);
    expect(play({ atEnd: true })!.disabled).toBe(true);
    expect(play({ completed: true })!.disabled).toBe(true);
    expect(play({ viewingAt: Date.UTC(2026, 8, 18, 10) })).toBeNull();
    expect(play({ atEnd: true, playing: true })!.disabled).toBe(false); // playing at the end, Pause still works
  });
});
