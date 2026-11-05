import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { CalendarAlertsService } from './core/calendar-alerts.service';
import { SessionService } from './core/session.service';
import { AlertsToggleComponent } from './ui/alerts-toggle.component';
import { AccountMenuComponent } from './ui/account-menu.component';

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
  TestBed.overrideComponent(App, { remove: { imports: [AlertsToggleComponent, AccountMenuComponent] }, add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
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
    expect(hrefs).not.toContain('/admin/logins'); // IB-079: nor the login journal
    expect(hrefs).not.toContain('/admin/alerts'); // IB-112: nor the alerts page
  });

  it('an admin also sees Health and (IB-079) the login journal', () => {
    const hrefs = links(render(true));
    expect(hrefs).toContain('/health');
    expect(hrefs).toContain('/admin/logins');
  });
});

describe('IB-099: the admin pages say what they are', () => {
  it('grouped under an «admin» label, named by what they hold', () => {
    const root = render(true);
    const group = root.querySelector('nav .admin') as HTMLElement;
    expect([...group.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/health', '/admin/logins', '/admin/members', '/admin/alerts']); // IB-035: members; IB-112: OI alerts
    expect(group.querySelector('.admin-label')?.textContent?.trim()).toBeTruthy();
  });

  it('a member does not even get the group', () => {
    expect(render(false).querySelector('nav .admin')).toBeNull();
  });
});


/** IB-132 — owner ruling 2026-11-05: «ликвидации» is a main-nav item, between «рынок» and «позиционирование». */
describe('IB-132: the liquidations nav item', () => {
  it('sits between market and positioning, before instrument', () => {
    expect(links(render(false))).toEqual(['/market', '/liquidations', '/positioning', '/instrument/BTCUSDT']);
  });

  it('is active on /liquidations with the page filters in the query, and market is not', async () => {
    @Component({ template: '', standalone: true })
    class Blank {}
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([{ path: '**', component: Blank }]),
        { provide: SessionService, useValue: { isAdmin: signal(false), ensure: async () => null } },
        { provide: CalendarAlertsService, useValue: { start: () => undefined } },
      ],
    });
    TestBed.overrideComponent(App, { remove: { imports: [AlertsToggleComponent, AccountMenuComponent] }, add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/liquidations?p=7d&side=short');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const active = [...root.querySelectorAll('nav a.active')].map((a) => a.getAttribute('href'));
    expect(active).toEqual(['/liquidations']);
    expect(root.querySelector('nav a[href="/liquidations"]')?.textContent?.trim()).toBeTruthy();
  });
});
