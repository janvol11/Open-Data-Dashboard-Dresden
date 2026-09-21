import type { Feature, FeatureCollection } from "geojson";
import type { Bezugsebene } from "@/lib/bezugsebenen";
import { toFiniteNumber } from "@/lib/stats-utils";

export type AggregateMethod = "sum" | "mean" | "count";

/**
 * Absolute Mengen taugen nicht zum Einfärben – ein großer Stadtteil hat immer
 * mehr von allem. "ratio" ist deshalb kein Komfort-Extra, sondern der
 * eigentliche Zweck des Joins: eine Kennzahl, die zwei Gebiete vergleichbar macht.
 */
export type JoinMetric =
  | { kind: "aggregate"; column: string; method: AggregateMethod }
  | { kind: "ratio"; numerator: string; denominator: string; scale?: number };

export interface JoinReport {
  totalFeatures: number;
  matchedFeatures: number;
  /** Anzeigenamen der Geometrie-Objekte ohne passende Tabellenzeile. */
  unmatchedFeatureNames: string[];
  totalKeys: number;
  matchedKeys: number;
  /** Rohe Tabellenwerte, deren normalisierter Schlüssel in keiner Geometrie auftaucht. */
  unmatchedKeyValues: string[];
  /** Zeilen, deren Schlüsselfeld leer war oder sich nicht normalisieren ließ. */
  unparsableRows: number;
}

export interface JoinResult {
  geoJson: FeatureCollection;
  report: JoinReport;
}

/** Baut aus der Metrik-Konfiguration einen lesbaren Attributnamen für das Join-Ergebnis. */
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

  // ratio: Summe Zähler ÷ Summe Nenner – nicht Zeile-für-Zeile gemittelt, das
  // würde Wahlbezirke mit wenigen Wahlberechtigten genauso stark gewichten
  // wie große und den Anteil verzerren
  const numeratorSum = rows.reduce((acc, r) => acc + (toFiniteNumber(r[metric.numerator]) ?? 0), 0);
  const denominatorSum = rows.reduce((acc, r) => acc + (toFiniteNumber(r[metric.denominator]) ?? 0), 0);
  if (denominatorSum === 0) return null; // Division durch 0 vermeiden statt Infinity/NaN zu erzeugen

  return (numeratorSum / denominatorSum) * (metric.scale ?? 100);
}

interface KeyGroup {
  rows: Record<string, unknown>[];
  /** Erster roher Tabellenwert zu diesem Schlüssel, für lesbare Fehlermeldungen. */
  sampleRawValue: string;
}

/**
 * Verknüpft Tabellenzeilen mit Geometrie-Features über eine gemeinsame
 * Bezugsebene. Beide Seiten laufen durch dieselbe `normalizeKey`-Funktion
 * (siehe lib/bezugsebenen.ts) – Tabellen liegen fast nie exakt auf der
 * Zielebene, deshalb werden mehrere Zeilen pro Schlüssel zur Kennzahl
 * aggregiert, nicht 1:1 zugewiesen.
 *
 * Schreibt das Ergebnis als zusätzliches Attribut in die Geometrie-Features –
 * danach ist es ein ganz normaler MapLayer, thematische Einfärbung, Popups,
 * Qualitätsbericht und Cross-Filtering greifen ohne weitere Anpassung.
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

  // 1) Tabellenzeilen nach normalisiertem Schlüssel gruppieren
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

  // 2) Je Geometrie-Feature den passenden Gruppenwert berechnen
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
          // Nachvollziehbarkeit: wie viele Tabellenzeilen in diesen Wert eingeflossen sind
          [`${resultAttributeName}__zeilen`]: group.rows.length,
        },
      };
    }

    unmatchedFeatureNames.push(String(feature.properties?.[nameField] ?? geomKey ?? "?"));
    return { ...feature, properties: { ...feature.properties, [resultAttributeName]: null } };
  });

  // 3) Tabellenschlüssel identifizieren, die in keiner Geometrie auftauchen
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
