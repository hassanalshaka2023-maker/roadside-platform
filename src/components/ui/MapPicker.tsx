"use client";

import { useEffect, useRef, useState } from "react";
import { Crosshair, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Map as LeafletMap, Marker } from "leaflet";

// Leaflet's own stylesheet. Without it the tiles stack on top of each other
// instead of forming a map. The tile domains are already allowed by the CSP
// in src/proxy.ts, and its inline styles by the style-src exception.
import "leaflet/dist/leaflet.css";

import { Button } from "./Button";
import { cn } from "@/lib/cn";

export interface MapPickerProps {
  lat: number | null;
  lng: number | null;
  onChange: (coords: { lat: number; lng: number }) => void;
  /** Tile config comes from the server, so it stays inside validated env. */
  tileUrl: string;
  tileAttribution: string;
  defaultLat: number;
  defaultLng: number;
  defaultZoom: number;
  className?: string;
}

/**
 * Leaflet map for picking the breakdown location.
 *
 * Leaflet rather than MapLibre on purpose: MapLibre needs WebGL, which is
 * exactly what fails on the old Android phones this product targets. Raster
 * tiles render anywhere.
 *
 * Leaflet is used directly rather than through react-leaflet - the wrapper
 * adds a dependency and couples us to its React support, for about sixty
 * lines of lifecycle we can own.
 */
export function MapPicker({
  lat,
  lng,
  onChange,
  tileUrl,
  tileAttribution,
  defaultLat,
  defaultLng,
  defaultZoom,
  className,
}: MapPickerProps) {
  const t = useTranslations("requests");

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);

  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Kept in a ref so the map effect does not need onChange as a dependency
  // and therefore never tears the map down when the parent re-renders.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    // Leaflet touches `window` at import time, so it can only be loaded in
    // the browser - hence the dynamic import rather than a top-level one.
    void (async () => {
      const L = await import("leaflet");
      if (cancelled || mapRef.current) return;

      const map = L.map(container, {
        center: [lat ?? defaultLat, lng ?? defaultLng],
        zoom: lat !== null ? 16 : defaultZoom,
        // The page scrolls on a phone; a map that eats scroll gestures is a
        // trap. Panning still works by dragging.
        scrollWheelZoom: false,
        attributionControl: true,
      });

      L.tileLayer(tileUrl, {
        attribution: tileAttribution,
        maxZoom: 19,
      }).addTo(map);

      // A plain circle marker: the default Leaflet pin needs image assets,
      // which would mean shipping and CSP-allowing them for no benefit.
      const marker = L.circleMarker([lat ?? defaultLat, lng ?? defaultLng], {
        radius: 10,
        color: "#0B0B0F",
        weight: 3,
        fillColor: "#FFD400",
        fillOpacity: 1,
      }).addTo(map);

      map.on("click", (event: { latlng: { lat: number; lng: number } }) => {
        const { lat: clickedLat, lng: clickedLng } = event.latlng;
        marker.setLatLng([clickedLat, clickedLng]);
        onChangeRef.current({ lat: clickedLat, lng: clickedLng });
      });

      mapRef.current = map;
      markerRef.current = marker as unknown as Marker;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Intentionally mounted once: re-running would destroy and rebuild the
    // map, losing the user's pan and zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker in step when the parent changes the coordinates, e.g.
  // after the "use my location" button.
  useEffect(() => {
    if (!ready || lat === null || lng === null) return;
    markerRef.current?.setLatLng([lat, lng]);
    mapRef.current?.setView([lat, lng], Math.max(mapRef.current.getZoom(), 16));
  }, [lat, lng, ready]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setGeoError(t("location.geoUnsupported"));
      return;
    }

    setGeoError(null);
    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onChangeRef.current({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        setLocating(false);
        // Never distinguish "denied" from "unavailable": the user only needs
        // to know they can place the pin themselves.
        setGeoError(t("location.geoFailed"));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        role="application"
        aria-label={t("location.mapLabel")}
        className={cn(
          "h-72 w-full overflow-hidden rounded-lg border-2 border-gray-300 bg-gray-100",
          className,
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={useMyLocation} disabled={locating}>
          {locating ? (
            <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" />
          ) : (
            <Crosshair aria-hidden="true" className="h-5 w-5" />
          )}
          {t("location.useMyLocation")}
        </Button>

        <p className="text-sm text-gray-600">{t("location.tapHint")}</p>
      </div>

      {geoError ? (
        <p role="alert" className="text-sm font-semibold text-brand-red">
          {geoError}
        </p>
      ) : null}

      {lat !== null && lng !== null ? (
        <p className="numeric text-sm text-gray-600" dir="ltr">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </p>
      ) : null}
    </div>
  );
}
