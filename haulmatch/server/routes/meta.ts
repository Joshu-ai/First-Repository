import { Router } from 'express';
import { z } from 'zod';
import { getCity, searchCities } from '../../shared/cities';
import { DRIVER_CLASSES, EQUIPMENT, EQUIPMENT_CODES } from '../../shared/equipment';
import { roadMiles, US_STATES } from '../../shared/geo';
import { estimateRate } from '../../shared/rates';
import type { City, MetaResponse } from '../../shared/types';
import type { AppContext } from '../context';
import { notFound, parse } from '../http';
import { equipmentCodeSchema } from '../filters';

const citiesQuerySchema = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(25).default(8),
});

const knownCity = z
  .string()
  .refine((id) => getCity(id) !== undefined, 'Unknown city')
  .transform((id): City => getCity(id)!);

const estimateQuerySchema = z.object({
  originCityId: knownCity,
  destinationCityId: knownCity,
  equipment: z
    .string()
    .optional()
    .transform((v) => [...new Set((v ?? '').split(',').map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(equipmentCodeSchema)),
  // The freight, when known, so hotshot types never price freight no hotshot can carry.
  weightLbs: z.coerce.number().int().min(1).max(200_000).optional(),
  lengthFt: z.coerce.number().min(1).max(100).optional(),
});

function buildMeta(): MetaResponse {
  return {
    equipment: EQUIPMENT_CODES.map((code) => EQUIPMENT[code]),
    driverClasses: Object.values(DRIVER_CLASSES),
    states: Object.entries(US_STATES).map(([code, name]) => ({ code, name })),
  };
}

// Reference data is static and public, so the context goes unused.
export function metaRouter(_ctx: AppContext): Router {
  const router = Router();
  const meta = buildMeta();

  router.get('/cities', (req, res) => {
    const { q, limit } = parse(citiesQuerySchema, req.query);
    res.json(q ? searchCities(q, limit) : []);
  });

  router.get('/cities/:id', (req, res) => {
    const city = getCity(req.params.id);
    if (!city) throw notFound('City');
    res.json(city);
  });

  router.get('/meta', (_req, res) => {
    res.json(meta);
  });

  router.get('/rates/estimate', (req, res) => {
    const { originCityId: origin, destinationCityId: destination, equipment, weightLbs, lengthFt } = parse(
      estimateQuerySchema,
      req.query,
    );
    res.json(estimateRate(roadMiles(origin, destination), equipment, { weightLbs, lengthFt }));
  });

  return router;
}
