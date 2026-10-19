// Screen-space grouping for map pins. Pickup cities a few miles apart (Dallas, Irving, Fort Worth)
// land on top of each other at the zoom that fits a whole board, so pins closer than a finger's
// width are drawn as one pin that zooms in when tapped. Pure, so it is tested without a map.

/** Pins whose anchors are closer than this, in CSS pixels, become one pin: about a gloved fingertip. */
export const PIN_CLUSTER_RADIUS_PX = 36;

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Greedy grouping: each point joins the first group whose first point (its anchor, where the group's
 * pin is drawn) lies within `radiusPx`, or starts a new group. Points are visited in the given order,
 * so pass the most important first (the best match score): its pin keeps its place on the map.
 * Distance is measured to the anchor, not to every member, so groups never chain across the map.
 */
export function clusterByDistance<T extends ScreenPoint>(points: readonly T[], radiusPx = PIN_CLUSTER_RADIUS_PX): T[][] {
  const groups: T[][] = [];
  const limit = radiusPx * radiusPx;
  for (const point of points) {
    const group = groups.find(([anchor]) => (anchor.x - point.x) ** 2 + (anchor.y - point.y) ** 2 < limit);
    if (group) group.push(point);
    else groups.push([point]);
  }
  return groups;
}
