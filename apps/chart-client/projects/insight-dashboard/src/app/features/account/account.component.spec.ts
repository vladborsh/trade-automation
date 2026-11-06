import { TestBed } from '@angular/core/testing';
import { ApiError } from '@backtest-core/api/api-error';
import { InsightApiClient } from '../../core/insight-api.client';
import { SessionService } from '../../core/session.service';
import { AccountComponent } from './account.component';

function setup(change: (b: unknown) => Promise<void>) {
  const sent: unknown[] = [];
  TestBed.configureTestingModule({
    imports: [AccountComponent],
    providers: [{ provide: InsightApiClient, useValue: {
      changePassword: async (b: unknown) => { sent.push(b); return change(b); },
      // IB-035: the settings section the page now embeds
      memberSettings: async () => ({ lang: 'en', calendarAlerts: true, oiAlerts: false, oiAlertsVisible: false, liqAlerts: false, liqAlertsVisible: false, fundingAlerts: false, fundingAlertsVisible: false, levelAlerts: false, levelAlertsVisible: false }),
    } }],
  });
  TestBed.inject(SessionService).signedIn({ id: 2, tgUserId: 222, role: 'member', lang: 'en', login: 'bob' });
  const fixture = TestBed.createComponent(AccountComponent);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, sent };
}

describe('AccountComponent (IB-079)', () => {
  it('changes the password, says the other devices are out, and clears the fields', async () => {
    const { cmp, sent } = setup(async () => undefined);
    cmp.current.set('bob password one');
    cmp.next.set('bob password two');
    cmp.repeat.set('bob password two');
    await cmp.submit();
    expect(sent).toEqual([{ current: 'bob password one', next: 'bob password two' }]);
    expect(cmp.changed()).toBe(true);
    expect([cmp.current(), cmp.next(), cmp.repeat()]).toEqual(['', '', '']);
  });

  it('the new password may not be the login, and that is caught before the server', async () => {
    const { cmp, sent } = setup(async () => undefined);
    cmp.current.set('bob password one');
    cmp.next.set('BOB');
    cmp.repeat.set('BOB');
    await cmp.submit();
    expect(sent).toEqual([]);
    expect(cmp.error()?.key).toBe('rule.passwordShort');
  });

  it('a wrong current password is said plainly and the page stays', async () => {
    const { cmp } = setup(async () => { throw new ApiError<string>(401, 'INVALID_CREDENTIALS', 'x'); });
    cmp.current.set('nope nope nope');
    cmp.next.set('bob password two');
    cmp.repeat.set('bob password two');
    await cmp.submit();
    expect(cmp.error()?.key).toBe('account.wrongCurrent');
    expect(cmp.changed()).toBe(false);
  });
});
