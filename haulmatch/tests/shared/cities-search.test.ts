import { describe, expect, it } from 'vitest';
import { CITIES, cityToPlace, getCity, placeForCityId, searchCities } from '../../shared/cities';
import { isStateCode } from '../../shared/geo';
import type { City } from '../../shared/types';

const label = (c: City) => `${c.name}, ${c.state}`;
const labels = (query: string, limit?: number) => searchCities(query, limit).map(label);
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

describe('city dataset', () => {
  it('has unique ids derived from name and state', () => {
    expect(new Set(CITIES.map((c) => c.id)).size).toBe(CITIES.length);
    for (const c of CITIES) expect(c.id).toBe(`${slug(c.name)}-${c.state.toLowerCase()}`);
  });

  it('uses valid state codes, US coordinates and populations', () => {
    for (const c of CITIES) {
      expect(isStateCode(c.state), c.id).toBe(true);
      expect(c.lat, c.id).toBeGreaterThan(18);
      expect(c.lat, c.id).toBeLessThan(72);
      expect(c.lng, c.id).toBeGreaterThan(-180);
      expect(c.lng, c.id).toBeLessThan(-66);
      expect(c.population, c.id).toBeGreaterThan(0);
    }
  });

  it('includes the big metros and the small oilfield and ag towns hotshots run', () => {
    for (const id of ['new-york-ny', 'houston-tx', 'chicago-il', 'odessa-tx', 'midland-tx', 'pecos-tx', 'williston-nd']) {
      expect(getCity(id), id).toBeDefined();
    }
  });
});

describe('getCity, placeForCityId and cityToPlace', () => {
  it('looks a city up by id', () => {
    expect(getCity('dallas-tx')).toMatchObject({ id: 'dallas-tx', name: 'Dallas', state: 'TX' });
    expect(getCity('nowhere-zz')).toBeUndefined();
    expect(getCity('')).toBeUndefined();
  });

  it('resolves an id to a place', () => {
    const dallas = getCity('dallas-tx')!;
    expect(placeForCityId('dallas-tx')).toEqual({ cityId: 'dallas-tx', city: 'Dallas', state: 'TX', lat: dallas.lat, lng: dallas.lng });
    expect(placeForCityId('nowhere-zz')).toBeNull();
  });

  it('turns a city into a place without the population', () => {
    const odessa = getCity('odessa-tx')!;
    expect(cityToPlace(odessa)).toEqual({ cityId: 'odessa-tx', city: 'Odessa', state: 'TX', lat: odessa.lat, lng: odessa.lng });
  });
});

describe('searchCities: ranking', () => {
  it('ranks an exact name above a bigger city whose later word matches', () => {
    // York, PA (pop ~44k) beats New York, NY (8.4M).
    expect(labels('york', 3)).toEqual(['York, PA', 'New York, NY', 'West New York, NJ']);
  });

  it('ranks an exact name above a bigger city whose name merely starts with the query', () => {
    const results = labels('jackson');
    expect(results.indexOf('Jackson, MS')).toBeLessThan(results.indexOf('Jacksonville, FL'));
    expect(getCity('jacksonville-fl')!.population!).toBeGreaterThan(getCity('jackson-ms')!.population!);
  });

  it('ranks a name prefix above a bigger city whose later word matches', () => {
    const results = labels('park', 25);
    expect(results.indexOf('Parker, CO')).toBeLessThan(results.indexOf('Overland Park, KS'));
    expect(getCity('overland-park-ks')!.population!).toBeGreaterThan(getCity('parker-co')!.population!);
  });

  it('orders exact, then prefix, then word-prefix matches', () => {
    expect(labels('miami')).toEqual(['Miami, FL', 'Miami Gardens, FL', 'Miami Beach, FL', 'North Miami, FL', 'North Miami Beach, FL']);
  });

  it('breaks ties by population, largest first', () => {
    const springfields = searchCities('springfield');
    expect(springfields.length).toBeGreaterThan(2);
    expect(springfields.every((c) => c.name === 'Springfield')).toBe(true);
    const populations = springfields.map((c) => c.population!);
    expect(populations).toEqual([...populations].sort((a, b) => b - a));
  });

  it('finds a city by a later word', () => {
    expect(labels('worth')).toEqual(['Fort Worth, TX']);
    expect(labels('lucie')).toEqual(['Port St. Lucie, FL']);
    expect(labels('st lucie')).toEqual(['Port St. Lucie, FL']);
  });
});

describe('searchCities: query forms', () => {
  it('ignores case, punctuation and extra spaces', () => {
    expect(labels('  HOUSTON  ', 1)).toEqual(['Houston, TX']);
    expect(labels('dallas')).toEqual(['Dallas, TX']);
    expect(labels('Dal', 3)).toContain('Dallas, TX');
  });

  it('narrows to a state with "city st" or "city, st"', () => {
    expect(labels('springfield mo')).toEqual(['Springfield, MO']);
    expect(labels('springfield, il')).toEqual(['Springfield, IL']);
    expect(labels('Springfield,IL')).toEqual(['Springfield, IL']);
    expect(labels('midland tx')).toEqual(['Midland, TX']);
    expect(labels('dallas, TX')).toEqual(labels('dallas tx'));
    expect(labels('new york ny')).toEqual(['New York, NY']);
    expect(labels('fort wayne in')).toEqual(['Fort Wayne, IN']);
  });

  it('narrows a prefix to a state', () => {
    expect(labels('spring mo')).toEqual(['Springfield, MO', 'Blue Springs, MO']);
  });

  it('returns nothing when the city is not in that state', () => {
    expect(searchCities('dallas ok')).toEqual([]);
  });

  it('treats a trailing two-letter word that is not a state as part of the name', () => {
    expect(labels('port st')).toEqual(['Port St. Lucie, FL']);
    expect(labels('santa fe')).toEqual(['Santa Fe, NM']);
    expect(labels('santa fe nm')).toEqual(['Santa Fe, NM']);
  });

  it('still finds a half-typed name whose last letters look like a state', () => {
    expect(labels('el pa', 1)).toEqual(['El Paso, TX']);
    expect(labels('san ma')).toContain('San Marcos, TX');
  });

  it('lists the cities of a state for a bare two-letter state code, largest first', () => {
    const texas = searchCities('TX', 25);
    expect(texas).toHaveLength(25);
    expect(texas.every((c) => c.state === 'TX')).toBe(true);
    expect(texas[0].name).toBe('Houston');
    expect(texas.map((c) => c.population!)).toEqual(texas.map((c) => c.population!).sort((a, b) => b - a));
    expect(searchCities('tx', 25)).toEqual(texas);
    expect(labels('dc')).toEqual(['Washington, DC']);
  });

  it('ranks names starting with the two letters ahead of the cities of that state', () => {
    // "wy": Wyoming, MI and Wylie, TX come before Cheyenne, WY.
    const results = labels('wy', 4);
    expect(results.slice(0, 2)).toEqual(['Wyoming, MI', 'Wylie, TX']);
    expect(results[2]).toBe('Cheyenne, WY');
  });

  it('accepts apostrophes typed, dropped or spaced', () => {
    for (const q of ["lee's summit", 'lees summit', 'lee s summit', 'LEE’S SUMMIT']) expect(labels(q), q).toEqual(["Lee's Summit, MO"]);
    for (const q of ["o'fallon", 'ofallon', 'o fallon']) expect(labels(q), q).toEqual(["O'Fallon, MO"]);
    for (const q of ["coeur d'alene", 'coeur dalene', 'coeur d alene']) expect(labels(q), q).toEqual(["Coeur d'Alene, ID"]);
  });

  it('matches saint/st, fort/ft and mount/mt either way', () => {
    expect(labels('saint louis', 1)).toEqual(['St. Louis, MO']);
    expect(labels('st louis', 1)).toEqual(['St. Louis, MO']);
    expect(labels('st. louis mo')).toEqual(['St. Louis, MO']);
    expect(labels('saint')).toContain('St. Paul, MN');
    expect(labels('saint')).not.toContain('Stockton, CA');
    expect(labels('ft worth')).toEqual(['Fort Worth, TX']);
    expect(labels('ft', 3)).toEqual(labels('fort', 3));
    expect(labels('mt vernon')).toEqual(['Mount Vernon, NY']);
    expect(labels('mt')).not.toContain('Mountain View, CA');
  });

  it('reads a trailing state code before any abbreviation', () => {
    expect(labels('billings mt')).toEqual(['Billings, MT']);
  });
});

describe('searchCities: limits and empty input', () => {
  it('returns nothing for an empty or punctuation-only query', () => {
    expect(searchCities('')).toEqual([]);
    expect(searchCities('   ')).toEqual([]);
    expect(searchCities(',.!')).toEqual([]);
  });

  it('returns nothing when nothing matches', () => {
    expect(searchCities('qqqzzz')).toEqual([]);
  });

  it('returns at most 10 by default and honours a limit', () => {
    expect(searchCities('san')).toHaveLength(10);
    expect(searchCities('san', 3)).toEqual(searchCities('san').slice(0, 3));
    expect(searchCities('san', 0)).toEqual([]);
    expect(searchCities('san', -5)).toEqual([]);
  });
});
