"use client";

import { useCallback, useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { PathOptions } from "leaflet";
import type { Feature, FeatureCollection } from "geojson";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { useDashboardStore, MapLayer } from "@/store/useDashboardStore";
import { matchesCategoryValue, toFiniteNumber } from "@/lib/stats-utils";
import { buildCategoryColorIndex } from "@/lib/thematic-styling";
import { Map as MapIcon } from "lucide-react";
import { createHeatLayer } from "./heatmap-layer";
import { MapLegend } from "./map-legend";
import { PlaceSearch, type PlaceResult } from "./place-search";

// Marker-Icons aus dem Paket importieren. Den automatisch aus dem CSS
// abgeleiteten Pfad findet der Next.js-Bundler nicht, und ein CDN wollen wir
// aus Datenschutzgründen nicht.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x.src,
  iconUrl: markerIcon.src,
  shadowUrl: markerShadow.src,
});

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const TILE_MAX_ZOOM = 19;

const DRESDEN_CENTER: L.LatLngTuple = [51.0504, 13.7373];
const DEFAULT_ZOOM = 12;
const FIT_BOUNDS_OPTIONS: L.FitBoundsOptions = { padding: [50, 50], maxZoom: 16 };

type ChartFilter = ReturnType<typeof useDashboardStore.getState>["chartFilter"];

// Die Attribute kommen von fremden Servern und landen im Popup-HTML
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Gilt für Punkte und Flächen, weil setStyle auch die circleMarker trifft
function createStyleFn(layer: MapLayer): (feature?: Feature) => PathOptions {
  const categoryColorIndex = buildCategoryColorIndex(layer);

  const getFeatureColor = (feature?: Feature): string => {
    if (!layer.thematicStyling || !feature?.properties) return layer.color;

    const { attribute, type, colors, ranges } = layer.thematicStyling;
    const value = feature.properties[attribute];

    if (value === undefined || value === null) return layer.color;

    if (type === "numeric" && ranges) {
      // "k.A." & Co. in Layer-Farbe statt in der obersten Klasse
      const numVal = toFiniteNumber(value);
      if (numVal === null) return layer.color;
      for (let i = 0; i < ranges.length; i++) {
        if (numVal <= ranges[i]) return colors[i] || layer.color;
      }
      return colors[colors.length - 1] || layer.color;
    } else if (type === "categorical") {
      const index = categoryColorIndex?.get(String(value));
      if (index === undefined) return layer.color;
      return colors[index % colors.length] || layer.color;
    }

    return layer.color;
  };

  const isPointFeature = (feature?: Feature): boolean =>
    feature?.geometry?.type === "Point" || feature?.geometry?.type === "MultiPoint";

  return (feature?: Feature): PathOptions => {
    const c = getFeatureColor(feature);

    if (isPointFeature(feature)) {
      return {
        color: "#fff",
        weight: 1.5,
        opacity: 1,
        fillColor: c,
        fillOpacity: layer.opacity,
      };
    }

    return {
      color: c,
      weight: 2,
      opacity: layer.opacity,
      fillColor: c,
      // Eingefärbte Flächen brauchen mehr Deckkraft als reine Umrisse
      fillOpacity: layer.thematicStyling ? layer.opacity * 0.7 : layer.opacity * 0.25,
    };
  };
}

function buildPopupHtml(feature: Feature, layer: MapLayer): string {
  const entries = Object.entries(feature.properties ?? {}).filter(
    ([, v]) => v !== null && v !== undefined
  );

  const toRows = (rows: [string, unknown][]) =>
    rows
      .map(
        ([k, v]) =>
          `<tr>
            <td style="padding:2px 6px 2px 0;color:#888;font-size:11px;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td>
            <td style="padding:2px 0;font-size:11px;word-break:break-word">${escapeHtml(v)}</td>
          </tr>`
      )
      .join("");

  const more =
    entries.length > 8
      ? `<tr>
           <td colspan="2" style="padding-top:8px">
             <details style="font-size:11px;color:#888">
               <summary style="cursor:pointer;outline:none;user-select:none">+${entries.length - 8} weitere anzeigen</summary>
               <table style="border-collapse:collapse;width:100%;margin-top:4px">
                 ${toRows(entries.slice(8))}
               </table>
             </details>
           </td>
         </tr>`
      : "";

  return `
    <div style="min-width:180px; max-height: 250px; overflow-y: auto; padding-right: 4px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;color:${layer.color};padding-bottom:4px;border-bottom:2px solid ${layer.color}20">
        ${escapeHtml(layer.label)}
      </div>
      <table style="border-collapse:collapse;width:100%">
        ${toRows(entries.slice(0, 8))}${more}
      </table>
    </div>`;
}

function createGeoJsonLayer(layer: MapLayer, data: FeatureCollection): L.GeoJSON {
  const style = createStyleFn(layer);

  return L.geoJSON(data, {
    style,
    pointToLayer: (feature, latlng) =>
      L.circleMarker(latlng, { radius: 7, ...style(feature) }),
    onEachFeature: (feature, leafletLayer) => {
      if (!feature.properties) return;
      leafletLayer.bindPopup(() => buildPopupHtml(feature, layer), { maxWidth: 320 });
    },
  });
}

function applyChartFilter(
  geoJson: FeatureCollection,
  chartFilter: ChartFilter
): FeatureCollection {
  if (!chartFilter) return geoJson;

  // Layer ohne dieses Attribut bleiben unverändert sichtbar
  const hasAttribute = geoJson.features.some(
    (f) => f.properties && chartFilter.attribute in f.properties
  );
  if (!hasAttribute) return geoJson;

  return {
    ...geoJson,
    features: geoJson.features.filter((f) =>
      matchesCategoryValue(f.properties?.[chartFilter.attribute], chartFilter.value)
    ),
  };
}

interface RenderedLayer {
  key: string;
  /** Neue Daten = Layer neu aufbauen */
  source: FeatureCollection;
  instance: L.Layer;
  isHeatmap: boolean;
}

export default function LeafletMap() {
  const layers = useDashboardStore((s) => s.layers);
  const chartFilter = useDashboardStore((s) => s.chartFilter);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const renderedRef = useRef<Map<string, RenderedLayer>>(new Map());
  const placeMarkerRef = useRef<L.CircleMarker | null>(null);

  const hasAnyData = layers.some((l) => l.geoJson !== null && l.visible);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const rendered = renderedRef.current;

    const map = L.map(containerRef.current, {
      center: DRESDEN_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: TILE_MAX_ZOOM,
    }).addTo(map);

    map.on("moveend", () => {
      // Bei 0×0 (noch kein Layout) liefert Leaflet Unsinn-Bounds, die alles
      // wegfiltern würden
      const size = map.getSize();
      if (size.x === 0 || size.y === 0) return;

      const bounds = map.getBounds();
      useDashboardStore.getState().setMapBoundsFilter([
        [bounds.getSouth(), bounds.getWest()],
        [bounds.getNorth(), bounds.getEast()],
      ]);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      rendered.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const rendered = renderedRef.current;
    const activeIds = new Set<string>();

    for (const layer of layers) {
      if (!layer.visible || !layer.geoJson) continue;
      activeIds.add(layer.id);

      const displayData = applyChartFilter(layer.geoJson, chartFilter);
      const filterKey = chartFilter ? `${chartFilter.attribute}=${chartFilter.value}` : "none";
      const key = `${displayData.features.length}_${filterKey}_${layer.renderAsHeatmap ? "heat" : "geo"}`;
      const existing = rendered.get(layer.id);

      if (existing && existing.key === key && existing.source === layer.geoJson) {
        // Nur der Stil hat sich geändert, das geht ohne Neuaufbau
        if (!existing.isHeatmap) {
          (existing.instance as L.GeoJSON).setStyle(createStyleFn(layer));
        }
        continue;
      }

      if (existing) map.removeLayer(existing.instance);

      const instance = layer.renderAsHeatmap
        ? createHeatLayer(displayData)
        : createGeoJsonLayer(layer, displayData);

      instance.addTo(map);
      rendered.set(layer.id, {
        key,
        source: layer.geoJson,
        instance,
        isHeatmap: !!layer.renderAsHeatmap,
      });
    }

    for (const [id, entry] of rendered) {
      if (!activeIds.has(id)) {
        map.removeLayer(entry.instance);
        rendered.delete(id);
      }
    }
  }, [layers, chartFilter]);

  // Nur neu zoomen, wenn sich die Zahl der sichtbaren Layer ändert
  const loadedCount = layers.filter((l) => l.visible && l.geoJson?.features?.length).length;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || loadedCount === 0) return;

    const visibleWithData = useDashboardStore
      .getState()
      .layers.filter((l) => l.visible && l.geoJson?.features?.length);

    try {
      const allBounds = visibleWithData.map((l) => L.geoJSON(l.geoJson!).getBounds());
      const combined = allBounds.reduce((acc, b) => acc.extend(b));
      if (combined.isValid()) {
        map.fitBounds(combined, FIT_BOUNDS_OPTIONS);
      }
    } catch (err) {
      console.error("Error calculating bounds", err);
    }
  }, [loadedCount]);

  // Auf die gefilterten Features zoomen. Absichtlich nur bei neuem Filter;
  // mit layers als Abhängigkeit zoomte schon der Deckkraft-Regler.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !chartFilter) return;

    try {
      const bounds = L.latLngBounds([]);
      let hasData = false;

      useDashboardStore
        .getState()
        .layers.filter((l) => l.visible && l.geoJson)
        .forEach((layer) => {
          const filteredFeatures = layer.geoJson!.features.filter((f) => {
            if (!f.properties) return false;
            return matchesCategoryValue(
              f.properties[chartFilter.attribute],
              chartFilter.value
            );
          });

          if (filteredFeatures.length > 0) {
            hasData = true;
            const filteredCollection: FeatureCollection = {
              type: "FeatureCollection",
              features: filteredFeatures,
            };
            bounds.extend(L.geoJSON(filteredCollection).getBounds());
          }
        });

      if (hasData && bounds.isValid()) {
        map.fitBounds(bounds, { ...FIT_BOUNDS_OPTIONS, animate: true, duration: 0.8 });
      }
    } catch (err) {
      console.error("Error calculating bounds for filtered features", err);
    }
  }, [chartFilter]);

  const showPlace = useCallback((place: PlaceResult) => {
    const map = mapRef.current;
    if (!map) return;

    const [south, north, west, east] = place.bounds;
    map.fitBounds(
      [
        [south, west],
        [north, east],
      ],
      { padding: [40, 40], maxZoom: 17, animate: true, duration: 0.8 }
    );

    placeMarkerRef.current?.remove();
    placeMarkerRef.current = L.circleMarker([place.lat, place.lon], {
      radius: 8,
      color: "#ffffff",
      weight: 2,
      fillColor: "#6366f1",
      fillOpacity: 1,
    })
      .bindTooltip(place.name, { direction: "top", offset: [0, -8] })
      .addTo(map);
  }, []);

  return (
    <div className="w-full h-full relative" style={{ zIndex: 0 }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%", zIndex: 0 }} />

      <PlaceSearch onSelect={showPlace} />

      <MapLegend layers={layers} />

      {!hasAnyData && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-1000">
          <div className="bg-background/90 backdrop-blur-sm p-4 rounded-xl border shadow-sm flex flex-col items-center gap-2 max-w-xs text-center">
            <MapIcon className="h-8 w-8 text-muted-foreground opacity-50" />
            <p className="text-sm font-medium">Keine Kartendaten geladen</p>
            <p className="text-xs text-muted-foreground">
              Wähle einen WFS-Datensatz in der Sidebar aus, um ihn hier auf der Karte zu betrachten.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
