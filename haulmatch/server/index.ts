import { resolve } from 'node:path';
import { createApp } from './app';
import { openDb } from './db';
import { seedDatabase } from './seed';

const port = Number(process.env.PORT ?? 4000);
const dbPath = process.env.HAULMATCH_DB ?? resolve('data/haulmatch.db');
const db = openDb(dbPath);

const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
if (count === 0 && process.env.HAULMATCH_SEED !== '0') {
  const summary = seedDatabase(db);
  console.log(`Seeded demo data: ${JSON.stringify(summary)}`);
}

const app = createApp({
  db,
  staticDir: process.env.NODE_ENV === 'production' ? resolve('dist') : undefined,
});

app.listen(port, () => {
  console.log(`HaulMatch API listening on http://localhost:${port} (db: ${dbPath})`);
});
