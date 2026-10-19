// Resolves city ids (from URLs and saved filters) into City records for CityInput values and labels.
import { useEffect, useMemo, useState } from 'react';
import type { City } from '../../../../../shared/types';
import { api } from '../../../lib/api';
import { cityIdToLabel } from '../../../lib/filters';
import { place } from '../../../lib/format';

const cache = new Map<string, City>();
const inflight = new Map<string, Promise<City | null>>();

/**
 * A stand-in City built from the id ("odessa-tx" -> Odessa, TX) so a field can show something
 * right away. It has no coordinates; the real record replaces it once fetched.
 */
export function cityFromId(id: string): City {
  const label = cityIdToLabel(id);
  const comma = label.lastIndexOf(', ');
  if (comma < 0) return { id, name: label, state: '', lat: 0, lng: 0 };
  return { id, name: label.slice(0, comma), state: label.slice(comma + 2), lat: 0, lng: 0 };
}

/** Keep a city picked in CityInput so later lookups of its id are instant. */
export function rememberCity(city: City | null | undefined): void {
  if (city && (city.lat !== 0 || city.lng !== 0)) cache.set(city.id, city);
}

function fetchCity(id: string): Promise<City | null> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  let request = inflight.get(id);
  if (!request) {
    request = api.meta
      .city(id)
      .then((city) => {
        cache.set(id, city);
        return city;
      })
      // An unknown id keeps its stand-in label; the API rejects it on save with a field error.
      .catch(() => null)
      .finally(() => inflight.delete(id));
    inflight.set(id, request);
  }
  return request;
}

/**
 * The city to show for `id` given the one a hook is holding: the held city when it is for this id,
 * otherwise the cached record or a stand-in. Never a city for another id, and null only without an id.
 */
export function cityForId(id: string | null | undefined, held: City | null): City | null {
  if (!id) return null;
  if (held?.id === id) return held;
  return cache.get(id) ?? cityFromId(id);
}

/**
 * The City for an id: cached or fetched, with a stand-in from the id while it loads. It answers for
 * the id of this render, so a draft built right after the id changes never gets the previous city
 * (or none) while the effect below catches up.
 */
export function useCity(id: string | null | undefined): City | null {
  const [city, setCity] = useState<City | null>(() => (id ? (cache.get(id) ?? cityFromId(id)) : null));
  useEffect(() => {
    if (!id) {
      setCity(null);
      return;
    }
    setCity(cache.get(id) ?? cityFromId(id));
    let live = true;
    void fetchCity(id).then((found) => {
      if (live && found) setCity(found);
    });
    return () => {
      live = false;
    };
  }, [id]);
  // Memoized so the stand-in keeps its identity across renders (callers key effects on it).
  return useMemo(() => cityForId(id, city), [id, city]);
}

/** "St. Louis, MO" style labels for many city ids at once (e.g. a list of saved searches). */
export function useCityLabels(ids: (string | null | undefined)[]): Record<string, string> {
  const key = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort().join('|');
  const [labels, setLabels] = useState<Record<string, string>>({});
  const unique = useMemo(() => (key ? key.split('|') : []), [key]);

  useEffect(() => {
    let live = true;
    for (const id of unique) {
      void fetchCity(id).then((found) => {
        if (live && found) setLabels((prev) => (prev[id] ? prev : { ...prev, [id]: place(found) }));
      });
    }
    return () => {
      live = false;
    };
  }, [unique]);

  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const id of unique) {
      const cached = cache.get(id);
      out[id] = labels[id] ?? (cached ? place(cached) : cityIdToLabel(id));
    }
    return out;
  }, [unique, labels]);
}
