// Regelbasierte Vorschläge zur Darstellung eines frisch geladenen Datensatzes
// (Heatmap, Einfärbung, passende Diagramme). Jeder Vorschlag bringt seine
// eigene action mit, die den Store ändert.

import type { FeatureCollection } from "geojson";
import {
  calculateFeatureStats,
  collectNumericValues,
  toFiniteNumber,
  type AttributeStats,
} from "@/lib/stats-utils";
import { detectTimeAttributes } from "@/lib/time-utils";
import { CATEGORICAL_COLORS } from "@/lib/palettes";
import { buildThematicStyling } from "@/lib/thematic-styling";
import type { DashboardState } from "@/store/useDashboardStore";

export type SuggestionType =
  | "HEATMAP"
  | "THEMATIC_NUMERIC"
  | "THEMATIC_CATEGORICAL"
  | "TEMPORAL_FOCUS"
  | "CORRELATION"
  | "VISUAL_ANALYTICS"
  | "LARGE_DATASET"
  | "DATA_QUALITY";

// Vorschläge dieser Gruppe ändern alle das Aussehen des Layers. "Alle anwenden"
// nimmt davon je Layer nur den mit der höchsten Priorität.
export const CONFLICT_GROUP_APPEARANCE = "layer-appearance";

export interface Suggestion {
  id: string;
  layerId: string;
  type: SuggestionType;
  title: string;
  description: string;
  /** Höher = weiter oben */
  priority: number;
  conflictGroup?: string;
  /** Zusatzinfos für die Karte im Panel (Werte, Farben) */
  meta?: Record<string, unknown>;
  action: (store: DashboardState, layerId: string) => void;
}


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

// Schlüsselspalten. Verglichen wird wortweise, "id" soll nicht in "valide" treffen.
const ID_TOKENS = new Set([
  "id", "ids", "gid", "fid", "oid", "objectid", "globalid", "uuid", "guid",
  "pk", "key", "schluessel", "schlüssel", "kennzeichen", "nummer", "nr",
  // Postleitzahlen kommen oft als Zahl an (01067 → 1067), sind aber Codes
  "plz", "postleitzahl", "zip", "zipcode", "postcode",
]);

/** Für zusammengeschriebene Namen wie "objektnr" */
const ID_SUFFIXES = ["nr", "nummer"];

// Koordinatenspalten sind zwar Zahlen, taugen aber nicht zum Einfärben
const COORDINATE_TOKENS = new Set([
  "x", "y", "lat", "latitude", "lon", "lng", "longitude",
  "utm", "easting", "northing", "rechtswert", "hochwert",
  "koordinate", "koordinaten", "coord", "coords", "srid", "epsg",
]);


/** "standort_nr" → ["standort", "nr"], "objectId" → ["object", "id"] */
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

const DATE_VALUE_PATTERN =
  /^\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}\/\d{1,2}\/\d{4})([ T]\d{1,2}:\d{2}(:\d{2})?)?/;

// Zeitstempel an den Werten erkennen. Ein Feld wie "aend_dat" mit wenigen
// Bearbeitungsständen hat nur ein paar Ausprägungen, ist aber keine Kategorie.
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

// Schlüssel und Koordinaten ausschließen. Laufende Nummern ohne passenden
// Namen fallen über "lauter eindeutige Ganzzahlen" heraus.
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

/** Standardabweichung / |Mittelwert|, damit Attribute mit verschiedenen Einheiten vergleichbar sind */
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

/** Pearson-r auf den ersten 500 Features */
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
    // Nur Features, bei denen beide Werte da sind
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

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "–";
  if (Number.isInteger(value)) return value.toLocaleString("de-DE");
  return value.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

/**
 * Höchstens 5 Vorschläge, nach Priorität sortiert.
 *
 * sourceKey (z.B. URL + Layername) bildet die IDs. Die layerId enthält einen
 * Zeitstempel und würde verworfene Vorschläge beim nächsten Laden zurückbringen.
 * baseColor ist die Layer-Farbe für die numerische Farbrampe.
 */
export function analyzeDatasetForSuggestions(
  geoJson: FeatureCollection,
  layerId: string,
  sourceKey: string,
  baseColor: string
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const featureCount = geoJson.features.length;

  if (featureCount === 0) return [];

  const stats = calculateFeatureStats(geoJson);
  const geomType = dominantGeometryType(geoJson);

  // detectTimeAttributes hält jede Zahl zwischen 1900 und 2100 für ein Jahr,
  // auch laufende Nummern
  const timeAttributes = detectTimeAttributes(geoJson).filter(
    (attr) => !hasIdMarker(attr) && !hasToken(attr, COORDINATE_TOKENS)
  );

  const usableStats = stats.filter((s) => !isUnusableForVisualization(s, geoJson));

  // Heatmap bei vielen Punkten
  if (geomType === "Point" && featureCount >= 200) {
    suggestions.push({
      id: `heatmap-${sourceKey}`,
      layerId,
      type: "HEATMAP",
      title: "Heatmap aktivieren",
      description: `${featureCount.toLocaleString("de-DE")} Punkte. Als Heatmap sieht man besser, wo sie sich häufen.`,
      priority: 100,
      conflictGroup: CONFLICT_GROUP_APPEARANCE,
      meta: { featureCount, geomType },
      action: (store, id) => {
        store.updateLayer(id, { renderAsHeatmap: true });
      },
    });
  }

  // Einfärbung nach Zahlenwert
  const numericCandidates = usableStats.filter(
    (s) =>
      s.type === "number" &&
      s.nullPercentage < 40 &&
      s.uniqueCount > 5 &&
      s.min !== undefined &&
      s.max !== undefined &&
      s.min !== s.max
  );

  // Punkte für sprechenden Namen und für Streuung
  const rankedNumeric = numericCandidates
    .map((s) => {
      const values = collectNumericValues(geoJson, s.name);
      const keywordScore = nameContainsKeyword(s.name, NUMERIC_VALUE_KEYWORDS) ? 2 : 0;
      const spreadScore = Math.min(coefficientOfVariation(values), 3); // gegen Ausreißer gedeckelt
      return { stat: s, score: keywordScore + spreadScore };
    })
    .sort((a, b) => b.score - a.score);

  const bestNumeric = rankedNumeric[0];

  if (bestNumeric) {
    const { stat } = bestNumeric;
    const fillRate = Math.round(100 - stat.nullPercentage);
    const styling = buildThematicStyling(geoJson, stat.name, baseColor);
    const breaks = styling.ranges ?? [];

    if (styling.type === "numeric" && breaks.length >= 2) {
      suggestions.push({
        id: `thematic-numeric-${sourceKey}-${stat.name}`,
        layerId,
        type: "THEMATIC_NUMERIC",
        title: `Nach „${stat.name}“ einfärben`,
        description: `${breaks.length} Klassen von ${formatValue(stat.min ?? 0)} bis ${formatValue(stat.max ?? 0)}, ${fillRate} % der Einträge haben einen Wert.`,
        priority: 85,
        conflictGroup: CONFLICT_GROUP_APPEARANCE,
        meta: {
          attribute: stat.name,
          fillRate,
          min: stat.min,
          max: stat.max,
          palette: styling.colors,
          breaks,
        },
        action: (store, id) => {
          store.updateLayer(id, {
            renderAsHeatmap: false, // Heatmap würde die Farben verdecken
            thematicStyling: styling,
          });
        },
      });
    }
  }

  // Einfärbung nach Kategorie
  const categoricalCandidates = usableStats.filter(
    (s) =>
      (s.type === "string" || s.type === "boolean") &&
      s.nullPercentage < 50 &&
      s.uniqueCount >= 2 &&
      s.uniqueCount <= 12 &&
      !looksTemporal(geoJson, s.name)
  );

  const bestCategorical = [...categoricalCandidates].sort((a, b) => {
    const aKeyword = nameContainsKeyword(a.name, CATEGORICAL_KEYWORDS) ? 2 : 0;
    const bKeyword = nameContainsKeyword(b.name, CATEGORICAL_KEYWORDS) ? 2 : 0;
    const aCountScore = a.uniqueCount <= 6 ? 1 : 0; // kurze Legende bevorzugen
    const bCountScore = b.uniqueCount <= 6 ? 1 : 0;
    return (bKeyword + bCountScore) - (aKeyword + aCountScore);
  })[0];

  if (bestCategorical) {
    const fillRate = Math.round(100 - bestCategorical.nullPercentage);
    const previewColors = CATEGORICAL_COLORS.slice(0, bestCategorical.uniqueCount);
    const topCategories = bestCategorical.frequencies
      ?.slice(0, 3)
      .map((f) => `„${f.name}“`)
      .join(", ");
    suggestions.push({
      id: `thematic-categorical-${sourceKey}-${bestCategorical.name}`,
      layerId,
      type: "THEMATIC_CATEGORICAL",
      title: `Nach „${bestCategorical.name}“ einfärben`,
      description: `${bestCategorical.uniqueCount} Kategorien${topCategories ? `, z. B. ${topCategories}` : ""}. ${fillRate} % der Einträge sind ausgefüllt.`,
      priority: 72,
      conflictGroup: CONFLICT_GROUP_APPEARANCE,
      meta: {
        attribute: bestCategorical.name,
        categories: bestCategorical.uniqueCount,
        topCategories: bestCategorical.frequencies?.slice(0, 5),
        palette: previewColors,
      },
      action: (store, id) => {
        store.updateLayer(id, {
          renderAsHeatmap: false,
          thematicStyling: {
            attribute: bestCategorical.name,
            type: "categorical",
            colors: CATEGORICAL_COLORS,
          },
        });
      },
    });
  }

  // Korrelation, ab |r| > 0.55
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
      const strength = Math.abs(r) > 0.8 ? "Starke" : "Mittlere";
      const direction = r > 0 ? "positive" : "negative";
      suggestions.push({
        id: `correlation-${sourceKey}-${attrA}-${attrB}`,
        layerId,
        type: "CORRELATION",
        title: `Zusammenhang gefunden (r = ${r.toLocaleString("de-DE", { maximumFractionDigits: 2 })})`,
        description: `${strength} ${direction} Korrelation zwischen „${attrA}“ und „${attrB}“. Im Streudiagramm ansehen?`,
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

  // Balkendiagramm für ein gut passendes Kategorie-Attribut
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
      title: `Verteilung von „${visualAnalyticsCandidate.name}“`,
      description: `${visualAnalyticsCandidate.uniqueCount} verschiedene Werte. Als Diagramm anzeigen?`,
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

  // Zeitreihe, sobald es mindestens zwei Zeitpunkte gibt
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
        title: "Zeitreihe möglich",
        description: `„${timeAttr}“ enthält ${distinctTimes} Zeitpunkte${timeAttributes.length > 1 ? ` (dazu ${timeAttributes.length - 1} weitere Zeitspalten)` : ""}. Zeitreihe nach oben holen?`,
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

  // Hinweis auf Lücken ab drei lückenhaften Attributen
  const lowQualityAttrs = usableStats.filter((s) => s.nullPercentage > 30);
  if (lowQualityAttrs.length >= 3) {
    const worstAttr = [...lowQualityAttrs].sort(
      (a, b) => b.nullPercentage - a.nullPercentage
    )[0];
    suggestions.push({
      id: `data-quality-${sourceKey}`,
      layerId,
      type: "DATA_QUALITY",
      title: `${lowQualityAttrs.length} lückenhafte Attribute`,
      description: `Bei „${worstAttr.name}“ fehlen ${Math.round(worstAttr.nullPercentage)} % der Werte. Qualitätsreport nach oben holen?`,
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

  // Sehr viele Features (betrifft nur CSV, WFS ist auf 1.000 begrenzt)
  if (featureCount >= 5000) {
    suggestions.push({
      id: `large-dataset-${sourceKey}`,
      layerId,
      type: "LARGE_DATASET",
      title: "Sehr viele Objekte",
      description: `${featureCount.toLocaleString("de-DE")} Objekte überlagern sich. Mit 50 % Deckkraft bleiben dichte Bereiche lesbar.`,
      priority: 20,
      meta: { featureCount },
      action: (store, id) => {
        store.updateLayer(id, { opacity: 0.5 });
      },
    });
  }

  return suggestions.sort((a, b) => b.priority - a.priority).slice(0, 5);
}
