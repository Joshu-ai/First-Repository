import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';
import { authenticate } from './auth';
import type { AppContext } from './context';
import type { Db } from './db';
import { apiNotFound, csrfGuard, errorHandler } from './http';
import { authRouter } from './routes/auth';
import { bookingsRouter } from './routes/bookings';
import { driversRouter } from './routes/drivers';
import { loadsRouter } from './routes/loads';
import { messagesRouter } from './routes/messages';
import { metaRouter } from './routes/meta';
import { notificationsRouter } from './routes/notifications';
import { savedSearchesRouter } from './routes/savedSearches';
import { shipperRouter } from './routes/shipper';

export interface CreateAppOptions {
  db: Db;
  now?: () => Date;
  /** Directory of the built client to serve (production). Omit to serve API only. */
  staticDir?: string;
}

export function createApp(options: CreateAppOptions): express.Express {
  const ctx: AppContext = { db: options.db, now: options.now ?? (() => new Date()) };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use(authenticate(ctx));
  api.use(csrfGuard);
  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  api.use('/auth', authRouter(ctx));
  api.use('/drivers', driversRouter(ctx));
  api.use('/shipper', shipperRouter(ctx));
  api.use('/bookings', bookingsRouter(ctx));
  api.use('/saved-searches', savedSearchesRouter(ctx));
  // Routers below define their own sub-paths (e.g. /cities, /meta, /threads, /notifications, /events).
  api.use(metaRouter(ctx));
  api.use(notificationsRouter(ctx));
  api.use(messagesRouter(ctx));
  api.use('/loads', loadsRouter(ctx));
  api.use(apiNotFound);
  app.use('/api', api);

  const staticDir = options.staticDir ? resolve(options.staticDir) : null;
  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(join(staticDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
