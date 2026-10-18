// Match checks are written for the driver ("Your gooseneck works"). Shippers read the same
// result about someone else, so each check is reworded from its key and outcome.
import { EQUIPMENT } from '../../../../../shared/equipment';
import type { DriverSummary, Load, MatchCheck, MatchResult } from '../../../../../shared/types';
import { feet, lbs, miles, ratePerMile, scoreLabel } from '../../../lib/format';
import { lengthLabel } from './loadForm';

type CheckLoad = Pick<Load, 'weightLbs' | 'lengthFt' | 'equipmentTypes' | 'destination'>;

function shipperLabel(check: MatchCheck, load: CheckLoad, driver: DriverSummary, match: MatchResult): string {
  switch (check.key) {
    case 'equipment': {
      const code = match.matchedEquipment[0];
      if (check.ok && code) return `${EQUIPMENT[code].shortLabel} matches your load`;
      return `Runs none of: ${load.equipmentTypes.map((c) => EQUIPMENT[c].shortLabel).join(', ')}`;
    }
    case 'weight':
      return check.ok
        ? `${lbs(load.weightLbs)} of their ${lbs(driver.maxPayloadLbs)} capacity`
        : `Over their ${lbs(driver.maxPayloadLbs)} payload`;
    case 'length':
      return check.ok
        ? `${lengthLabel(load.lengthFt)} fits their ${feet(driver.trailerLengthFt)} deck`
        : `Too long for their ${feet(driver.trailerLengthFt)} deck`;
    case 'cdl':
      // Every failing case (semi trailer, or a hotshot over 10,000 lbs) needs a Class A; Class B does not cover it.
      return check.ok ? 'CDL on file' : 'No Class A CDL for this weight or trailer';
    case 'hazmat':
      return check.ok ? 'Hazmat endorsement on file' : 'No hazmat endorsement';
    case 'tanker':
      return check.ok ? 'Tanker endorsement on file' : 'No tanker endorsement';
    case 'team':
      return check.ok ? 'Runs team' : 'Not a team';
    case 'avoid_state':
      return `Avoids ${load.destination.state}`;
    case 'deadhead':
      if (match.deadheadMiles === null) return 'Location not set';
      return check.ok
        ? `${miles(match.deadheadMiles)} from pickup`
        : `${miles(match.deadheadMiles)} from pickup, farther than they like to run empty`;
    case 'timing':
      // The failure label ("Can't reach pickup in time (about 3h late)") already reads neutrally.
      return check.ok ? 'Can make the pickup window' : check.label;
    case 'rate':
      return check.ok
        ? `${ratePerMile(match.effectiveRatePerMile)} all-in meets their minimum`
        : `${ratePerMile(match.effectiveRatePerMile)} all-in is under their minimum`;
    case 'status':
      return check.label;
  }
}

/** The checks a shipper cares about, reworded about the driver. The load-status check is dropped. */
export function shipperChecks(load: CheckLoad, driver: DriverSummary, match: MatchResult): MatchCheck[] {
  return match.checks
    .filter((c) => c.key !== 'status')
    .map((c) => ({ ...c, label: shipperLabel(c, load, driver, match) }));
}

/** "Good match · Can make pickup": the score in words plus timing, for cards that already show deadhead. */
export function shipperFitLine(match: MatchResult): string {
  const timing = match.checks.find((c) => c.key === 'timing');
  const label = scoreLabel(match.score, match.eligible);
  return timing ? `${label} · ${timing.ok ? 'Can make pickup' : 'May miss pickup'}` : label;
}

/** One line for a compact row: "18 mi from pickup · Can make the pickup window". */
export function shipperMatchLine(match: MatchResult | null | undefined): string {
  if (!match) return 'Rig profile not finished';
  const parts: string[] = [];
  parts.push(match.deadheadMiles === null ? 'Location not set' : `${miles(match.deadheadMiles)} from pickup`);
  const timing = match.checks.find((c) => c.key === 'timing');
  if (timing) parts.push(timing.ok ? 'Can make pickup' : 'May miss pickup');
  return parts.join(' · ');
}
