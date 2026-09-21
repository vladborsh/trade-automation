import { TestBed } from '@angular/core/testing';
import type { AdminUser } from '@trade-automation/contracts';
import { AdminUsersTableComponent } from './admin-users-table.component';

const T = Date.UTC(2026, 8, 21, 9, 30);
const USERS: AdminUser[] = [
  { id: 'admin', email: 'admin@example.com', role: 'admin', createdAt: T, disabledAt: null },
  { id: 'u1', email: 'one@example.com', role: 'user', createdAt: T, disabledAt: null },
  { id: 'u2', email: 'off@example.com', role: 'user', createdAt: T, disabledAt: T },
];

function setup(inputs: { confirming?: string | null; busy?: string | null } = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [AdminUsersTableComponent] });
  const fixture = TestBed.createComponent(AdminUsersTableComponent);
  fixture.componentRef.setInput('users', USERS);
  fixture.componentRef.setInput('currentUserId', 'admin');
  fixture.componentRef.setInput('confirming', inputs.confirming ?? null);
  fixture.componentRef.setInput('busy', inputs.busy ?? null);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const row = (email: string) => el.querySelector<HTMLElement>(`[data-testid="user-${email}"]`)!;
  const button = (email: string, label: string) =>
    [...row(email).querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  return { fixture, el, row, button };
}

describe('AdminUsersTableComponent', () => {
  it('lists email, role, created and status — and nothing that links anywhere (decision 30)', () => {
    const { el, row } = setup();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(row('one@example.com').textContent).toContain('user');
    expect(row('one@example.com').textContent).toContain('2026-09-21 09:30 UTC');
    expect(row('one@example.com').textContent).toContain('active');
    expect(row('off@example.com').textContent).toContain('disabled');
    expect(el.querySelector('a')).toBeNull();
  });

  it("the admin's own row cannot be disabled, with a hint", () => {
    const { row, button } = setup();
    expect(button('admin@example.com', 'Disable')!.disabled).toBe(true);
    expect(row('admin@example.com').textContent).toContain('You cannot disable your own account.');
  });

  it('disable asks first, then confirms or cancels', () => {
    const { fixture, button } = setup();
    const asked: string[] = [];
    fixture.componentInstance.askDisable.subscribe((id) => asked.push(id));
    button('one@example.com', 'Disable')!.click();
    expect(asked).toEqual(['u1']);

    const confirming = setup({ confirming: 'u1' });
    const confirmed: string[] = [];
    let cancelled = 0;
    confirming.fixture.componentInstance.confirmDisable.subscribe((id) => confirmed.push(id));
    confirming.fixture.componentInstance.cancelDisable.subscribe(() => cancelled++);
    expect(confirming.row('one@example.com').textContent).toContain('signs one@example.com out everywhere at once');
    confirming.button('one@example.com', 'Confirm disable')!.click();
    confirming.button('one@example.com', 'Cancel')!.click();
    expect(confirmed).toEqual(['u1']);
    expect(cancelled).toBe(1);
  });

  it('a disabled user can be enabled; actions wait while another is in flight', () => {
    const { fixture, button } = setup();
    const enabled: string[] = [];
    fixture.componentInstance.enable.subscribe((id) => enabled.push(id));
    button('off@example.com', 'Enable')!.click();
    expect(enabled).toEqual(['u2']);

    const busy = setup({ busy: 'u1' });
    expect(busy.button('off@example.com', 'Enable')!.disabled).toBe(true);
    expect(busy.button('one@example.com', 'Disable')!.disabled).toBe(true);
  });
});
