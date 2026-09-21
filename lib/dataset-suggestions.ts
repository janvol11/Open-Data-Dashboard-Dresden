/**
 * Analysiert ein geladenes GeoJSON-Dataset und leitet priorisierte
 * Konfigurationsvorschläge für den Nutzer ab.
 *
 * `analyzeDatasetForSuggestions` ist eine reine Funktion (unit-testbar ohne
 * React). Jeder `Suggestion` kapselt seine eigene `action`, die den Store
 * mutiert und dabei ein sichtbares Ergebnis erzeugt (z.B. inkl. Deaktivieren
 * einer konkurrierenden Heatmap). Vorschläge sind nach `priority` absteigend
 * sortiert.
 */

import type { FeatureCollection } from "geojson";
import {
  calculateFeatureStats,
  collectNumericValues,
  computeQuantileBreaks,
  toFiniteNumber,
  type AttributeStats,
} from "@/lib/stats-utils";
import { detectTimeAttributes } from "@/lib/time-utils";
import type { DashboardState } from "@/store/useDashboardStore";

export type SuggestionType =
  | "HEATMAP"
  | "THEMATIC_NUMERIC"
  | "THEMATIC_CATEGORICAL"
  | "TEMPORAL_FOCUS"
  | "CORRELATION"
  | "VISUAL_ANALYTICS"
  | "LARGE_DATASET"
  | "DATA_QUALITY"
  | "CLUSTERING";

/**
 * Vorschläge derselben Konfliktgruppe schreiben auf dieselbe Layer-Einstellung.
 * "Alle anwenden" wendet je Gruppe und Layer nur den höchstpriorisierten
 * Vorschlag an, damit der letzte angewendete nicht alle vorherigen überschreibt.
 */
export const CONFLICT_GROUP_APPEARANCE = "layer-appearance";

/** Ein einzelner Konfigurationsvorschlag für den Nutzer. */
export interface Suggestion {
  id: string;
  layerId: string;
  type: SuggestionType;
  title: string;
  description: string;
  /** Sortierung: höherer Wert → weiter oben. */
  priority: number;
  /** Siehe {@link CONFLICT_GROUP_APPEARANCE}. */
  conflictGroup?: string;
  /** Optionale Detail-Metadaten für die UI (Statistikwerte, Farbpalette etc.). */
  meta?: Record<string, unknown>;
  /** Wendet den Vorschlag an; erhält Store-State und Layer-ID. */
  action: (store: DashboardState, layerId: string) => void;
}

// Schlüsselwort-Listen für Heuristiken

const NUMERIC_VALUE_KEYWORDS = [
  "anzahl", "count", "wert", "value", "flaeche", "fläche",
  "laenge", "länge", "hoehe", "höhe", "breite", "gewicht",
  "menge", "summe", "betrag", "preis", "alter", "year", "jahr",
  "einwohner", "bevölkerung", "population", "kapazität", "capacity",
  "leistung", "power", "dichte", "density", "rate",
];

const CATEGORICAL_KEYWORDS = [
  "typ", "type", "art", "status", "kategorie", "category",
  "klasse", "class", "gruppe", "group", "nutzung", "use",
  "material", "zustand", "state", "phase", "zone", "bezeichnung",
  "name", "label", "code", "schluessel", "schlüssel",
];

/**
 * Primärschlüssel-Tokens, für Visualisierungen ungeeignet. Abgleich auf
 * TOKEN-Ebene statt Teilstring, da "id" sonst auch "valide" träfe.
 */
const ID_TOKENS = new Set([
  "id", "ids", "gid", "fid", "oid", "objectid", "globalid", "uuid", "guid",
  "pk", "key", "schluessel", "schlüssel", "kennzeichen", "nummer", "nr",
]);

/** Schlüssel-Endungen ohne Trennzeichen (z.B. "objektnr"), auf Nummern-Endungen beschränkt. */
const ID_SUFFIXES = ["nr", "nummer"];

/**
 * Koordinaten-Spalten: enthalten Zahlen, sind aber die Geometrie selbst –
 * Einfärbung/Korrelation darüber erzeugt nur Artefakte.
 */
const COORDINATE_TOKENS = new Set([
  "x", "y", "lat", "latitude", "lon", "lng", "longitude",
  "utm", "easting", "northing", "rechtswert", "hochwert",
  "koordinate", "koordinaten", "coord", "coords", "srid", "epsg",
]);

const NUMERIC_COLOR_PALETTES: Record<string, string[]> = {
  blue: ["#eff3ff", "#bdd7e7", "#6baed6", "#2171b5", "#084594"],
  red: ["#fff5f0", "#fcbba1", "#fc8d59", "#d7301f", "#67000d"],
  green: ["#f7fcf5", "#c7e9c0", "#74c476", "#238b45", "#00441b"],
  purple: ["#fcfbfd", "#dadaeb", "#9e9ac8", "#6a51a3", "#3f007d"],
  orange: ["#fff7ec", "#fee8c8", "#fdbb84", "#e34a33", "#7f0000"],
};

const CATEGORICAL_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b",
  "#a855f7", "#06b6d4", "#f97316", "#ec4899", "#84cc16", "#14b8a6",
  "#e11d48", "#0ea5e9",
];

// Hilfsfunktionen

/**
 * Zerlegt einen Attributnamen in Wort-Tokens (snake_case, kebab-case, camelCase).
 * z.B. "standort_nr" → ["standort", "nr"], "objectId" → ["object", "id"]
 */
function tokenize(name: string): string[] {
  return name
    .replace(/([a-zà-ÿ0-9])([A-ZÀ-Þ])/g, "$1 $2")
    .split(/[^a-zA-ZÀ-ÿ0-9]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
}

function nameContainsKeyword(name: string, keywords: string[]): boolean {
  const lower = name.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/** ISO- und deutsche Datums-/Zeitstempel-Schreibweisen. */
const DATE_VALUE_PATTERN =
  /^\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}\/\d{1,2}\/\d{4})([ T]\d{1,2}:\d{2}(:\d{2})?)?/;

/**
 * Prüft anhand der WERTE (nicht des Namens), ob ein Attribut Zeitstempel
 * enthält. Nötig für Felder wie "aend_dat" (deutsches Format), die weder
 * Namens-Heuristik noch `Date.parse` erkennen, aber bei wenigen
 * Bearbeitungsständen wie eine Kategorie aussehen.
 */
function looksTemporal(geoJson: FeatureCollection, attribute: string): boolean {
  const samples: string[] = [];
  for (const feature of geoJson.features) {
    const value = feature.properties?.[attribute];
    if (value === null || value === undefined || value === "") continue;
    samples.push(String(value));
    if (samples.length >= 20) break;
  }
  if (samples.length === 0) return false;

  const hits = samples.filter((s) => DATE_VALUE_PATTERN.test(s)).length;
  return hits / samples.length >= 0.8;
}

function hasToken(name: string, tokens: Set<string>): boolean {
  return tokenize(name).some((token) => tokens.has(token));
}

function hasIdMarker(name: string): boolean {
  const tokens = tokenize(name);
  if (tokens.some((token) => ID_TOKENS.has(token))) return true;
  return tokens.some((token) =>
    ID_SUFFIXES.some((suffix) => token.length > suffix.length && token.endsWith(suffix))
  );
}

/**
 * Erkennt für Visualisierungen ungeeignete Attribute: Primärschlüssel und
 * Koordinatenspalten, auch wenn nur an durchgängig eindeutigen Ganzzahlen
 * (Surrogatschlüssel) erkennbar.
 */
function isUnusableForVisualization(
  stat: AttributeStats,
  geoJson: FeatureCollection
): boolean {
  if (hasIdMarker(stat.name)) return true;
  if (hasToken(stat.name, COORDINATE_TOKENS)) return true;

  if (
    stat.type === "number" &&
    stat.count >= 10 &&
    stat.uniqueCount === stat.count
  ) {
    const values = collectNumericValues(geoJson, stat.name);
    if (values.length > 0 && values.every((v) => Number.isInteger(v))) return true;
  }

  return false;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Variationskoeffizient (Standardabweichung / |Mittelwert|) – dimensionslos
 * und dadurch über Attribute mit unterschiedlichen Einheiten vergleichbar.
 */
function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  return stdDev(values) / Math.abs(mean);
}

export function dominantGeometryType(geoJson: FeatureCollection): string | null {
  const counts: Record<string, number> = {};
  for (const feature of geoJson.features) {
    const type = feature.geometry?.type;
    if (type) counts[type] = (counts[type] ?? 0) + 1;
  }
  if (Object.keys(counts).length === 0) return null;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** Schätzt den Pearson-Korrelationskoeffizienten zweier numerischer Attribute. */
function estimateCorrelation(
  geoJson: FeatureCollection,
  attrA: string,
  attrB: string,
  sampleSize = 500
): number | null {
  const features = geoJson.features.slice(0, sampleSize);
  const pairsA: number[] = [];
  const pairsB: number[] = [];

  for (const f of features) {
    // Paarweiser Fallausschluss: fehlende Werte dürfen nicht als 0 einfließen,
    // sonst wird die Korrelation systematisch verzerrt
    const a = toFiniteNumber(f.properties?.[attrA]);
    const b = toFiniteNumber(f.properties?.[attrB]);
    if (a !== null && b !== null) {
      pairsA.push(a);
      pairsB.push(b);
    }
  }

  if (pairsA.length < 20) return null;

  const meanA = pairsA.reduce((s, v) => s + v, 0) / pairsA.length;
  const meanB = pairsB.reduce((s, v) => s + v, 0) / pairsB.length;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < pairsA.length; i++) {
    const da = pairsA[i] - meanA;
    const db = pairsB[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  return denom === 0 ? null : cov / denom;
}

function pickColorPalette(attrName: string): string[] {
  const lower = attrName.toLowerCase();
  if (lower.includes("red") || lower.includes("rot") || lower.includes("hitze") || lower.includes("temp")) {
    return NUMERIC_COLOR_PALETTES.red;
  }
  if (lower.includes("green") || lower.includes("gruen") || lower.includes("fläche") || lower.includes("grün")) {
    return NUMERIC_COLOR_PALETTES.green;
  }
  if (lower.includes("orange") || lower.includes("warn")) {
    return NUMERIC_COLOR_PALETTES.orange;
  }
  if (lower.includes("purple") || lower.includes("lila") || lower.includes("violet")) {
    return NUMERIC_COLOR_PALETTES.purple;
  }
  return NUMERIC_COLOR_PALETTES.blue;
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "–";
  if (Number.isInteger(value)) return value.toLocaleString("de-DE");
  return value.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

/**
 * Analysiert ein geladenes GeoJSON und gibt eine priorisierte Liste von
 * Konfigurationsvorschlägen zurück (max. 5).
 *
 * `sourceKey` identifiziert die Datenquelle (z.B. WFS-URL + Layername) und
 * bildet die Vorschlags-IDs. Die layerId taugt dafür nicht: Sie enthält einen
 * Zeitstempel, verworfene Vorschläge wären beim nächsten Laden derselben
 * Quelle sonst wieder da.
 */
export function analyzeDatasetForSuggestions(
  geoJson: FeatureCollection,
  layerId: string,
  sourceKey: string
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const featureCount = geoJson.features.length;

  if (featureCount === 0) return [];

  const stats = calculateFeatureStats(geoJson);
  const geomType = dominantGeometryType(geoJson);

  // `detectTimeAttributes` stuft jede Zahl 1900–2100 als Jahr ein; laufende
  // Nummern (z.B. "objektnr") filtern wir deshalb heraus
  const timeAttributes = detectTimeAttributes(geoJson).filter(
    (attr) => !hasIdMarker(attr) && !hasToken(attr, COORDINATE_TOKENS)
  );

  const usableStats = stats.filter((s) => !isUnusableForVisualization(s, geoJson));

  // 1. Heatmap: Punktdaten mit hoher Dichte sind als Einzelmarker kaum lesbar
  if (geomType === "Point" && featureCount >= 200) {
    suggestions.push({
      id: `heatmap-${sourceKey}`,
      layerId,
      type: "HEATMAP",
      title: "Heatmap aktivieren",
      description: `${featureCount.toLocaleString("de-DE")} Punktobjekte – eine Heatmap macht räumliche Dichte auf einen Blick erkennbar.`,
      priority: 100,
      conflictGroup: CONFLICT_GROUP_APPEARANCE,
      meta: { featureCount, geomType },
      action: (store, id) => {
        store.updateLayer(id, { renderAsHeatmap: true });
      },
    });
  }

  // 2. Numerisches thematisches Styling
  const numericCandidates = usableStats.filter(
    (s) =>
      s.type === "number" &&
      s.nullPercentage < 40 &&
      s.uniqueCount > 5 &&
      s.min !== undefined &&
      s.max !== undefined &&
      s.min !== s.max
  );

  // Bewertung: aussagekräftiger Name + hohe relative Streuung
  const rankedNumeric = numericCandidates
    .map((s) => {
      const values = collectNumericValues(geoJson, s.name);
      const keywordScore = nameContainsKeyword(s.name, NUMERIC_VALUE_KEYWORDS) ? 2 : 0;
      const spreadScore = Math.min(coefficientOfVariation(values), 3); // Ausreißer deckeln
      return { stat: s, values, score: keywordScore + spreadScore };
    })
    .sort((a, b) => b.score - a.score);

  const bestNumeric = rankedNumeric[0];

  if (bestNumeric) {
    const { stat, values } = bestNumeric;
    const fillRate = Math.round(100 - stat.nullPercentage);
    const palette = pickColorPalette(stat.name);
    const breaks = computeQuantileBreaks(values, palette.length);
    const colors = palette.slice(0, breaks.length);

    if (breaks.length >= 2) {
      suggestions.push({
        id: `thematic-numeric-${sourceKey}-${stat.name}`,
        layerId,
        type: "THEMATIC_NUMERIC",
        title: `Choropleth-Karte: „${stat.name}“`,
        description: `${breaks.length} Klassen aus ${stat.uniqueCount} Werten (${fillRate}% Datenvollständigkeit, ${formatValue(stat.min ?? 0)} – ${formatValue(stat.max ?? 0)}). Einfärbung nach Wert hebt räumliche Muster hervor.`,
        priority: 85,
        conflictGroup: CONFLICT_GROUP_APPEARANCE,
        meta: {
          attribute: stat.name,
          fillRate,
          min: stat.min,
          max: stat.max,
          palette: colors,
          breaks,
        },
        action: (store, id) => {
          store.updateLayer(id, {
            renderAsHeatmap: false, // Heatmap würde die Einfärbung überdecken
            thematicStyling: {
              attribute: stat.name,
              type: "numeric",
              colors,
              ranges: breaks,
            },
          });
        },
      });
    }
  }

  // 3. Kategorisches thematisches Styling
  const categoricalCandidates = usableStats.filter(
    (s) =>
      (s.type === "string" || s.type === "boolean") &&
      s.nullPercentage < 50 &&
      s.uniqueCount >= 2 &&
      s.uniqueCount <= 12 &&
      !looksTemporal(geoJson, s.name) // Zeitstempel sind keine Kategorien
  );

  const bestCategorical = [...categoricalCandidates].sort((a, b) => {
    const aKeyword = nameContainsKeyword(a.name, CATEGORICAL_KEYWORDS) ? 2 : 0;
    const bKeyword = nameContainsKeyword(b.name, CATEGORICAL_KEYWORDS) ? 2 : 0;
    const aCountScore = a.uniqueCount <= 6 ? 1 : 0; // weniger Kategorien = lesbarere Legende
    const bCountScore = b.uniqueCount <= 6 ? 1 : 0;
    return (bKeyword + bCountScore) - (aKeyword + aCountScore);
  })[0];

  if (bestCategorical) {
    const fillRate = Math.round(100 - bestCategorical.nullPercentage);
    const colors = CATEGORICAL_COLORS.slice(0, bestCategorical.uniqueCount);
    const topCategories = bestCategorical.frequencies
      ?.slice(0, 3)
      .map((f) => `„${f.name}“`)
      .join(", ");
    suggestions.push({
      id: `thematic-categorical-${sourceKey}-${bestCategorical.name}`,
      layerId,
      type: "THEMATIC_CATEGORICAL",
      title: `Kategorische Einfärbung: „${bestCategorical.name}“`,
      description: `${bestCategorical.uniqueCount} Kategorien erkannt (${fillRate}% gefüllt)${topCategories ? `: ${topCategories}…` : ""}. Jede Kategorie erhält eine eigene Farbe.`,
      priority: 72,
      conflictGroup: CONFLICT_GROUP_APPEARANCE,
      meta: {
        attribute: bestCategorical.name,
        categories: bestCategorical.uniqueCount,
        topCategories: bestCategorical.frequencies?.slice(0, 5),
        palette: colors,
      },
      action: (store, id) => {
        store.updateLayer(id, {
          renderAsHeatmap: false,
          thematicStyling: {
            attribute: bestCategorical.name,
            type: "categorical",
            colors,
          },
        });
      },
    });
  }

  // 4. Korrelationsanalyse: Paare mit hoher Korrelation (|r| > 0.55)
  if (rankedNumeric.length >= 2 && featureCount >= 30) {
    let bestCorr: { attrA: string; attrB: string; r: number } | null = null;

    const topNumeric = rankedNumeric.slice(0, 4);
    for (let i = 0; i < topNumeric.length; i++) {
      for (let j = i + 1; j < topNumeric.length; j++) {
        const attrA = topNumeric[i].stat.name;
        const attrB = topNumeric[j].stat.name;
        const r = estimateCorrelation(geoJson, attrA, attrB);
        if (r !== null && Math.abs(r) > 0.55) {
          if (!bestCorr || Math.abs(r) > Math.abs(bestCorr.r)) {
            bestCorr = { attrA, attrB, r };
          }
        }
      }
    }

    if (bestCorr) {
      const { attrA, attrB, r } = bestCorr;
      const strength = Math.abs(r) > 0.8 ? "starke" : "moderate";
      const direction = r > 0 ? "positive" : "negative";
      suggestions.push({
        id: `correlation-${sourceKey}-${attrA}-${attrB}`,
        layerId,
        type: "CORRELATION",
        title: `Korrelation entdeckt: r = ${r.toFixed(2)}`,
        description: `${strength} ${direction} Korrelation zwischen „${attrA}“ und „${attrB}“. Streudiagramm öffnen?`,
        priority: 78,
        meta: { attrA, attrB, r },
        action: (store) => {
          store.setCorrelationAttributes(attrA, attrB);
          const order = [...store.widgetOrder];
          const idx = order.indexOf("correlation");
          if (idx > 1) {
            order.splice(idx, 1);
            order.splice(2, 0, "correlation");
            store.setWidgetOrder(order);
          }
        },
      });
    }
  }

  // 5. Visual Analytics: gutes kategorisches Attribut für Balkendiagramm-Analyse
  const isChartableCategory = (s: AttributeStats, maxUnique: number) =>
    s.nullPercentage < 40 &&
    s.uniqueCount >= 2 &&
    s.uniqueCount <= maxUnique &&
    !looksTemporal(geoJson, s.name);

  const visualAnalyticsCandidate =
    usableStats.find(
      (s) =>
        (s.type === "string" || s.type === "boolean") &&
        isChartableCategory(s, 25) &&
        nameContainsKeyword(s.name, CATEGORICAL_KEYWORDS)
    ) ??
    usableStats.find((s) => s.type === "string" && isChartableCategory(s, 20));

  if (visualAnalyticsCandidate) {
    suggestions.push({
      id: `visual-analytics-${sourceKey}-${visualAnalyticsCandidate.name}`,
      layerId,
      type: "VISUAL_ANALYTICS",
      title: `Diagramm: Verteilung von „${visualAnalyticsCandidate.name}“`,
      description: `${visualAnalyticsCandidate.uniqueCount} verschiedene Werte gefunden. Balkendiagramm zur Häufigkeitsanalyse aktivieren.`,
      priority: 65,
      meta: {
        attribute: visualAnalyticsCandidate.name,
        uniqueCount: visualAnalyticsCandidate.uniqueCount,
      },
      action: (store) => {
        store.setVisualAnalyticsAttribute(visualAnalyticsCandidate.name);
      },
    });
  }

  // 6. Zeitreihen-Widget hervorheben (nur bei mehr als einem Zeitpunkt sinnvoll)
  if (timeAttributes.length > 0) {
    const timeAttr = timeAttributes[0];
    const timeValues = new Set(
      geoJson.features
        .map((f) => f.properties?.[timeAttr])
        .filter((v) => v !== null && v !== undefined && v !== "")
    );
    const distinctTimes = timeValues.size;

    if (distinctTimes >= 2) {
      suggestions.push({
        id: `temporal-focus-${sourceKey}`,
        layerId,
        type: "TEMPORAL_FOCUS",
        title: "Zeitreihenanalyse verfügbar",
        description: `Zeitattribut „${timeAttr}“ erkannt (${distinctTimes} Zeitpunkte${timeAttributes.length > 1 ? `, +${timeAttributes.length - 1} weitere` : ""}). Zeitreihen-Widget nach vorne holen?`,
        priority: 62,
        meta: { timeAttr, distinctTimes, allTimeAttrs: timeAttributes },
        action: (store) => {
          store.setTemporalConfig(timeAttr, null, "bar");
          const order = [...store.widgetOrder];
          const idx = order.indexOf("temporal");
          if (idx > 0) {
            order.splice(idx, 1);
            order.splice(1, 0, "temporal");
            store.setWidgetOrder(order);
          }
        },
      });
    }
  }

  // 7. Datenqualitäts-Hinweis bei mehreren lückenhaften Attributen
  const lowQualityAttrs = usableStats.filter((s) => s.nullPercentage > 30);
  if (lowQualityAttrs.length >= 3) {
    const worstAttr = [...lowQualityAttrs].sort(
      (a, b) => b.nullPercentage - a.nullPercentage
    )[0];
    suggestions.push({
      id: `data-quality-${sourceKey}`,
      layerId,
      type: "DATA_QUALITY",
      title: `Datenqualität: ${lowQualityAttrs.length} lückenhafte Attribute`,
      description: `„${worstAttr.name}“ hat ${Math.round(worstAttr.nullPercentage)}% fehlende Werte. Datenqualitätsbericht anzeigen?`,
      priority: 45,
      meta: { lowQualityCount: lowQualityAttrs.length, worstAttr: worstAttr.name, worstPct: worstAttr.nullPercentage },
      action: (store) => {
        const order = [...store.widgetOrder];
        const idx = order.indexOf("data_quality");
        if (idx > 1) {
          order.splice(idx, 1);
          order.splice(2, 0, "data_quality");
          store.setWidgetOrder(order);
        }
      },
    });
  }

  // 8. Große Datensätze: reine Darstellungsdichte (Heatmap-Vorschlag 1 deckt Performance bereits ab)
  if (featureCount >= 5000) {
    suggestions.push({
      id: `large-dataset-${sourceKey}`,
      layerId,
      type: "LARGE_DATASET",
      title: "Große Datenmenge – Darstellung entzerren",
      description: `${featureCount.toLocaleString("de-DE")} Features überlagern sich stark. Transparenz auf 70% reduzieren, damit dichte Bereiche lesbar bleiben.`,
      priority: 20,
      meta: { featureCount },
      action: (store, id) => {
        store.updateLayer(id, { opacity: 0.7 });
      },
    });
  }

  return suggestions.sort((a, b) => b.priority - a.priority).slice(0, 5);
}
