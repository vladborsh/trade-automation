/**
 * IB-BUG-041 — is there more of the table to the right of what the box shows?
 *
 * On a phone the heat table scrolls inside its own box (D16) and the browser hides the scrollbar
 * until it is touched, so the box's edge cut a number in half and read as «the table runs off the
 * screen». The fade on the right edge says «there is more»; this decides when it shows.
 *
 * `SUBPIXEL_SLACK`: a zoomed or fractional-DPR layout can leave `scrollLeft + clientWidth` a
 * fraction short of `scrollWidth` at the far right, which would keep the fade on for ever.
 */
export const SUBPIXEL_SLACK = 1;

export interface ScrollBox {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

export function hasMoreRight(box: ScrollBox): boolean {
  return box.scrollWidth - box.clientWidth - box.scrollLeft > SUBPIXEL_SLACK;
}
