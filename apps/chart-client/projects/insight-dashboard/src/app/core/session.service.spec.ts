import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { InsightApiClient } from './insight-api.client';
import { SessionService } from './session.service';

/** IB-075 — one `/auth/me` per known member; an unknown one is asked again (login happens elsewhere). */
const body = (role: 'admin' | 'member') => ({ user: { id: 1, tgUserId: 111, role, lang: 'en', login: null } });

function setup(me: () => Promise<unknown>) {
  const spy = vi.fn(me);
  TestBed.configureTestingModule({ providers: [{ provide: InsightApiClient, useValue: { me: spy } }] });
  return { service: TestBed.inject(SessionService), me: spy };
}

describe('SessionService', () => {
  it('reads the member once and then answers from memory', async () => {
    const { service, me } = setup(async () => body('admin'));
    expect((await service.ensure())?.role).toBe('admin');
    expect((await service.ensure())?.role).toBe('admin');
    expect(me).toHaveBeenCalledTimes(1);
    expect(service.isAdmin()).toBe(true);
  });

  it('shares one request between concurrent callers', async () => {
    const { service, me } = setup(async () => body('member'));
    await Promise.all([service.ensure(), service.ensure(), service.ensure()]);
    expect(me).toHaveBeenCalledTimes(1);
    expect(service.isAdmin()).toBe(false);
  });

  it('a failed /auth/me is "nobody", and the next ensure() asks again — so a later login shows up', async () => {
    let calls = 0;
    const { service, me } = setup(async () => {
      calls += 1;
      if (calls === 1) throw new Error('UNAUTHENTICATED');
      return body('admin');
    });
    expect(await service.ensure()).toBeNull();
    expect(service.isAdmin()).toBe(false);
    expect((await service.ensure())?.role).toBe('admin');
    expect(me).toHaveBeenCalledTimes(2);
    expect(service.isAdmin()).toBe(true);
  });
});

describe('IB-079: the session follows login and logout without a reload', () => {
  it('logout, then a login as SOMEONE ELSE: the nav sees the new member, not the old one', async () => {
    let who: 'admin' | 'member' = 'admin';
    const { service, me } = setup(async () => body(who));
    expect((await service.ensure())?.role).toBe('admin');

    service.signedOut();
    expect(service.user()).toBeNull();
    expect(service.isAdmin()).toBe(false);

    who = 'member';
    expect((await service.ensure())?.role).toBe('member'); // asked again, not answered from memory
    expect(me).toHaveBeenCalledTimes(2);
  });

  it('signedIn replaces whoever was known, with no request', async () => {
    const { service, me } = setup(async () => body('admin'));
    await service.ensure();
    service.signedIn({ id: 2, tgUserId: 222, role: 'member', lang: 'ru', login: 'bob' });
    expect(service.isAdmin()).toBe(false);
    expect((await service.ensure())?.login).toBe('bob');
    expect(me).toHaveBeenCalledTimes(1);
  });
});

describe('IB-079: a /auth/me in flight across a logout does not bring the old member back', () => {
  it('signedOut while ensure() is pending: the late answer is dropped', async () => {
    let answer!: (v: unknown) => void;
    const { service } = setup(() => new Promise((r) => { answer = r; }));
    const pending = service.ensure();
    service.signedOut();
    answer(body('admin'));
    await pending;
    expect(service.user()).toBeNull();
    expect(service.isAdmin()).toBe(false);
  });
});
