// Shared Leaflet plumbing for RouteMap and LoadsMap. Pins are L.divIcon HTML (no image assets)
// styled in styles.css, so the maps still show pins and lines when the tile server is unreachable.
import L from 'leaflet';
import { useEffect, type ReactNode } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { cx } from '../lib/cx';

export type PinKind = 'origin' | 'destination' | 'driver' | 'home' | 'stop';

export interface MapPin {
  lat: number;
  lng: number;
  label: string;
  kind?: PinKind;
  /** Popup content shown when the pin is tapped. */
  popup?: ReactNode;
}

export interface LatLngLike {
  lat: number;
  lng: number;
}

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const US_CENTER: L.LatLngTuple = [39.5, -98.35];

const GLYPHS: Record<PinKind, string> = {
  origin: 'A',
  destination: 'B',
  driver:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5h11v10h-11z"/><path d="M13.5 9h4.2l3.3 3.6v2.9h-7.5"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M3.5 10.5 12 3.5l8.5 7V20.5h-5.5v-6h-6v6H3.5z"/></svg>',
  stop: '',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const iconCache = new Map<string, L.DivIcon>();

/**
 * A teardrop pin. `text` replaces the default glyph (the match score on the load map) and `count`
 * adds a small "×3" bubble so a score and a number of loads never look alike. `cluster` draws a
 * ringed pin that stands for several nearby pickup cities (tapping it zooms in).
 */
export function pinIcon(kind: PinKind, text?: string, selected = false, count = 1, cluster = false): L.DivIcon {
  const key = `${kind}|${text === undefined ? '-' : `t:${text}`}|${selected}|${count}|${cluster}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const glyph = text !== undefined ? escapeHtml(text) : GLYPHS[kind];
    const classes = `map-pin map-pin--${kind}${selected ? ' map-pin--selected' : ''}${cluster ? ' map-pin--cluster' : ''}`;
    const bubble = count > 1 ? `<span class="map-pin__count">×${count}</span>` : '';
    icon = L.divIcon({
      className: 'map-pin-anchor',
      html: `<span class="${classes}"><span class="map-pin__glyph">${glyph}</span></span>${bubble}`,
      iconSize: [32, 40],
      iconAnchor: [16, 39],
      popupAnchor: [0, -36],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

let truckBadge: L.DivIcon | null = null;

/**
 * The driver's own position: a round truck badge centred on the spot, not a pin. A pickup pin in the
 * same city stands on that spot with its head above it, so both stay visible (draw the badge on top).
 */
export function truckIcon(): L.DivIcon {
  truckBadge ??= L.divIcon({
    className: 'map-pin-anchor',
    html: `<span class="map-badge map-badge--driver">${GLYPHS.driver}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });
  return truckBadge;
}

/** Keeps a popup clear of the zoom buttons (top left) and the attribution line. */
export const POPUP_PAN_PADDING = {
  autoPanPaddingTopLeft: [64, 16] as L.PointTuple,
  autoPanPaddingBottomRight: [16, 28] as L.PointTuple,
};

/** Fits the view to the given points whenever they change, and keeps Leaflet sized to its box. */
export function FitToPoints({ points, maxZoom = 9 }: { points: LatLngLike[]; maxZoom?: number }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join('|');

  useEffect(() => {
    if (points.length === 0) {
      map.setView(US_CENTER, 4);
    } else if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], Math.min(maxZoom, 8));
    } else {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as L.LatLngTuple)), { padding: [36, 36], maxZoom });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key, maxZoom]);

  useEffect(() => {
    const el = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(el);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

export interface BaseMapProps {
  height: number | string;
  className?: string;
  ariaLabel: string;
  /** Keyboard-focusable markers (true for the loads map; the route map is decorative). */
  interactive: boolean;
  children: ReactNode;
}

export function BaseMap({ height, className, ariaLabel, interactive, children }: BaseMapProps) {
  // One-finger drags on phones should scroll the page, not pan a preview map.
  const touch = L.Browser.mobile;
  return (
    // Not role="img": the OpenStreetMap attribution must stay a working link, and an image cannot
    // contain links (axe: nested-interactive). A labelled group keeps the map's description.
    <div className={cx('map', className)} style={{ height }} role={interactive ? 'region' : 'group'} aria-label={ariaLabel}>
      <MapContainer
        center={US_CENTER}
        zoom={4}
        scrollWheelZoom={false}
        dragging={!touch}
        keyboard={interactive}
        zoomControl={interactive}
        attributionControl
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={18} />
        {children}
      </MapContainer>
    </div>
  );
}
