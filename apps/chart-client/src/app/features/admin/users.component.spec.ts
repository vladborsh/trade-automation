import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { UsersComponent } from './users.component';

describe('UsersComponent (placeholder)', () => {
  it('renders the nav and the page heading', () => {
    TestBed.configureTestingModule({
      imports: [UsersComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: { user: signal(null).asReadonly() } }],
    });
    const fixture = TestBed.createComponent(UsersComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-nav')).not.toBeNull();
    expect(el.querySelector('h1')?.textContent).toBe('Users');
  });
});
