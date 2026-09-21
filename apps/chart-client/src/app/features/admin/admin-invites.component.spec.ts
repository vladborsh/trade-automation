import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { AdminInvite, AdminUser } from '@trade-automation/contracts';
import { AdminInvitesComponent } from './admin-invites.component';
import type { CreatedInvite } from './admin.store';

const NOW = Date.now();
const INVITES: AdminInvite[] = [
  { id: 'open', email: 'new@example.com', createdAt: NOW - 1000, expiresAt: NOW + 86_400_000, usedAt: null, usedBy: null },
  { id: 'expired', email: null, createdAt: NOW - 9e8, expiresAt: NOW - 1000, usedAt: null, usedBy: null },
  { id: 'used', email: null, createdAt: NOW - 5000, expiresAt: NOW + 86_400_000, usedAt: NOW - 100, usedBy: 'u9' },
];
const USERS: AdminUser[] = [{ id: 'u9', email: 'joined@example.com', role: 'user', createdAt: NOW, disabledAt: null }];

function setup(created: CreatedInvite | null = null) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [AdminInvitesComponent] });
  const fixture = TestBed.createComponent(AdminInvitesComponent);
  fixture.componentRef.setInput('invites', INVITES);
  fixture.componentRef.setInput('users', USERS);
  fixture.componentRef.setInput('created', created);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const creates: (string | undefined)[] = [];
  fixture.componentInstance.create.subscribe((e) => creates.push(e));
  const submit = (email: string) => {
    const input = el.querySelector<HTMLInputElement>('input[name="inviteEmail"]')!;
    input.value = email;
    input.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };
  return { fixture, el, creates, submit };
}

describe('AdminInvitesComponent', () => {
  it('creates with no email, with a valid email, and refuses an invalid one', () => {
    const { el, creates, submit } = setup();
    submit('');
    submit(' new@example.com ');
    expect(creates).toEqual([undefined, 'new@example.com']);
    submit('nope');
    expect(creates).toHaveLength(2);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('valid email');
  });

  it('lists invites with their status; revoke only for unused ones (expired included); never a URL', () => {
    const { fixture, el } = setup();
    const revoked: string[] = [];
    fixture.componentInstance.revoke.subscribe((id) => revoked.push(id));
    const row = (id: string) => el.querySelector<HTMLElement>(`[data-testid="invite-${id}"]`)!;
    expect(row('open').textContent).toContain('open');
    expect(row('expired').textContent).toContain('expired');
    expect(row('used').textContent).toContain('used by joined@example.com');
    expect(row('used').querySelector('button')).toBeNull();
    row('expired').querySelector('button')!.click();
    expect(revoked).toEqual(['expired']);
    expect(el.textContent).not.toContain('/invite/');
  });

  it('shows the one-time URL with a copy button and the "shown only once" warning', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { fixture, el } = setup({ url: 'http://localhost:4220/invite/tok-123', expiresAt: NOW + 1000, email: null });
    const panel = el.querySelector<HTMLElement>('[aria-label="New invite link"]')!;
    expect(panel.textContent).toContain('shown only this once');
    expect(panel.querySelector<HTMLInputElement>('input')!.value).toBe('http://localhost:4220/invite/tok-123');

    [...panel.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Copy')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(writeText).toHaveBeenCalledWith('http://localhost:4220/invite/tok-123');
    expect(panel.textContent).toContain('Copied.');

    const dismissed = vi.fn();
    fixture.componentInstance.dismissCreated.subscribe(dismissed);
    [...panel.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Done')!.click();
    expect(dismissed).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('a clipboard failure asks to copy by hand', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const { fixture, el } = setup({ url: 'http://x/invite/t', expiresAt: NOW, email: 'a@example.com' });
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Copy')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('copy it by hand');
    expect(el.textContent).toContain('For a@example.com.');
    vi.unstubAllGlobals();
  });
});
