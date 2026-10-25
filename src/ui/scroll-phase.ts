// The maths behind a scrolling Screen's bar, kept free of React Native so it can be tested.

/** Height of a compact bar on a screen without a navigation header (tabs), under the status bar. */
export const COMPACT_BAR_HEIGHT = 44;

/**
 * How far a scrolling screen has moved under the bar at the top: still at the `top`, content
 * `scrolled` under it (the bar gets a background), or the large title gone under it (`compact`: the
 * bar shows the title too).
 */
export type ScrollPhase = 'top' | 'scrolled' | 'compact';

export type ScrollBar = {
  /** Height of the bar from the top of the screen: the header's, or the status bar plus our own. */
  height: number;
  /**
   * Room the content leaves above itself for the bar, beyond what the scroll view's automatic
   * inset (the header, or else only the status bar) gives it. 0 under a header.
   */
  reserved: number;
};

export function scrollBar({ headerHeight, safeTop }: { headerHeight: number; safeTop: number }): ScrollBar {
  if (headerHeight > 0) return { height: headerHeight, reserved: 0 };
  return { height: safeTop + COMPACT_BAR_HEIGHT, reserved: COMPACT_BAR_HEIGHT };
}

/**
 * The phase for a scroll offset. At rest the offset is minus the scroll view's inset, which is the
 * bar's height less what the content reserved, so `under` (the content y at the bar's bottom edge)
 * starts at `reserved`. `titleBottom` is the large title's bottom in content coordinates, or null
 * when there is no title (or it hasn't been laid out yet).
 */
export function scrollPhase(offsetY: number, bar: ScrollBar, titleBottom: number | null): ScrollPhase {
  const under = offsetY + bar.height;
  if (under <= bar.reserved) return 'top';
  return titleBottom !== null && under >= titleBottom ? 'compact' : 'scrolled';
}
