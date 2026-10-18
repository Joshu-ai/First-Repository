import type { City, Place } from './types';
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

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Autocomplete search. Accepts "dallas", "dal", "dallas tx", "dallas, tx" or "TX" style queries.
 * Prefix matches on the city name rank first, then by population.
 */
export function searchCities(query: string, limit = 10): City[] {
  const q = normalize(query);
  if (!q) return [];
  const parts = q.split(' ');
  const last = parts[parts.length - 1];
  const stateFilter = parts.length > 1 && last.length === 2 ? last.toUpperCase() : null;
  const nameQuery = stateFilter ? parts.slice(0, -1).join(' ') : q;

  const scored: { city: City; rank: number }[] = [];
  for (const city of CITIES) {
    if (stateFilter && city.state !== stateFilter) continue;
    const name = normalize(city.name);
    let rank: number;
    if (!nameQuery) rank = 2;
    else if (name === nameQuery) rank = 0;
    else if (name.startsWith(nameQuery)) rank = 1;
    else if (name.split(' ').some((w) => w.startsWith(nameQuery))) rank = 2;
    else if (!stateFilter && q.length === 2 && city.state === q.toUpperCase()) rank = 3;
    else continue;
    scored.push({ city, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || (b.city.population ?? 0) - (a.city.population ?? 0));
  return scored.slice(0, limit).map((s) => s.city);
}
