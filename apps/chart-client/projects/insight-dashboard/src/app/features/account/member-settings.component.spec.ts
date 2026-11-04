import { TestBed } from '@angular/core/testing';
import type { WebMemberSettings, WebMemberSettingsPatch } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { InsightApiClient } from '../../core/insight-api.client';
import { SessionService } from '../../core/session.service';
import { I18nService } from '../../i18n/i18n.service';
import { MemberSettingsComponent } from './member-settings.component';

/** IB-035 — the account page's settings: the bot's /lang and /calendar, on the site. */
async function setup(patchImpl?: (p: WebMemberSettingsPatch) => Promise<WebMemberSettings>, initial: Partial<WebMemberSettings> = {}) {
  const patches: WebMemberSettingsPatch[] = [];
  let stored: WebMemberSettings = { lang: 'ru', calendarAlerts: true, oiAlerts: false, oiAlertsVisible: false, ...initial };
  TestBed.configureTestingModule({
    imports: [MemberSettingsComponent],
    providers: [{
      provide: InsightApiClient,
      useValue: {
        memberSettings: async () => stored,
        updateMemberSettings: async (p: WebMemberSettingsPatch) => {
          patches.push(p);
          if (patchImpl) return patchImpl(p);
          stored = { ...stored, lang: (p.lang as 'ru' | 'en') ?? stored.lang, calendarAlerts: typeof p.calendarAlerts === 'boolean' ? p.calendarAlerts : stored.calendarAlerts, oiAlerts: typeof p.oiAlerts === 'boolean' ? p.oiAlerts : stored.oiAlerts };
          return stored;
        },
      },
    }],
  });
  const session = TestBed.inject(SessionService);
  session.signedIn({ id: 2, tgUserId: 222, role: 'member', lang: 'ru', login: 'bob' });
  const i18n = TestBed.inject(I18nService);
  i18n.setLang('ru');
  const fixture = TestBed.createComponent(MemberSettingsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, patches, session, i18n, el: fixture.nativeElement as HTMLElement };
}

describe('MemberSettingsComponent (IB-035)', () => {
  it('shows the stored language and the calendar switch', async () => {
    const { el } = await setup();
    expect((el.querySelector('select') as HTMLSelectElement).value).toBe('ru');
    expect((el.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(true);
  });

  it('a language change is saved, switches the interface at once, and updates the session\'s member', async () => {
    const { cmp, patches, session, i18n } = await setup();
    cmp.setLang('en');
    await new Promise((r) => setTimeout(r, 0));
    expect(patches).toEqual([{ lang: 'en' }]);
    expect(i18n.lang()).toBe('en');
    expect(session.user()?.lang).toBe('en');
    expect(cmp.status()).toBe('settings.saved');
  });

  it('the calendar switch sends a boolean, the value the bot\'s /calendar on|off would set', async () => {
    const { cmp, patches } = await setup();
    cmp.setCalendar(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(patches).toEqual([{ calendarAlerts: false }]);
    expect(cmp.settings()?.calendarAlerts).toBe(false);
  });

  it('a refused save says so and leaves the interface language alone', async () => {
    const { cmp, i18n } = await setup(async () => { throw new Error('400'); });
    cmp.setLang('en');
    await new Promise((r) => setTimeout(r, 0));
    expect(cmp.status()).toBe('settings.saveFailed');
    expect(i18n.lang()).toBe('ru');
  });

  it('IB-112: the OI alerts switch is absent unless the server says it is visible; when shown it sends exactly oiAlerts', async () => {
    const hidden = await setup();
    expect(hidden.el.textContent).not.toContain('Сигналы OI');
    expect(hidden.el.querySelectorAll('input[type=checkbox]')).toHaveLength(1);
    TestBed.resetTestingModule();
    const shown = await setup(undefined, { oiAlertsVisible: true });
    expect(shown.el.textContent).toContain('Сигналы OI в Telegram');
    shown.cmp.setOiAlerts(true);
    await shown.fixture.whenStable();
    expect(shown.patches).toEqual([{ oiAlerts: true }]);
    expect(shown.cmp.settings()?.oiAlerts).toBe(true);
  });
});
