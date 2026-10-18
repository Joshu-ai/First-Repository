import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { z } from 'zod';
import { CSRF_HEADER, CSRF_VALUE } from '../shared/api';
import type { ApiErrorBody } from '../shared/types';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Sign in to continue') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this') => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);

/** Validate input with a zod schema, throwing a 400 with field issues on failure. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = issues[0];
    const message = first ? (first.path ? `${first.path}: ${first.message}` : first.message) : 'Invalid input';
    throw new HttpError(400, 'validation_error', message, issues);
  }
  return result.data;
}

/** Rejects mutating /api requests that lack the CSRF header (see shared/api.ts). */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  if (!safe && req.get(CSRF_HEADER) !== CSRF_VALUE) {
    next(new HttpError(403, 'csrf', `Missing ${CSRF_HEADER} header`));
    return;
  }
  next();
};

export const apiNotFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, 'not_found', `No API route for ${req.method} ${req.originalUrl}`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message, details: err.details } };
    res.status(err.status).json(body);
    return;
  }
  // express.json() parse failures carry a status and type.
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_json', message: 'Request body is not valid JSON' } } satisfies ApiErrorBody);
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } } satisfies ApiErrorBody);
};

export const nowIso = (date: Date) => date.toISOString();
