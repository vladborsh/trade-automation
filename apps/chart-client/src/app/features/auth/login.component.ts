import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { safeReturnUrl } from '../../core/auth/return-url';
import { loginErrorMessage } from './auth-messages';
import { hasErrors, validateLogin } from './auth-form.validation';

/** backtest-app-system-design.md §2.3/§7.1 — `/login`, public. */
@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  /** `?returnUrl=` — where the guard was taking the user; sanitised before use. */
  readonly returnUrl = input<string | undefined>();

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly email = signal('');
  readonly password = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  private readonly submitted = signal(false);

  readonly fieldErrors = computed(() =>
    this.submitted() ? validateLogin({ email: this.email(), password: this.password() }) : {},
  );

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.submitted.set(true);
    if (this.busy() || hasErrors(this.fieldErrors())) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.email().trim(), this.password());
      await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
    } catch (err) {
      this.error.set(loginErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
