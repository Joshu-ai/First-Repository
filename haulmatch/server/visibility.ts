// Who may see a load. Shared by the load routes and the message routes so a thread never links to
// a load its driver cannot open.
import type { Load, User } from '../shared/types';
import type { Db } from './db';

const exists = (db: Db, sql: string, ...params: string[]) => db.prepare(sql).get(...params) !== undefined;

/**
 * Drivers see open loads, loads they are booked on or have a booking row on (any status), and loads
 * where they are already in a message thread, so they can still read and answer a shipper after the
 * load is covered. `load` must be read without a viewer or with this driver as the viewer.
 */
export function driverCanSeeLoad(db: Db, load: Load, driverId: string): boolean {
  return (
    load.status === 'open' ||
    load.bookedDriverId === driverId ||
    exists(db, 'SELECT 1 FROM bookings WHERE load_id = ? AND driver_id = ? LIMIT 1', load.id, driverId) ||
    exists(db, 'SELECT 1 FROM messages WHERE load_id = ? AND driver_id = ? LIMIT 1', load.id, driverId)
  );
}

/** Open loads are public to signed-in users; anything else only to its shipper and the drivers involved in it. */
export function canViewLoad(db: Db, load: Load, user: User): boolean {
  if (load.status === 'open') return true;
  if (user.role === 'shipper') return load.shipperId === user.id;
  return driverCanSeeLoad(db, load, user.id);
}
