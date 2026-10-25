// The scrolling Screen's bar maths (src/ui/scroll-phase.ts), with and without a navigation header.
// Numbers as on an iPhone 17: a 62pt status bar, a large title laid out 8pt into the content, 41pt tall.
import { expect, test } from 'vitest';

import { scrollBar, scrollPhase } from '../src/ui/scroll-phase';

test('under a navigation header, the bar is the header and the content reserves nothing', () => {
  const bar = scrollBar({ headerHeight: 116, safeTop: 62 });
  expect(bar).toEqual({ height: 116, reserved: 0 });
  // The scroll view insets by the header, so at rest the offset is -116.
  expect(scrollPhase(-116, bar, 49)).toBe('top');
  expect(scrollPhase(-115, bar, 49)).toBe('scrolled');
  expect(scrollPhase(-68, bar, 49)).toBe('scrolled');
  expect(scrollPhase(-67, bar, 49)).toBe('compact');
  expect(scrollPhase(400, bar, null)).toBe('scrolled');
});

test('without a header, the content leaves room for a compact bar under the status bar', () => {
  const bar = scrollBar({ headerHeight: 0, safeTop: 62 });
  expect(bar).toEqual({ height: 106, reserved: 44 });
  // The scroll view insets by the status bar only, so at rest the offset is -62, and the title
  // sits 44pt lower than under a header: its bottom is at 44 + 49.
  expect(scrollPhase(-62, bar, 93)).toBe('top');
  expect(scrollPhase(-61, bar, 93)).toBe('scrolled');
  expect(scrollPhase(-14, bar, 93)).toBe('scrolled');
  expect(scrollPhase(-13, bar, 93)).toBe('compact');
});
