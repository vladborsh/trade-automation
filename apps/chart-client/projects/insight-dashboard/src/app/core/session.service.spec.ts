import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { InsightApiClient } from './insight-api.client';
import { SessionService } from './session.service';

/** IB-075 — one `/auth/me` per known member; an unknown one is asked again (login happens elsewhere). */
const body = (role: 'admin' | 'member') => ({ user: { id: 1, tgUserId: 111, role, lang: 'en' } });

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
