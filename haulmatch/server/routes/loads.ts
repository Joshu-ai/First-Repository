import { Router } from 'express';
import type { AppContext } from '../context';

// TODO(build): implement per docs/SPEC.md
export function loadsRouter(_ctx: AppContext): Router {
  const router = Router();
  return router;
}
