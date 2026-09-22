import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CloseSoundSetting } from '../../core/replay/close-sound.setting';
import { CloseSoundToggleComponent } from './close-sound-toggle.component';

describe('CloseSoundToggleComponent (T-051)', () => {
  it('shows the setting and toggles it', () => {
    const on = signal(true);
    const setting = { on, toggle: () => on.update((v) => !v) };
    TestBed.configureTestingModule({ imports: [CloseSoundToggleComponent], providers: [{ provide: CloseSoundSetting, useValue: setting }] });
    const fixture = TestBed.createComponent(CloseSoundToggleComponent);
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="close-sound-toggle"]')!;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.title).toContain('on (click to mute)');
    btn.click();
    fixture.detectChanges();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.title).toContain('off');
  });
});
