import { navLinks } from './nav-links';

describe('navLinks', () => {
  it('offers sessions and the terminal to every signed-in user', () => {
    expect(navLinks('user').map((l) => l.path)).toEqual(['/sessions', '/terminal']);
  });

  it('adds user management for the admin only', () => {
    expect(navLinks('admin').map((l) => l.path)).toEqual(['/sessions', '/terminal', '/admin/users']);
    expect(navLinks(null).map((l) => l.path)).not.toContain('/admin/users');
  });
});
