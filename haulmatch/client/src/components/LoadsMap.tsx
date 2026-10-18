import { useMemo } from 'react';
import { Marker, Polyline, Popup } from 'react-leaflet';
import { Link } from 'react-router';
import type { Load, LoadWithMatch, Place } from '../../../shared/types';
import { cx } from '../lib/cx';
import { miles, money, pickupTime, place, ratePerMile } from '../lib/format';
import { BaseMap, FitToPoints, pinIcon, type LatLngLike } from './MapBase';

export interface LoadsMapProps {
  loads: (Load | LoadWithMatch)[];
  /** Route for "View load" in a pin's popup. */
  hrefFor: (load: Load) => string;
  /** Highlights this load: its pin is enlarged and its delivery pin and lane line are drawn. */
  selectedId?: string | null;
  /** Called when a pickup pin is tapped (with the first load at that pickup city). */
  onSelect?: (loadId: string) => void;
  /** Driver's location, shown as a truck pin. */
  driverLocation?: Place | null;
  /** CSS height. Default 360. */
  height?: number | string;
  className?: string;
  /** Max loads listed in one pin's popup. Default 5. */
  popupLimit?: number;
}

interface OriginGroup {
  cityId: string;
  origin: Place;
  loads: (Load | LoadWithMatch)[];
}

function bestScore(loads: (Load | LoadWithMatch)[]): number | null {
  let best: number | null = null;
  for (const l of loads) {
    const m = 'match' in l ? l.match : null;
    if (m?.eligible && (best === null || m.score > best)) best = m.score;
  }
  return best;
}

/**
 * Pickup pins for a list of loads, grouped by pickup city. A pin shows the best match score at
 * that city with a "×N" bubble when several loads pick up there, and its popup lists them with links.
 */
export function LoadsMap({
  loads,
  hrefFor,
  selectedId,
  onSelect,
  driverLocation,
  height = 360,
  className,
  popupLimit = 5,
}: LoadsMapProps) {
  const groups = useMemo(() => {
    const byCity = new Map<string, OriginGroup>();
    for (const load of loads) {
      if (load.origin.lat === 0 && load.origin.lng === 0) continue;
      const group = byCity.get(load.origin.cityId);
      if (group) group.loads.push(load);
      else byCity.set(load.origin.cityId, { cityId: load.origin.cityId, origin: load.origin, loads: [load] });
    }
    return [...byCity.values()];
  }, [loads]);

  const selected = selectedId ? loads.find((l) => l.id === selectedId) ?? null : null;

  const points = useMemo(() => {
    const list: LatLngLike[] = groups.map((g) => g.origin);
    if (driverLocation) list.push(driverLocation);
    return list;
  }, [groups, driverLocation]);

  return (
    <BaseMap
      height={height}
      className={cx('map--loads', className)}
      ariaLabel={`Map of ${loads.length} load pickups`}
      interactive
    >
      <FitToPoints points={points} maxZoom={8} />
      {driverLocation ? (
        <Marker
          position={[driverLocation.lat, driverLocation.lng]}
          icon={pinIcon('driver')}
          title={`You: ${place(driverLocation)}`}
        />
      ) : null}
      {selected ? (
        <>
          <Polyline
            positions={[
              [selected.origin.lat, selected.origin.lng],
              [selected.destination.lat, selected.destination.lng],
            ]}
            className="map-line map-line--route"
            pathOptions={{ weight: 4 }}
          />
          <Marker
            position={[selected.destination.lat, selected.destination.lng]}
            icon={pinIcon('destination')}
            title={`Delivery: ${place(selected.destination)}`}
          />
        </>
      ) : null}
      {groups.map((group) => {
        const score = bestScore(group.loads);
        const isSelected = Boolean(selected && selected.origin.cityId === group.cityId);
        // The best match score at this pickup (a dot when nothing has one), plus a "×N" bubble for several loads.
        const text = score !== null ? String(score) : '•';
        return (
          <Marker
            key={group.cityId}
            position={[group.origin.lat, group.origin.lng]}
            icon={pinIcon('origin', text, isSelected, group.loads.length)}
            title={`${place(group.origin)}: ${group.loads.length} ${group.loads.length === 1 ? 'load' : 'loads'}`}
            eventHandlers={onSelect ? { click: () => onSelect(group.loads[0].id) } : undefined}
            zIndexOffset={isSelected ? 1000 : 0}
          >
            <Popup>
              <div className="map-popup">
                <p className="map-popup__title">
                  {group.loads.length === 1 ? 'Pickup in ' : `${group.loads.length} pickups in `}
                  {place(group.origin)}
                </p>
                <ul className="map-popup__list">
                  {group.loads.slice(0, popupLimit).map((load) => (
                    <li key={load.id}>
                      <Link to={hrefFor(load)} className="map-popup__link">
                        <span className="map-popup__lane">→ {place(load.destination)}</span>
                        <span className="map-popup__meta num">
                          {money(load.rateUsd)} · {ratePerMile(load.ratePerMile)} · {miles(load.miles)}
                        </span>
                        <span className="map-popup__meta">{pickupTime(load.pickupStart)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {group.loads.length > popupLimit ? (
                  <p className="map-popup__more">+{group.loads.length - popupLimit} more in the list</p>
                ) : null}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </BaseMap>
  );
}
