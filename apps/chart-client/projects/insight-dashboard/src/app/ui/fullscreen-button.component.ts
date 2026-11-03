import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { I18nService } from '../i18n/i18n.service';
import { FULLSCREEN_FALLBACK_CLASS, fullscreenMode } from './fullscreen';

/**
 * IB-099 item 3 — expands `target` to the whole screen and back. The element is not re-created,
 * so whatever it holds keeps its state: the instrument chart is the SAME lightweight-charts
 * instance, resized by its own ResizeObserver, which keeps the bar spacing (zoom) and the right
 * offset (scroll) — the lwc rule that a fresh chart cannot restore a logical range never applies.
 */
@Component({
  selector: 'app-fullscreen-button',
  standalone: true,
  templateUrl: './fullscreen-button.component.html',
  styleUrl: './fullscreen-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FullscreenButtonComponent {
  private readonly doc = inject(DOCUMENT);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly target = input.required<HTMLElement>();
  readonly active = signal(false);

  constructor() {
    // native: the browser's own Esc (and F11, and a swipe) leaves without asking us
    const onChange = () => this.active.set(this.doc.fullscreenElement === this.target());
    // fallback: Esc is ours to handle
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.active() && this.doc.fullscreenElement !== this.target()) this.exitFallback();
    };
    this.doc.addEventListener('fullscreenchange', onChange);
    this.doc.addEventListener('keydown', onKey);
    inject(DestroyRef).onDestroy(() => {
      this.doc.removeEventListener('fullscreenchange', onChange);
      this.doc.removeEventListener('keydown', onKey);
      if (this.active()) void this.exit();
    });
  }

  async toggle(): Promise<void> {
    if (this.active()) return this.exit();
    const el = this.target();
    if (fullscreenMode(this.doc, el) === 'native') {
      try {
        await el.requestFullscreen();
        return;
      } catch {
        // refused (no user gesture, a policy): the layer still works
      }
    }
    el.classList.add(FULLSCREEN_FALLBACK_CLASS);
    this.doc.body.style.overflow = 'hidden';
    this.active.set(true);
  }

  private async exit(): Promise<void> {
    if (this.doc.fullscreenElement === this.target()) {
      await this.doc.exitFullscreen();
      return;
    }
    this.exitFallback();
  }

  private exitFallback(): void {
    this.target().classList.remove(FULLSCREEN_FALLBACK_CLASS);
    this.doc.body.style.overflow = '';
    this.active.set(false);
  }
}
