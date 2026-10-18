import type { Db } from './db';

export interface SeedSummary {
  users: number;
  loads: number;
}

// TODO(build): implement per docs/SPEC.md
export function seedDatabase(_db: Db, _opts: { now?: Date } = {}): SeedSummary {
  return { users: 0, loads: 0 };
}
