// Bars pinned to the bottom of the viewport (the phone tab bar, the sticky Post load / Book now
// action bar, the Profile save bar) must never cover the field that has keyboard focus (WCAG 2.2
// SC 2.4.11). html's scroll-padding-bottom in styles.css keeps a focused field above them: the tab
// bar is reserved in CSS, and a sticky bar reports its own height through PINNED_BAR_VAR.

/** Custom property on <html> holding how far a pinned bar reaches up from the bottom of the viewport. */
export const PINNED_BAR_VAR = '--pinned-bar-inset';

/**
 * Pixels a bar covers at the bottom of the viewport: its height plus its `bottom` offset while it is
 * sticky or fixed, and nothing while it sits in the page flow (the action bar from 1024px up).
 */
export function pinnedBarInset(position: string, bottom: string, height: number): number {
  if (position !== 'sticky' && position !== 'fixed') return 0;
  const offset = Number.parseFloat(bottom);
  return Math.ceil(height + (Number.isFinite(offset) ? Math.max(0, offset) : 0));
}

/**
 * Ref callback for a pinned bar: `<div className="action-bar" ref={pinnedBarRef}>`. While the bar is
 * mounted it keeps PINNED_BAR_VAR up to date as the bar resizes (wrapping buttons, rotating a phone,
 * crossing the desktop breakpoint), and clears it when the bar goes away.
 */
export function pinnedBarRef(el: HTMLElement | null): (() => void) | undefined {
  if (!el) return undefined;
  const root = document.documentElement;
  const update = () => {
    const style = getComputedStyle(el);
    const inset = pinnedBarInset(style.position, style.bottom, el.getBoundingClientRect().height);
    root.style.setProperty(PINNED_BAR_VAR, `${inset}px`);
  };
  update();
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
  observer?.observe(el);
  window.addEventListener('resize', update);
  return () => {
    observer?.disconnect();
    window.removeEventListener('resize', update);
    root.style.removeProperty(PINNED_BAR_VAR);
  };
}
