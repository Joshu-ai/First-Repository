import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { Marker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet';
import { Link } from 'react-router';
import type { Load, LoadWithMatch, Place } from '../../../shared/types';
import { cx } from '../lib/cx';
import { miles, money, pickupTime, place, ratePerMile } from '../lib/format';
import { BaseMap, FitToPoints, pinIcon, POPUP_PAN_PADDING, truckIcon, type LatLngLike } from './MapBase';
import { clusterByDistance } from './mapClusters';

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
 * Cities too close to tap apart at the current zoom share one ringed pin that zooms in when tapped.
 * The driver's own spot is a round truck badge drawn above the pins.
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

  const ariaLabel = `Map of ${loads.length} load pickups` + (driverLocation ? `, with your truck at ${place(driverLocation)}` : '');

  return (
    <BaseMap height={height} className={cx('map--loads', className)} ariaLabel={ariaLabel} interactive>
      <FitToPoints points={points} maxZoom={8} />
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
      <PickupPins
        groups={groups}
        selectedCityId={selected?.origin.cityId ?? null}
        onSelect={onSelect}
        hrefFor={hrefFor}
        popupLimit={popupLimit}
      />
      {driverLocation ? (
        <Marker
          position={[driverLocation.lat, driverLocation.lng]}
          icon={truckIcon()}
          title={`You: ${place(driverLocation)}`}
          keyboard={false}
          zIndexOffset={2000}
        />
      ) : null}
    </BaseMap>
  );
}

/** Best score first (it anchors its group's pin), then the city with the most loads. */
function byImportance(a: OriginGroup, b: OriginGroup): number {
  return (bestScore(b.loads) ?? -1) - (bestScore(a.loads) ?? -1) || b.loads.length - a.loads.length;
}

interface PickupPinsProps {
  groups: OriginGroup[];
  selectedCityId: string | null;
  onSelect?: (loadId: string) => void;
  hrefFor: (load: Load) => string;
  popupLimit: number;
}

function PickupPins({ groups, selectedCityId, onSelect, hrefFor, popupLimit }: PickupPinsProps) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  // FitToPoints (rendered before this) may set the view before the zoomend listener exists.
  useEffect(() => setZoom(map.getZoom()), [map, groups]);

  const clusters = useMemo(() => {
    const ordered = [...groups].sort(byImportance);
    const onScreen = ordered.map((group) => {
      const { x, y } = map.project([group.origin.lat, group.origin.lng], zoom);
      return { x, y, group };
    });
    return clusterByDistance(onScreen).map((members) => members.map((m) => m.group));
  }, [groups, map, zoom]);

  return (
    <>
      {clusters.map((cities) => {
        const anchor = cities[0];
        const all = cities.flatMap((c) => c.loads);
        const score = bestScore(all);
        // The best match score at this pickup (a dot when nothing has one), plus a "×N" bubble for several loads.
        const text = score !== null ? String(score) : '•';
        const isSelected = cities.some((c) => c.cityId === selectedCityId);
        const zIndexOffset = isSelected ? 1000 : 0;

        if (cities.length > 1) {
          const others = cities.length - 1;
          return (
            <Marker
              key={cities.map((c) => c.cityId).join('|')}
              position={[anchor.origin.lat, anchor.origin.lng]}
              icon={pinIcon('origin', text, isSelected, all.length, true)}
              title={`${place(anchor.origin)} and ${others} more pickup ${others === 1 ? 'city' : 'cities'} close by: ${all.length} loads. Zoom in to see each.`}
              eventHandlers={{
                click: () => {
                  // This pin is redrawn as separate pins once zoomed in: keep focus on the map meanwhile.
                  map.getContainer().focus({ preventScroll: true });
                  map.flyToBounds(L.latLngBounds(cities.map((c) => [c.origin.lat, c.origin.lng] as L.LatLngTuple)), {
                    padding: [56, 56],
                    duration: 0.4,
                  });
                },
              }}
              zIndexOffset={zIndexOffset}
            />
          );
        }

        return (
          <Marker
            key={anchor.cityId}
            position={[anchor.origin.lat, anchor.origin.lng]}
            icon={pinIcon('origin', text, isSelected, anchor.loads.length)}
            title={`${place(anchor.origin)}: ${anchor.loads.length} ${anchor.loads.length === 1 ? 'load' : 'loads'}`}
            eventHandlers={onSelect ? { click: () => onSelect(anchor.loads[0].id) } : undefined}
            zIndexOffset={zIndexOffset}
          >
            <Popup {...POPUP_PAN_PADDING}>
              <div className="map-popup">
                <p className="map-popup__title">
                  {anchor.loads.length === 1 ? 'Pickup in ' : `${anchor.loads.length} pickups in `}
                  {place(anchor.origin)}
                </p>
                <ul className="map-popup__list">
                  {anchor.loads.slice(0, popupLimit).map((load) => (
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
                {anchor.loads.length > popupLimit ? (
                  <p className="map-popup__more">+{anchor.loads.length - popupLimit} more in the list</p>
                ) : null}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}
