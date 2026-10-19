// Facts about a load that several pages show the same way.
import type { Load } from '../../../shared/types';

/** The words for an open load whose pickup window has closed, on the dashboard card and the load page. */
export const PICKUP_PASSED_LABEL = 'Pickup window passed: edit or cancel';

/**
 * Still marked open, but its pickup window has closed. It is off the board (search, booking and
 * invites skip it) until the shipper sets a new window or cancels, and ShipperStats counts it as
 * `expired` instead of `open`.
 */
export function pickupWindowPassed(load: Pick<Load, 'status' | 'pickupEnd'>, now: Date = new Date()): boolean {
  return load.status === 'open' && Date.parse(load.pickupEnd) < now.getTime();
}
