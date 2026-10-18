import { Router } from 'express';
import { z } from 'zod';
import { getCity } from '../../shared/cities';
import { equipmentForClass } from '../../shared/equipment';
import type { DriverClass, DriverProfile, DriverStats, Endorsement, EquipmentCode, User } from '../../shared/types';
import { currentUser, requireAuth, requireRole } from '../auth';
import type { AppContext } from '../context';
import { bool, transaction, type Db } from '../db';
import { HttpError, notFound, parse } from '../http';
import { equipmentCodeSchema, isoDateSchema, stateCodeSchema } from '../filters';
import { getDriverProfile, getDriverSummary } from '../mappers';

const ENDORSEMENTS = ['hazmat', 'tanker', 'doubles_triples', 'twic'] as const satisfies readonly Endorsement[];
/** Endorsements that only exist on a CDL. A TWIC card is a port credential and does not need one. */
const CDL_ONLY_ENDORSEMENTS: Endorsement[] = ['hazmat', 'tanker', 'doubles_triples'];

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** Empty strings from cleared form fields mean null. */
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const digitsOrNull = (max: number, label: string) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .regex(new RegExp(`^\\d{1,${max}}$`), `${label} is up to ${max} digits`)
      .nullable(),
  );

const cityIdSchema = z.string().refine((id) => getCity(id) !== undefined, 'Unknown city');
const statesSchema = z
  .array(z.string().trim().toUpperCase().pipe(stateCodeSchema))
  .max(60)
  .transform(unique);
const availableFromSchema = isoDateSchema.transform((s) => new Date(s).toISOString()).nullable();

const profileSchema = z.object({
  driverClass: z.enum(['hotshot', 'semi']).optional(),
  equipmentTypes: z.array(equipmentCodeSchema).max(20).transform(unique).optional(),
  trailerLengthFt: z.number().min(8).max(60).optional(),
  maxPayloadLbs: z.number().int().min(500).max(80_000).optional(),
  truckDescription: z.string().trim().max(120).optional(),
  mcNumber: digitsOrNull(12, 'MC number').optional(),
  dotNumber: digitsOrNull(10, 'DOT number').optional(),
  hasCdl: z.boolean().optional(),
  cdlClass: z.enum(['A', 'B']).nullable().optional(),
  endorsements: z.array(z.enum(ENDORSEMENTS)).max(10).transform(unique).optional(),
  teamDriver: z.boolean().optional(),
  currentCityId: cityIdSchema.nullable().optional(),
  homeCityId: cityIdSchema.nullable().optional(),
  available: z.boolean().optional(),
  availableFrom: availableFromSchema.optional(),
  maxDeadheadMiles: z.number().int().min(0).max(1000).optional(),
  minRatePerMile: z.number().min(0).max(20).optional(),
  preferredStates: statesSchema.optional(),
  avoidStates: statesSchema.optional(),
  mpg: z.number().min(2).max(40).optional(),
  fuelPricePerGallon: z.number().min(1).max(15).optional(),
});

const locationSchema = z.object({
  cityId: cityIdSchema,
  available: z.boolean().optional(),
  availableFrom: availableFromSchema.optional(),
});

type ProfileUpdate = z.infer<typeof profileSchema>;

/** The writable columns of driver_profiles, in DTO terms. */
interface ProfileFields {
  driverClass: DriverClass;
  equipmentTypes: EquipmentCode[];
  trailerLengthFt: number;
  maxPayloadLbs: number;
  truckDescription: string;
  mcNumber: string | null;
  dotNumber: string | null;
  hasCdl: boolean;
  cdlClass: 'A' | 'B' | null;
  endorsements: Endorsement[];
  teamDriver: boolean;
  currentCityId: string | null;
  homeCityId: string | null;
  available: boolean;
  availableFrom: string | null;
  maxDeadheadMiles: number;
  minRatePerMile: number;
  preferredStates: string[];
  avoidStates: string[];
  mpg: number;
  fuelPricePerGallon: number;
}

function fieldsOf(p: DriverProfile): ProfileFields {
  return {
    driverClass: p.driverClass,
    equipmentTypes: p.equipmentTypes,
    trailerLengthFt: p.trailerLengthFt,
    maxPayloadLbs: p.maxPayloadLbs,
    truckDescription: p.truckDescription,
    mcNumber: p.mcNumber,
    dotNumber: p.dotNumber,
    hasCdl: p.hasCdl,
    cdlClass: p.cdlClass,
    endorsements: p.endorsements,
    teamDriver: p.teamDriver,
    currentCityId: p.currentLocation?.cityId ?? null,
    homeCityId: p.homeBase?.cityId ?? null,
    available: p.available,
    availableFrom: p.availableFrom,
    maxDeadheadMiles: p.maxDeadheadMiles,
    minRatePerMile: p.minRatePerMile,
    preferredStates: p.preferredStates,
    avoidStates: p.avoidStates,
    mpg: p.mpg,
    fuelPricePerGallon: p.fuelPricePerGallon,
  };
}

const invalidField = (path: string, message: string) =>
  new HttpError(400, 'validation_error', `${path}: ${message}`, [{ path, message }]);

/** Overlay the update on the stored profile and enforce the cross-field rules. */
function mergeProfile(current: ProfileFields, update: ProfileUpdate): ProfileFields {
  const defined = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined));
  const next: ProfileFields = { ...current, ...defined };

  const allowed = equipmentForClass(next.driverClass);
  const wrong = next.equipmentTypes.filter((code) => !allowed.includes(code));
  if (wrong.length > 0) {
    throw invalidField('equipmentTypes', `${wrong.join(', ')} is not ${next.driverClass} equipment`);
  }
  if (!next.hasCdl) {
    next.cdlClass = null;
    next.endorsements = next.endorsements.filter((e) => !CDL_ONLY_ENDORSEMENTS.includes(e));
  }
  return next;
}

function writeProfile(db: Db, userId: string, p: ProfileFields, nowIso: string): void {
  db.prepare(
    `UPDATE driver_profiles SET driver_class = ?, equipment_types = ?, trailer_length_ft = ?, max_payload_lbs = ?,
      truck_description = ?, mc_number = ?, dot_number = ?, has_cdl = ?, cdl_class = ?, endorsements = ?,
      team_driver = ?, current_city_id = ?, home_city_id = ?, available = ?, available_from = ?,
      max_deadhead_miles = ?, min_rate_per_mile = ?, preferred_states = ?, avoid_states = ?, mpg = ?,
      fuel_price = ?, updated_at = ?
     WHERE user_id = ?`,
  ).run(
    p.driverClass,
    JSON.stringify(p.equipmentTypes),
    p.trailerLengthFt,
    p.maxPayloadLbs,
    p.truckDescription,
    p.mcNumber,
    p.dotNumber,
    bool(p.hasCdl),
    p.cdlClass,
    JSON.stringify(p.endorsements),
    bool(p.teamDriver),
    p.currentCityId,
    p.homeCityId,
    bool(p.available),
    p.availableFrom,
    p.maxDeadheadMiles,
    p.minRatePerMile,
    JSON.stringify(p.preferredStates),
    JSON.stringify(p.avoidStates),
    p.mpg,
    p.fuelPricePerGallon,
    nowIso,
    userId,
  );
}

function requireProfile(db: Db, userId: string): DriverProfile {
  const profile = getDriverProfile(db, userId);
  if (!profile) throw notFound('Driver profile');
  return profile;
}

function updateProfile(ctx: AppContext, userId: string, update: ProfileUpdate): DriverProfile {
  transaction(ctx.db, () => {
    const merged = mergeProfile(fieldsOf(requireProfile(ctx.db, userId)), update);
    writeProfile(ctx.db, userId, merged, ctx.now().toISOString());
  });
  return requireProfile(ctx.db, userId);
}

function driverStats(db: Db, driverId: string): DriverStats {
  const count = (sql: string) => (db.prepare(sql).get(driverId) as { n: number }).n;
  const delivered = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(booked_rate_usd), 0) AS earned
       FROM loads WHERE booked_driver_id = ? AND status = 'delivered'`,
    )
    .get(driverId) as { n: number; earned: number };
  return {
    activeLoads: count(`SELECT COUNT(*) AS n FROM loads WHERE booked_driver_id = ? AND status IN ('booked', 'in_transit')`),
    pendingRequests: count(`SELECT COUNT(*) AS n FROM bookings WHERE driver_id = ? AND status = 'pending'`),
    completedLoads: delivered.n,
    earnedUsd: delivered.earned,
  };
}

/**
 * A shipper may see a driver's phone once the driver has dealt with one of their loads: a booking
 * request (any outcome), being booked on it, or writing to them in its message thread. A thread
 * the shipper started alone does not count, or any shipper could unlock any phone by messaging.
 */
export function shipperKnowsDriver(db: Db, shipperId: string, driverId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM loads l
       WHERE l.shipper_id = ? AND (
         l.booked_driver_id = ?
         OR EXISTS (SELECT 1 FROM bookings b WHERE b.load_id = l.id AND b.driver_id = ?)
         OR EXISTS (SELECT 1 FROM messages m WHERE m.load_id = l.id AND m.driver_id = ? AND m.sender_id = ?)
       )
       LIMIT 1`,
    )
    .get(shipperId, driverId, driverId, driverId, driverId);
  return row !== undefined;
}

function canSeePhone(db: Db, viewer: User, driverId: string): boolean {
  if (viewer.id === driverId) return true;
  return viewer.role === 'shipper' && shipperKnowsDriver(db, viewer.id, driverId);
}

export function driversRouter(ctx: AppContext): Router {
  const router = Router();
  const driverOnly = requireRole('driver');

  router.get('/me/profile', driverOnly, (req, res) => {
    res.json(requireProfile(ctx.db, currentUser(req).id));
  });

  router.put('/me/profile', driverOnly, (req, res) => {
    const update = parse(profileSchema, req.body);
    res.json(updateProfile(ctx, currentUser(req).id, update));
  });

  router.patch('/me/location', driverOnly, (req, res) => {
    const { cityId, available, availableFrom } = parse(locationSchema, req.body);
    res.json(updateProfile(ctx, currentUser(req).id, { currentCityId: cityId, available, availableFrom }));
  });

  router.get('/me/stats', driverOnly, (req, res) => {
    res.json(driverStats(ctx.db, currentUser(req).id));
  });

  router.get('/:id', requireAuth, (req, res) => {
    const viewer = currentUser(req);
    const summary = getDriverSummary(ctx.db, String(req.params.id));
    if (!summary) throw notFound('Driver');
    res.json(canSeePhone(ctx.db, viewer, summary.userId) ? summary : { ...summary, phone: null });
  });

  return router;
}
