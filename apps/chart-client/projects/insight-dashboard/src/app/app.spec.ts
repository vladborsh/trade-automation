import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { CalendarAlertsService } from './core/calendar-alerts.service';
import { SessionService } from './core/session.service';
import { AlertsToggleComponent } from './ui/alerts-toggle.component';

/** IB-075 — the shell offers the Health link to an admin only; market and instrument to everyone. */
function render(admin: boolean): HTMLElement {
  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter([]),
      { provide: SessionService, useValue: { isAdmin: signal(admin), ensure: async () => null } },
      { provide: CalendarAlertsService, useValue: { start: () => undefined } },
    ],
  });
  // the alerts switch is not under test here; keep it out rather than fake its whole service
  TestBed.overrideComponent(App, { remove: { imports: [AlertsToggleComponent] }, add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const links = (root: HTMLElement) => [...root.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));

describe('App nav', () => {
  it('a member sees market and instrument, and no Health link', () => {
    const hrefs = links(render(false));
    expect(hrefs).toContain('/market');
    expect(hrefs).not.toContain('/health');
  });

  it('an admin also sees Health', () => {
    expect(links(render(true))).toContain('/health');
  });
});
