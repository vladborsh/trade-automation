import { vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CHIME, type Chime, type ChimeState } from '../audio/chime';
import { CloseSoundSetting } from './close-sound.setting';

function setup(stored: string | null) {
  localStorage.removeItem('bt.closeSound');
  if (stored !== null) localStorage.setItem('bt.closeSound', stored);
  const chime = { state: signal<ChimeState>('suspended'), arm: vi.fn(async () => undefined), play: vi.fn() } satisfies Chime;
  TestBed.configureTestingModule({ providers: [{ provide: CHIME, useValue: chime }] });
  return { setting: TestBed.inject(CloseSoundSetting), chime };
}

describe('CloseSoundSetting (T-051)', () => {
  afterEach(() => localStorage.removeItem('bt.closeSound'));

  it('on by default; plays the chime while on', () => {
    const { setting, chime } = setup(null);
    expect(setting.on()).toBe(true);
    setting.play();
    expect(chime.play).toHaveBeenCalledTimes(1);
  });

  it('the toggle mutes, is remembered per browser, and a muted setting plays nothing', () => {
    const { setting, chime } = setup(null);
    setting.toggle();
    expect(setting.on()).toBe(false);
    expect(localStorage.getItem('bt.closeSound')).toBe('off');
    setting.play();
    expect(chime.play).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    expect(setup('off').setting.on()).toBe(false); // a new page reads it back
  });

  it('turning it on (a click) arms the chime; a workspace gesture arms it only while on and suspended', () => {
    const { setting, chime } = setup('off');
    setting.arm();
    expect(chime.arm).not.toHaveBeenCalled();
    setting.toggle();
    expect(chime.arm).toHaveBeenCalledTimes(1);
    setting.arm();
    expect(chime.arm).toHaveBeenCalledTimes(2);
    chime.state.set('running');
    setting.arm();
    expect(chime.arm).toHaveBeenCalledTimes(2);
  });
});
