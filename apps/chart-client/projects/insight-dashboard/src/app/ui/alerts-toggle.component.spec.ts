import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CalendarAlertsService, type AlertPermission } from '../core/calendar-alerts.service';
import { I18nService } from '../i18n/i18n.service';
import { AlertsToggleComponent } from './alerts-toggle.component';

describe('AlertsToggleComponent (IB-061)', () => {
  function render(active: boolean, permission: AlertPermission, pushActive = false) {
    const fake = { active: signal(active), permission: signal(permission), pushActive: signal(pushActive), toggle: async () => undefined };
    TestBed.configureTestingModule({
      imports: [AlertsToggleComponent],
      providers: [{ provide: CalendarAlertsService, useValue: fake }],
    });
    TestBed.inject(I18nService).setLangFromUser('en');
    const fixture = TestBed.createComponent(AlertsToggleComponent);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  }

  it('says on or off, and its hint names the open-tab limit', () => {
    const off = render(false, 'default');
    expect(off.textContent?.trim()).toBe('Event alerts: off');
    expect(off.title).toContain('only while a dashboard tab is open');
    expect(off.disabled).toBe(false);
  });

  it('IB-069: with push subscribed, the hint says it works with the dashboard closed', () => {
    const button = render(true, 'granted', true);
    expect(button.title).toContain('also with the dashboard closed, as long as the browser is running');
  });

  it('shows on when active', () => {
    TestBed.resetTestingModule();
    expect(render(true, 'granted').getAttribute('aria-pressed')).toBe('true');
  });

  it('is disabled, with the reason, when the browser blocks notifications', () => {
    const button = render(false, 'denied');
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('blocked');
  });
});
