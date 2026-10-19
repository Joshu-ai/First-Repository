// Tabs on the shipper dashboard and the counts on them (from GET /api/shipper/stats).
import type { LoadStatus, ShipperStats } from '../../../../../shared/types';

export type Tab = 'active' | LoadStatus;

export const TABS: Tab[] = ['active', 'open', 'booked', 'in_transit', 'delivered', 'cancelled'];

export const TAB_LABELS: Record<Tab, string> = {
  active: 'Active',
  open: 'Open',
  booked: 'Booked',
  in_transit: 'In transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as string[]).includes(value);
}

/**
 * How many loads a tab lists. Stats count open loads past their pickup window as `expired`, not
 * `open`, but /shipper/loads still lists them under Open and Active (they need an edit or a cancel),
 * so the counts add them back.
 */
export function tabCount(tab: Tab, stats: ShipperStats | undefined): number | undefined {
  if (!stats) return undefined;
  switch (tab) {
    case 'active':
      return stats.open + stats.expired + stats.booked + stats.inTransit;
    case 'open':
      return stats.open + stats.expired;
    case 'booked':
      return stats.booked;
    case 'in_transit':
      return stats.inTransit;
    case 'delivered':
      return stats.delivered;
    case 'cancelled':
      return stats.cancelled;
  }
}
