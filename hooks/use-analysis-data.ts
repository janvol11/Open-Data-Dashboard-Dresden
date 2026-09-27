"use client";

import type { FeatureCollection } from "geojson";
import { useDashboardStore } from "@/store/useDashboardStore";
import { calculateFeatureStats, matchesCategoryValue, type AttributeStats } from "@/lib/stats-utils";
import { isFeatureInBounds, type MapBounds } from "@/lib/geo-utils";

type ChartFilter = { attribute: string; value: string | number } | null;

// Gefilterte Daten für die Auswertungs-Widgets (Kartenausschnitt + Diagrammfilter).
// Der Cache liegt auf Modulebene, damit nicht jedes Widget selbst filtert.
// Zwei Stufen, weil die Attribut-Verteilung den Diagrammfilter ignoriert.
let lastBoundsFiltered: {
  source: FeatureCollection | null;
  bounds: MapBounds | null;
  result: FeatureCollection | null;
} | null = null;

let lastChartFiltered: {
  source: FeatureCollection | null;
  filter: ChartFilter;
  result: FeatureCollection | null;
} | null = null;

/** WeakMap, damit alte Ausschnitte vom GC eingesammelt werden */
const statsCache = new WeakMap<FeatureCollection, AttributeStats[]>();

function filterByBounds(
  source: FeatureCollection | null,
  bounds: MapBounds | null
): FeatureCollection | null {
  if (lastBoundsFiltered && lastBoundsFiltered.source === source && lastBoundsFiltered.bounds === bounds) {
    return lastBoundsFiltered.result;
  }

  let result = source;
  if (source && bounds) {
    const inView = source.features.filter((f) => isFeatureInBounds(f, bounds));
    // Fällt nichts raus, dasselbe Objekt zurückgeben, dann greifen die Caches
    if (inView.length !== source.features.length) result = { ...source, features: inView };
  }

  lastBoundsFiltered = { source, bounds, result };
  return result;
}

function filterByChart(
  source: FeatureCollection | null,
  filter: ChartFilter
): FeatureCollection | null {
  if (lastChartFiltered && lastChartFiltered.source === source && lastChartFiltered.filter === filter) {
    return lastChartFiltered.result;
  }

  // Hat die Quelle das Attribut gar nicht (z.B. nach Layerwechsel), nicht filtern
  const applies =
    source !== null &&
    filter !== null &&
    source.features.some((f) => f.properties && filter.attribute in f.properties);

  const result = applies
    ? {
        ...source,
        features: source.features.filter((f) =>
          matchesCategoryValue(f.properties?.[filter.attribute], filter.value)
        ),
      }
    : source;

  lastChartFiltered = { source, filter, result };
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

/**
 * ignoreChartFilter: für die Attribut-Verteilung, die den Filter selbst setzt
 * und weiter alle Balken zeigen soll.
 */
export function useAnalysisData({ ignoreChartFilter = false }: { ignoreChartFilter?: boolean } = {}): {
  geoJsonData: FeatureCollection | null;
  dataToAnalyze: FeatureCollection | null;
  stats: AttributeStats[];
} {
  const geoJsonData = useDashboardStore((s) => s.geoJsonData);
  const mapBoundsFilter = useDashboardStore((s) => s.mapBoundsFilter);
  const chartFilter = useDashboardStore((s) => s.chartFilter);

  const inBounds = filterByBounds(geoJsonData, mapBoundsFilter);
  const dataToAnalyze = ignoreChartFilter ? inBounds : filterByChart(inBounds, chartFilter);
  return { geoJsonData, dataToAnalyze, stats: getStats(dataToAnalyze) };
}
