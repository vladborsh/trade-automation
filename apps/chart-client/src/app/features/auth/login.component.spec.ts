import { vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { LoginComponent } from './login.component';

function setup(login: ReturnType<typeof vi.fn>, returnUrl?: string) {
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [provideRouter([]), { provide: AuthService, useValue: { login } }],
  });
  const fixture = TestBed.createComponent(LoginComponent);
  if (returnUrl !== undefined) fixture.componentRef.setInput('returnUrl', returnUrl);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  fixture.detectChanges();
  return { fixture, navigate, el: fixture.nativeElement as HTMLElement };
}

async function fillAndSubmit(fixture: ComponentFixture<LoginComponent>, email: string, password: string) {
  const el = fixture.nativeElement as HTMLElement;
  for (const [name, value] of [['email', email], ['password', password]]) {
    const input = el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
  el.querySelector('form')!.dispatchEvent(new Event('submit'));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('LoginComponent', () => {
  it('signs in and goes to the (sanitised) returnUrl', async () => {
    const login = vi.fn().mockResolvedValue({});
    const { fixture, navigate } = setup(login, '/terminal');

    await fillAndSubmit(fixture, ' admin@example.com ', 'admin-password');
    expect(login).toHaveBeenCalledWith('admin@example.com', 'admin-password');
    expect(navigate).toHaveBeenCalledWith('/terminal');
  });

  it('refuses an off-site returnUrl and lands on /sessions', async () => {
    const { fixture, navigate } = setup(vi.fn().mockResolvedValue({}), '//evil.example');
    await fillAndSubmit(fixture, 'admin@example.com', 'admin-password');
    expect(navigate).toHaveBeenCalledWith('/sessions');
  });

  it('shows the server error and stays on the page', async () => {
    const { fixture, navigate, el } = setup(vi.fn().mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'x')));
    await fillAndSubmit(fixture, 'admin@example.com', 'wrong');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Wrong email or password.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not call the server while the form is incomplete', async () => {
    const login = vi.fn();
    const { fixture, el } = setup(login);
    await fillAndSubmit(fixture, 'not-an-email', '');
    expect(login).not.toHaveBeenCalled();
    expect(el.querySelectorAll('.field-error')).toHaveLength(2);
  });
});
