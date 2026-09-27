"use client";

import L from "leaflet";
import "leaflet.heat";
import type { FeatureCollection } from "geojson";
import { center } from "@turf/center";

export interface HeatmapOptions {
  radius?: number;
  blur?: number;
  maxZoom?: number;
  max?: number;
}

/** leaflet.heat-Layer; verwaltet wird er in leaflet-map.tsx wie die anderen Layer. */
export function createHeatLayer(
  geoJson: FeatureCollection,
  { radius = 25, blur = 15, maxZoom = 15, max = 1.0 }: HeatmapOptions = {}
): L.Layer {
  const points: [number, number, number][] = [];

  geoJson.features.forEach((feature) => {
    if (!feature.geometry) return;
    try {
      // Flächen und Linien zählen mit ihrem Mittelpunkt
      const coords = center(feature).geometry.coordinates;
      if (coords && coords.length >= 2) {
        points.push([coords[1], coords[0], 1]); // Leaflet will [lat, lon]
      }
    } catch {
      // kaputte Geometrie überspringen
    }
  });

  return L.heatLayer(points, { radius, blur, maxZoom, max });
}
