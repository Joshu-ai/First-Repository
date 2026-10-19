// Keeps keyboard focus on the page when the element holding it goes away.
//
// The main flows replace the button that was just used: "Request load" turns into "Message shipper"
// and "Withdraw request" once the booking reloads, a withdrawn or delivered trip leaves its list, an
// accepted request leaves the dashboard panel. Browsers then drop focus to <body>, which sends
// screen-reader and keyboard users back to the top of the document. The keeper remembers where focus
// was inside <main> (the element and its position among its siblings, up the tree) and, when that
// element is removed, moves focus to whatever now sits in its place: the new primary action, the next
// card in the list, or the nearest control before it. When the whole page changed it falls back to
// the page heading. Modal uses rescueFocus() when the button that opened it is gone.

/** Elements a keyboard user can Tab to. */
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

interface Step {
  node: Element;
  parent: Element;
  index: number;
}

interface Remembered {
  root: HTMLElement;
  path: string;
  /** From the focused element up to (not including) root. */
  chain: Step[];
  /**
   * A map the element was in. Leaflet redraws its pins on every zoom, and focusing a pin outside the
   * view scrolls the map's clipped box out of line, so focus goes back to the map itself.
   */
  map: HTMLElement | null;
}

let remembered: Remembered | null = null;

function isTabbable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.matches(TABBABLE) || el.tabIndex < 0) return false;
  if (el.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
  return el.getClientRects().length > 0;
}

function firstTabbable(el: Element): HTMLElement | null {
  if (isTabbable(el)) return el;
  for (const candidate of el.querySelectorAll(TABBABLE)) if (isTabbable(candidate)) return candidate;
  return null;
}

function lastTabbable(el: Element): HTMLElement | null {
  const all = [...el.querySelectorAll(TABBABLE)].reverse();
  for (const candidate of all) if (isTabbable(candidate)) return candidate;
  return isTabbable(el) ? el : null;
}

/** Records where focus is, when it is inside root and not inside a dialog (dialogs return focus themselves). */
function remember(root: HTMLElement, target: Element): void {
  if (target.closest('dialog')) return;
  if (!root.contains(target) || target === root) {
    remembered = null;
    return;
  }
  const chain: Step[] = [];
  for (let node: Element = target; node !== root && node.parentElement; node = node.parentElement) {
    const parent = node.parentElement;
    chain.push({ node, parent, index: Array.prototype.indexOf.call(parent.children, node) });
  }
  remembered = { root, path: window.location.pathname, chain, map: target.closest<HTMLElement>('.leaflet-container') };
}

/** Focuses the page heading in <main>: the last resort when focus has nowhere sensible to go. */
export function focusPageHeading(): void {
  const main = document.querySelector<HTMLElement>('main');
  if (main) focusHeading(main);
}

/** The page's h1 (made focusable), or the landmark itself. */
function focusHeading(root: HTMLElement): void {
  const heading = root.querySelector<HTMLElement>('h1');
  if (heading) {
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
    heading.focus();
  } else {
    root.focus();
  }
}

/**
 * Moves focus to the control that now sits where the remembered one was: at the same position among
 * its siblings, then the ones after it, then the ones before it, one level up at a time; an ancestor
 * that is itself focusable (a section with tabindex="-1") stops the search. Falls back to the page
 * heading when nothing near is left. Returns false when there is nothing remembered for this page.
 */
export function rescueFocus(): boolean {
  const state = remembered;
  if (!state || !state.root.isConnected || state.path !== window.location.pathname) return false;
  const { root, chain, map } = state;
  if (map?.isConnected && map.tabIndex >= 0) {
    map.focus({ preventScroll: true });
    return true;
  }
  // The lowest remembered ancestor that is still on the page.
  const level = chain.findIndex((step) => step.parent.isConnected && root.contains(step.parent));
  if (level < 0) {
    focusHeading(root);
    return true;
  }
  let parent: Element = chain[level].parent;
  let index = chain[level].index;
  // A child already searched as a whole on the level below, so not searched again.
  let searched: Element | null = null;
  // The page container directly under root holds the whole page: below it, a replaced page gets its heading.
  while (parent !== root && parent.parentElement !== root) {
    const kids = [...parent.children];
    for (let i = Math.max(0, index); i < kids.length; i++) {
      if (kids[i] === searched) continue;
      const found = firstTabbable(kids[i]);
      if (found) return focusOn(found);
    }
    for (let i = Math.min(index, kids.length) - 1; i >= 0; i--) {
      if (kids[i] === searched) continue;
      const found = lastTabbable(kids[i]);
      if (found) return focusOn(found);
    }
    if (parent instanceof HTMLElement && parent.hasAttribute('tabindex') && parent.getClientRects().length > 0) {
      return focusOn(parent);
    }
    const up: Element | null = parent.parentElement;
    if (!up) break;
    searched = parent;
    index = Array.prototype.indexOf.call(up.children, parent);
    parent = up;
  }
  focusHeading(root);
  return true;
}

function focusOn(el: HTMLElement): true {
  el.focus();
  return true;
}

/**
 * Watches root (the app's <main>) and puts focus back on the page whenever the element holding it is
 * removed. Returns the cleanup. Only one root is watched at a time.
 */
export function installFocusKeeper(root: HTMLElement): () => void {
  const onFocusIn = (e: FocusEvent) => {
    if (e.target instanceof Element) remember(root, e.target);
  };
  // Clicking an empty spot moves focus to <body> on purpose: forget the old spot, so a later update
  // that removes it does not pull focus back. A removed element is no longer connected, so it is kept.
  const onFocusOut = (e: FocusEvent) => {
    const target = e.target;
    if (e.relatedTarget || !(target instanceof Element)) return;
    queueMicrotask(() => {
      if (target.isConnected && document.activeElement !== target && remembered?.chain[0]?.node === target) remembered = null;
    });
  };
  const observer = new MutationObserver(() => {
    const state = remembered;
    if (!state || state.root !== root) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (state.chain[0]?.node.isConnected) return;
    // An open dialog owns focus; it hands it back (or calls rescueFocus) when it closes.
    if (document.querySelector('dialog[open]')) return;
    if (state.path !== window.location.pathname) {
      remembered = null;
      return;
    }
    rescueFocus();
  });
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  observer.observe(root, { childList: true, subtree: true });
  if (document.activeElement) remember(root, document.activeElement);
  return () => {
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    observer.disconnect();
    if (remembered?.root === root) remembered = null;
  };
}
