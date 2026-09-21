import type { UserRole } from '@trade-automation/contracts';

export interface NavLink {
  path: string;
  label: string;
}

/** §2.3 — the authenticated destinations; Users only for the admin (decision 30: users, not sessions). */
export function navLinks(role: UserRole | null): NavLink[] {
  const links: NavLink[] = [
    { path: '/sessions', label: 'Sessions' },
    { path: '/terminal', label: 'Terminal' },
  ];
  if (role === 'admin') {
    links.push({ path: '/admin/users', label: 'Users' });
  }
  return links;
}
