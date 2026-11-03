/**
 * IB-099 item 3 — which full screen a browser can give an element.
 *
 * `native`: the Fullscreen API (desktop browsers, Android). `fallback`: a fixed layer over the
 * whole viewport, for browsers that refuse element fullscreen — iOS Safari on an iPhone allows
 * it for video only and reports `fullscreenEnabled` false. Both exit by the same button and Esc.
 */
export type FullscreenMode = 'native' | 'fallback';

export function fullscreenMode(doc: { fullscreenEnabled?: boolean }, el: { requestFullscreen?: unknown }): FullscreenMode {
  return doc.fullscreenEnabled === true && typeof el.requestFullscreen === 'function' ? 'native' : 'fallback';
}

/** The class the fallback puts on the element; its rule is global (styles.css), the element is the page's. */
export const FULLSCREEN_FALLBACK_CLASS = 'fs-fallback';
