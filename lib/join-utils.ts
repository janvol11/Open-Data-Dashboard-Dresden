import type { Feature, FeatureCollection } from "geojson";
import type { Bezugsebene } from "@/lib/bezugsebenen";
import { toFiniteNumber } from "@/lib/stats-utils";

export type AggregateMethod = "sum" | "mean" | "count";

// Für Karten meist "ratio": Absolute Zahlen sind in großen Stadtteilen
// automatisch höher und deshalb schlecht vergleichbar.
export type JoinMetric =
  | { kind: "aggregate"; column: string; method: AggregateMethod }
  | { kind: "ratio"; numerator: string; denominator: string; scale?: number };

export interface JoinReport {
  totalFeatures: number;
  matchedFeatures: number;
  /** Gebiete ohne passende Tabellenzeile */
  unmatchedFeatureNames: string[];
  totalKeys: number;
  matchedKeys: number;
  /** Tabellenwerte ohne passendes Gebiet */
  unmatchedKeyValues: string[];
  /** Zeilen mit leerem oder unlesbarem Schlüssel */
  unparsableRows: number;
}

export interface JoinResult {
  geoJson: FeatureCollection;
  report: JoinReport;
}

export function suggestResultAttributeName(metric: JoinMetric): string {
  if (metric.kind === "aggregate") {
    if (metric.method === "count") return "anzahl_zeilen";
    const prefix = metric.method === "sum" ? "summe" : "mittelwert";
    return `${prefix}_${metric.column}`;
  }
  const scale = metric.scale ?? 100;
  return scale === 100
    ? `anteil_${metric.numerator}_prozent`
    : `verhaeltnis_${metric.numerator}_je_${metric.denominator}`;
}

function computeMetricValue(rows: Record<string, unknown>[], metric: JoinMetric): number | null {
  if (metric.kind === "aggregate") {
    if (metric.method === "count") return rows.length;

    const values = rows
      .map((r) => toFiniteNumber(r[metric.column]))
      .filter((v): v is number => v !== null);
    if (values.length === 0) return null;

    const sum = values.reduce((a, b) => a + b, 0);
    return metric.method === "sum" ? sum : sum / values.length;
  }

  // Summe durch Summe. Beim Mittel der Einzelquoten zählten kleine
  // Wahlbezirke so viel wie große.
  const numeratorSum = rows.reduce((acc, r) => acc + (toFiniteNumber(r[metric.numerator]) ?? 0), 0);
  const denominatorSum = rows.reduce((acc, r) => acc + (toFiniteNumber(r[metric.denominator]) ?? 0), 0);
  if (denominatorSum === 0) return null;

  return (numeratorSum / denominatorSum) * (metric.scale ?? 100);
}

interface KeyGroup {
  rows: Record<string, unknown>[];
  /** Für den Bericht: wie der Wert in der Tabelle stand */
  sampleRawValue: string;
}

/**
 * Hängt eine Kennzahl aus der Tabelle an die passenden Gebiete. Beide Seiten
 * gehen durch normalizeKey der Ebene. Meist gibt es mehrere Zeilen je Gebiet,
 * die werden zu einem Wert zusammengefasst. Das Ergebnis ist ein normaler Layer.
 */
export function joinTableToGeometry(
  tableRows: Record<string, unknown>[],
  tableKeyColumn: string,
  geometry: FeatureCollection,
  ebene: Bezugsebene,
  metric: JoinMetric,
  resultAttributeName: string
): JoinResult {
  if (!ebene.geometry) {
    throw new Error(`Bezugsebene "${ebene.label}" hat keine Geometriequelle hinterlegt.`);
  }
  const { keyField, nameField } = ebene.geometry;

  const grouped = new Map<string, KeyGroup>();
  let unparsableRows = 0;

  for (const row of tableRows) {
    const raw = row[tableKeyColumn];
    if (raw === null || raw === undefined || raw === "") {
      unparsableRows++;
      continue;
    }
    const rawStr = String(raw);
    const key = ebene.normalizeKey(rawStr);
    if (key === null) {
      unparsableRows++;
      continue;
    }
    const group = grouped.get(key);
    if (group) group.rows.push(row);
    else grouped.set(key, { rows: [row], sampleRawValue: rawStr });
  }

  const matchedKeys = new Set<string>();
  const unmatchedFeatureNames: string[] = [];
  let matchedFeatures = 0;

  const joinedFeatures: Feature[] = geometry.features.map((feature) => {
    const rawGeomKey = feature.properties?.[keyField];
    const geomKey =
      rawGeomKey !== undefined && rawGeomKey !== null ? ebene.normalizeKey(String(rawGeomKey)) : null;
    const group = geomKey !== null ? grouped.get(geomKey) : undefined;

    if (group) {
      matchedKeys.add(geomKey!);
      matchedFeatures++;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          [resultAttributeName]: computeMetricValue(group.rows, metric),
          [`${resultAttributeName}__zeilen`]: group.rows.length,
        },
      };
    }

    unmatchedFeatureNames.push(String(feature.properties?.[nameField] ?? geomKey ?? "?"));
    return { ...feature, properties: { ...feature.properties, [resultAttributeName]: null } };
  });

  const geomKeys = new Set(
    geometry.features
      .map((f) => f.properties?.[keyField])
      .filter((v): v is string | number => v !== undefined && v !== null)
      .map((v) => ebene.normalizeKey(String(v)))
      .filter((k): k is string => k !== null)
  );
  const unmatchedKeyValues = [...grouped.entries()]
    .filter(([key]) => !geomKeys.has(key))
    .map(([, group]) => group.sampleRawValue);

  return {
    geoJson: { ...geometry, features: joinedFeatures },
    report: {
      totalFeatures: geometry.features.length,
      matchedFeatures,
      unmatchedFeatureNames,
      totalKeys: grouped.size,
      matchedKeys: matchedKeys.size,
      unmatchedKeyValues,
      unparsableRows,
    },
  };
}
