// Pure helpers behind the accessibility fixes: the scroll padding that keeps a focused field out
// from under the sticky bars, and the pin grouping that keeps map pins tappable.
import { describe, expect, it } from 'vitest';
import { clusterByDistance, PIN_CLUSTER_RADIUS_PX } from '../../client/src/components/mapClusters';
import { pinnedBarInset } from '../../client/src/lib/pinnedBar';

describe('pinnedBarInset (scroll room for the sticky Post load / Book now / save bars)', () => {
  it('reserves the bar plus its offset above the tab bar while it is pinned', () => {
    // The Post load bar on a phone: 78px tall, 72px up (the 64px tab bar and an 8px gap).
    expect(pinnedBarInset('sticky', '72px', 78)).toBe(150);
    expect(pinnedBarInset('fixed', '16px', 101.4)).toBe(118);
  });

  it('reserves nothing once the bar sits in the page (the action bar from 1024px up)', () => {
    expect(pinnedBarInset('static', '72px', 78)).toBe(0);
    expect(pinnedBarInset('relative', 'auto', 78)).toBe(0);
  });

  it('treats an offset it cannot read as none', () => {
    expect(pinnedBarInset('sticky', 'auto', 70)).toBe(70);
    expect(pinnedBarInset('sticky', '-8px', 70)).toBe(70);
  });
});

describe('clusterByDistance (pickup pins too close to tap apart)', () => {
  const at = (id: string, x: number, y: number) => ({ id, x, y });
  const ids = (groups: { id: string }[][]) => groups.map((g) => g.map((p) => p.id));

  it('groups pins closer than a fingertip and leaves the rest alone', () => {
    // Dallas, Irving and Fort Worth at the zoom that fits the whole DFW board on a phone.
    const groups = clusterByDistance([at('dallas', 200, 300), at('irving', 180, 296), at('fort-worth', 140, 300), at('tyler', 330, 330)]);
    expect(ids(groups)).toEqual([['dallas', 'irving'], ['fort-worth'], ['tyler']]);
  });

  it('keeps the first (best) pin as the anchor and never chains a group across the map', () => {
    const line = [at('a', 0, 0), at('b', 30, 0), at('c', 60, 0), at('d', 90, 0)];
    expect(ids(clusterByDistance(line))).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('uses a 36px radius by default, the width of a gloved fingertip', () => {
    expect(PIN_CLUSTER_RADIUS_PX).toBe(36);
    expect(ids(clusterByDistance([at('a', 0, 0), at('b', 35.9, 0)]))).toEqual([['a', 'b']]);
    expect(ids(clusterByDistance([at('a', 0, 0), at('b', 36, 0)]))).toEqual([['a'], ['b']]);
    expect(ids(clusterByDistance([at('a', 0, 0), at('b', 50, 0)], 60))).toEqual([['a', 'b']]);
  });

  it('returns no groups for no pins', () => {
    expect(clusterByDistance([])).toEqual([]);
  });
});
