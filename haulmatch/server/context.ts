import type { Db } from './db';

/** Passed to every router. `now` is injectable so tests can pin the clock. */
export interface AppContext {
  db: Db;
  now: () => Date;
}
