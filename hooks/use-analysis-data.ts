"use client";

import type { FeatureCollection } from "geojson";
import { useDashboardStore } from "@/store/useDashboardStore";
import { calculateFeatureStats, matchesCategoryValue, type AttributeStats } from "@/lib/stats-utils";
import { isFeatureInBounds, type MapBounds } from "@/lib/geo-utils";

type ChartFilter = { attribute: string; value: string | number } | null;

/**
 * Gemeinsame Datengrundlage der Analyse-Widgets: die primäre Quelle, auf den
 * Kartenausschnitt und den im Diagramm angeklickten Wert gefiltert
 * (Cross-Filtering), samt Attributstatistik.
 *
 * Bewusst außerhalb von React zwischengespeichert statt per useMemo: useMemo
 * gilt je Komponente, jedes der fünf Widgets hätte Filterung und Statistik
 * sonst bei jedem Kartenschwenk erneut über alle Features berechnet. Beide
 * Filterstufen haben einen eigenen Cache, weil die Attribut-Verteilung nur die
 * erste Stufe nutzt und die übrigen Widgets beide – ein gemeinsamer Eintrag
 * würde bei jedem Render zwischen den Varianten hin- und herspringen.
 */
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

/** Statistik je gefilterter Collection; WeakMap, damit alte Ausschnitte freigegeben werden. */
const statsCache = new WeakMap<FeatureCollection, AttributeStats[]>();

function filterByBounds(
  source: FeatureCollection | null,
  bounds: MapBounds | null
): FeatureCollection | null {
  if (lastBoundsFiltered && lastBoundsFiltered.source === source && lastBoundsFiltered.bounds === bounds) {
    return lastBoundsFiltered.result;
  }

  const result =
    source && bounds
      ? { ...source, features: source.features.filter((f) => isFeatureInBounds(f, bounds)) }
      : source;

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

  // Ein Filter auf ein Attribut, das die aktive Quelle gar nicht hat (etwa
  // nach einem Wechsel des primären Layers), ließe sonst alle Widgets leer
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
 * Liefert die gefilterten Daten und ihre Statistik (von allen Widgets geteilt).
 *
 * `ignoreChartFilter` ist für die Attribut-Verteilung gedacht: Sie setzt den
 * Filter selbst und muss weiter alle Werte zeigen, sonst bliebe nach dem Klick
 * nur noch der gewählte Balken übrig.
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
