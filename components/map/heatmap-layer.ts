"use client";

import L from "leaflet";
import "leaflet.heat";
import type { FeatureCollection } from "geojson";
import * as turf from "@turf/turf";

export interface HeatmapOptions {
  radius?: number;
  blur?: number;
  maxZoom?: number;
  max?: number;
}

/**
 * Baut aus einer FeatureCollection einen leaflet.heat-Layer.
 *
 * Bewusst eine Factory statt einer React-Komponente: Der Layer wird von
 * leaflet-map.tsx zusammen mit allen anderen Layern imperativ verwaltet.
 */
export function createHeatLayer(
  geoJson: FeatureCollection,
  { radius = 25, blur = 15, maxZoom = 15, max = 1.0 }: HeatmapOptions = {}
): L.Layer {
  const points: [number, number, number][] = [];

  geoJson.features.forEach((feature) => {
    if (!feature.geometry) return;
    try {
      // Bei Polygon/Linie den Mittelpunkt nehmen statt der ganzen Geometrie
      const center = turf.center(feature);
      const coords = center.geometry.coordinates;
      if (coords && coords.length >= 2) {
        points.push([coords[1], coords[0], 1]); // turf: [lon, lat] → leaflet: [lat, lon]
      }
    } catch {
      // ungültige Geometrie überspringen
    }
  });

  // L.heatLayer wird zur Laufzeit von leaflet.heat ergänzt
  return L.heatLayer(points, { radius, blur, maxZoom, max });
}
