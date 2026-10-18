import type { City, Place } from './types';
import { isStateCode } from './geo';
import baseCities from './data/cities.json';
import extraCities from './data/extra-cities.json';

/** US cities with coordinates: the 1,000 largest plus freight hubs (oilfield, ag, ports) small towns. */
export const CITIES: City[] = [...(baseCities as City[]), ...(extraCities as City[])];

const BY_ID = new Map(CITIES.map((c) => [c.id, c]));

export function getCity(id: string): City | undefined {
  return BY_ID.get(id);
}

export function cityToPlace(city: City): Place {
  return { cityId: city.id, city: city.name, state: city.state, lat: city.lat, lng: city.lng };
}

export function placeForCityId(id: string): Place | null {
  const city = BY_ID.get(id);
  return city ? cityToPlace(city) : null;
}

const APOSTROPHES = /['’]/g;
/** Both spellings of words people abbreviate, so "saint louis" finds St. Louis and "ft worth" Fort Worth. */
const SPELLINGS: Record<string, string> = { st: 'saint', saint: 'st', fort: 'ft', ft: 'fort', mount: 'mt', mt: 'mount' };
const NO_MATCH = Number.POSITIVE_INFINITY;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Every spelling a name can be typed as: "Lee's Summit" -> "lees summit", "lee s summit". */
function nameForms(name: string): string[] {
  const plain = [name.replace(APOSTROPHES, ''), name].map(normalize);
  const respelled = plain.map((n) =>
    n
      .split(' ')
      .map((word) => SPELLINGS[word] ?? word)
      .join(' '),
  );
  return [...new Set([...plain, ...respelled])];
}

const INDEX = CITIES.map((city) => ({ city, names: nameForms(city.name) }));

/** 0 = exact name, 1 = name prefix, 2 = prefix of a later word ("worth" -> Fort Worth). */
function nameRank(names: string[], query: string): number {
  let best = NO_MATCH;
  for (const name of names) {
    if (name === query) return 0;
    if (name.startsWith(query)) best = Math.min(best, 1);
    else if (` ${name}`.includes(` ${query}`)) best = Math.min(best, 2);
  }
  return best;
}

/**
 * Autocomplete search. Accepts "dallas", "dal", "dallas tx", "dallas, tx" or "TX" style queries.
 * Name matches rank exact, then prefix, then word prefix, then cities in a bare state query;
 * ties go to the larger city.
 */
export function searchCities(query: string, limit = 10): City[] {
  const q = normalize(query.replace(APOSTROPHES, ''));
  if (!q) return [];
  const parts = q.split(' ');
  const last = parts[parts.length - 1].toUpperCase();
  // A trailing state code narrows the name to that state. The whole query is still tried as a
  // name too, so a half-typed "el pa" or "san ma" finds El Paso or San Marcos.
  const state = parts.length > 1 && isStateCode(last) ? last : null;
  const nameInState = parts.slice(0, -1).join(' ');
  const bareState = parts.length === 1 && isStateCode(last) ? last : null;

  const scored: { city: City; rank: number }[] = [];
  for (const { city, names } of INDEX) {
    let rank = nameRank(names, q);
    if (state === city.state) rank = Math.min(rank, nameRank(names, nameInState));
    if (bareState === city.state) rank = Math.min(rank, 3);
    if (rank !== NO_MATCH) scored.push({ city, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || (b.city.population ?? 0) - (a.city.population ?? 0));
  return scored.slice(0, Math.max(0, limit)).map((s) => s.city);
}
