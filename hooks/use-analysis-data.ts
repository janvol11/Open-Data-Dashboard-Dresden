"use client";

import type { FeatureCollection } from "geojson";
import { useDashboardStore } from "@/store/useDashboardStore";
import { calculateFeatureStats, type AttributeStats } from "@/lib/stats-utils";
import { isFeatureInBounds, type MapBounds } from "@/lib/geo-utils";

/**
 * Gemeinsame Datengrundlage der Analyse-Widgets: die primäre Quelle, auf den
 * Kartenausschnitt gefiltert (Cross-Filtering), samt Attributstatistik.
 *
 * Bewusst außerhalb von React zwischengespeichert statt per useMemo: useMemo
 * gilt je Komponente, jedes der fünf Widgets hätte Filterung und Statistik
 * sonst bei jedem Kartenschwenk erneut über alle Features berechnet.
 */
let lastFiltered: {
  source: FeatureCollection | null;
  bounds: MapBounds | null;
  result: FeatureCollection | null;
} | null = null;

/** Statistik je gefilterter Collection; WeakMap, damit alte Ausschnitte freigegeben werden. */
const statsCache = new WeakMap<FeatureCollection, AttributeStats[]>();

function getFilteredData(
  source: FeatureCollection | null,
  bounds: MapBounds | null
): FeatureCollection | null {
  if (lastFiltered && lastFiltered.source === source && lastFiltered.bounds === bounds) {
    return lastFiltered.result;
  }

  const result =
    source && bounds
      ? { ...source, features: source.features.filter((f) => isFeatureInBounds(f, bounds)) }
      : source;

  lastFiltered = { source, bounds, result };
  return result;
}

function getStats(data: FeatureCollection | null): AttributeStats[] {
  if (!data) return [];
  let stats = statsCache.get(data);
  if (!stats) {
    stats = calculateFeatureStats(data);
    statsCache.set(data, stats);
  }
  return stats;
}

/** Liefert die auf den Kartenausschnitt gefilterten Daten und ihre Statistik (von allen Widgets geteilt). */
export function useAnalysisData(): {
  geoJsonData: FeatureCollection | null;
  dataToAnalyze: FeatureCollection | null;
  stats: AttributeStats[];
} {
  const geoJsonData = useDashboardStore((s) => s.geoJsonData);
  const mapBoundsFilter = useDashboardStore((s) => s.mapBoundsFilter);

  const dataToAnalyze = getFilteredData(geoJsonData, mapBoundsFilter);
  return { geoJsonData, dataToAnalyze, stats: getStats(dataToAnalyze) };
}
