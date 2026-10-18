import { useMemo } from 'react';
import { Marker, Polyline, Popup } from 'react-leaflet';
import type { Place } from '../../../shared/types';
import { lane, place } from '../lib/format';
import { BaseMap, FitToPoints, pinIcon, type LatLngLike, type MapPin } from './MapBase';

export type { MapPin, PinKind } from './MapBase';

export interface RouteMapProps {
  origin: Place;
  destination: Place;
  /** Driver's current location: truck pin plus a dashed deadhead line to pickup. */
  driverLocation?: Place | null;
  /** Any other pins (home base, backhaul pickups...). */
  extraPins?: MapPin[];
  /** CSS height. Default 240. */
  height?: number | string;
  className?: string;
}

/** Origin (A) and destination (B) pins with a line between them, fitted to the view. */
export function RouteMap({ origin, destination, driverLocation, extraPins = [], height = 240, className }: RouteMapProps) {
  const points = useMemo(() => {
    const list: LatLngLike[] = [origin, destination, ...extraPins];
    if (driverLocation) list.push(driverLocation);
    return list.filter((p) => p.lat !== 0 || p.lng !== 0);
  }, [origin, destination, driverLocation, extraPins]);

  const ariaLabel =
    `Map of ${lane(origin, destination)}` + (driverLocation ? `, with your truck at ${place(driverLocation)}` : '');

  return (
    <BaseMap height={height} className={className} ariaLabel={ariaLabel} interactive={false}>
      <FitToPoints points={points} />
      {driverLocation ? (
        <>
          <Polyline
            positions={[
              [driverLocation.lat, driverLocation.lng],
              [origin.lat, origin.lng],
            ]}
            className="map-line map-line--deadhead"
            pathOptions={{ weight: 3, dashArray: '6 8' }}
          />
          <Marker
            position={[driverLocation.lat, driverLocation.lng]}
            icon={pinIcon('driver')}
            keyboard={false}
            title={`You: ${place(driverLocation)}`}
          />
        </>
      ) : null}
      <Polyline
        positions={[
          [origin.lat, origin.lng],
          [destination.lat, destination.lng],
        ]}
        className="map-line map-line--route"
        pathOptions={{ weight: 4 }}
      />
      <Marker position={[origin.lat, origin.lng]} icon={pinIcon('origin')} keyboard={false} title={`Pickup: ${place(origin)}`} />
      <Marker
        position={[destination.lat, destination.lng]}
        icon={pinIcon('destination')}
        keyboard={false}
        title={`Delivery: ${place(destination)}`}
      />
      {extraPins.map((pin, i) => (
        <Marker
          key={`${pin.lat},${pin.lng},${i}`}
          position={[pin.lat, pin.lng]}
          icon={pinIcon(pin.kind ?? 'stop')}
          title={pin.label}
          keyboard={false}
        >
          {pin.popup ? <Popup>{pin.popup}</Popup> : null}
        </Marker>
      ))}
    </BaseMap>
  );
}
