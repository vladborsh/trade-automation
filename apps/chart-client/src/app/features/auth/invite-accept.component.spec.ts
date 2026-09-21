import { vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { InviteAcceptComponent } from './invite-accept.component';

async function setup(auth: { getInvite: ReturnType<typeof vi.fn>; acceptInvite?: ReturnType<typeof vi.fn> }) {
  TestBed.configureTestingModule({
    imports: [InviteAcceptComponent],
    providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
  });
  const fixture = TestBed.createComponent(InviteAcceptComponent);
  fixture.componentRef.setInput('token', 'tok-1');
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  await settle(fixture);
  return { fixture, navigate, el: fixture.nativeElement as HTMLElement };
}

async function settle(fixture: ComponentFixture<InviteAcceptComponent>) {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function type(el: HTMLElement, name: string, value: string) {
  const input = el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('InviteAcceptComponent', () => {
  it.each([
    [new ApiError(404, 'INVITE_UNKNOWN', 'x'), 'unknown', 'Invite not found'],
    [new ApiError(410, 'INVITE_USED', 'x'), 'used', 'Invite already used'],
    [new ApiError(410, 'INVITE_EXPIRED', 'x'), 'expired', 'Invite expired'],
  ])('shows the invite state for %s', async (err, state, heading) => {
    const { el } = await setup({ getInvite: vi.fn().mockRejectedValue(err) });
    expect(el.querySelector('[data-invite-state]')?.getAttribute('data-invite-state')).toBe(state);
    expect(el.querySelector('h1')?.textContent).toBe(heading);
    expect(el.querySelector('form')).toBeNull();
  });

  it('locks a pre-set email, sets the password and signs in', async () => {
    const getInvite = vi.fn().mockResolvedValue({ email: 'new@example.com', expiresAt: Date.UTC(2026, 8, 28) });
    const acceptInvite = vi.fn().mockResolvedValue({});
    const { fixture, el, navigate } = await setup({ getInvite, acceptInvite });

    expect(getInvite).toHaveBeenCalledWith('tok-1');
    const email = el.querySelector<HTMLInputElement>('input[name="email"]')!;
    expect(email.value).toBe('new@example.com');
    expect(email.readOnly).toBe(true);

    type(el, 'password', 'long-enough-pw');
    type(el, 'confirm', 'long-enough-pw');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle(fixture);

    expect(acceptInvite).toHaveBeenCalledWith('tok-1', 'new@example.com', 'long-enough-pw');
    expect(navigate).toHaveBeenCalledWith('/sessions');
  });

  it('validates the password before calling the server', async () => {
    const acceptInvite = vi.fn();
    const { fixture, el } = await setup({ getInvite: vi.fn().mockResolvedValue({ email: null, expiresAt: 0 }), acceptInvite });

    type(el, 'email', 'new@example.com');
    type(el, 'password', 'short');
    type(el, 'confirm', 'other');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle(fixture);

    expect(acceptInvite).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Use at least 10 characters.');
    expect(el.textContent).toContain('The passwords do not match.');
  });

  it('shows EMAIL_TAKEN as a form error, and an invite used meanwhile as its state', async () => {
    const acceptInvite = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'EMAIL_TAKEN', 'x'))
      .mockRejectedValueOnce(new ApiError(410, 'INVITE_USED', 'x'));
    const { fixture, el } = await setup({ getInvite: vi.fn().mockResolvedValue({ email: null, expiresAt: 0 }), acceptInvite });
    type(el, 'email', 'admin@example.com');
    type(el, 'password', 'long-enough-pw');
    type(el, 'confirm', 'long-enough-pw');

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('already exists');

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.querySelector('[data-invite-state]')?.getAttribute('data-invite-state')).toBe('used');
  });

  it('offers a retry when the lookup fails for a non-invite reason', async () => {
    const getInvite = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ email: null, expiresAt: 0 });
    const { fixture, el } = await setup({ getInvite });
    expect(el.querySelector('[data-invite-state]')?.getAttribute('data-invite-state')).toBe('error');

    el.querySelector<HTMLButtonElement>('button')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-invite-state]')?.getAttribute('data-invite-state')).toBe('valid');
  });
});
