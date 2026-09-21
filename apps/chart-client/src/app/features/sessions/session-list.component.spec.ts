import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SessionListComponent } from './session-list.component';

describe('SessionListComponent (placeholder)', () => {
  it('renders the nav and a way into the terminal', () => {
    TestBed.configureTestingModule({
      imports: [SessionListComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: { user: signal(null).asReadonly() } }],
    });
    const fixture = TestBed.createComponent(SessionListComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-nav')).not.toBeNull();
    expect(el.querySelector('main a')?.getAttribute('href')).toBe('/terminal');
  });
});
