import { vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { User } from '@trade-automation/contracts';
import { AuthService } from '../../core/auth/auth.service';
import { AppNavComponent } from './app-nav.component';

function render(user: User) {
  const logout = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    imports: [AppNavComponent],
    providers: [provideRouter([]), { provide: AuthService, useValue: { user: signal(user).asReadonly(), logout } }],
  });
  const fixture = TestBed.createComponent(AppNavComponent);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, logout };
}

describe('AppNavComponent', () => {
  const user: User = { id: '00000000-0000-4000-8000-000000000003', email: 'u@example.com', role: 'user' };

  it('shows the signed-in email and the role-appropriate links', () => {
    const { el } = render(user);
    expect(el.querySelector('[data-testid="current-user"]')?.textContent).toBe('u@example.com');
    expect([...el.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Sessions', 'Terminal']);
  });

  it('adds Users for the admin', () => {
    const { el } = render({ ...user, role: 'admin' });
    expect([...el.querySelectorAll('a')].map((a) => a.textContent)).toContain('Users');
  });

  it('signs out through AuthService', () => {
    const { el, logout } = render(user);
    el.querySelector<HTMLButtonElement>('button')!.click();
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
