import type { FeatureCollection } from "geojson";
import { toFiniteNumber } from "@/lib/stats-utils";

// Wortweise vergleichen: Als Teilstring stecken "zeit" und "ende" auch in
// "oeffnungszeiten" oder "Legende".
const TIME_TOKENS = new Set([
  "datum", "date", "jahr", "year", "zeit", "time", "monat", "month",
  "created", "updated", "anfang", "ende", "timestamp", "zeitstempel", "zeitpunkt", "stichtag",
]);

/** Für zusammengeschriebene Namen wie "baujahr" oder "erfassungsdatum" */
const TIME_SUFFIXES = ["jahr", "datum", "date", "zeitpunkt"];

function isTimeAttributeName(key: string): boolean {
  return key
    .replace(/([a-zäöü0-9])([A-ZÄÖÜ])/g, "$1 $2") // camelCase trennen
    .toLowerCase()
    .split(/[^a-zäöüß0-9]+/)
    .some((token) => TIME_TOKENS.has(token) || TIME_SUFFIXES.some((suffix) => token.endsWith(suffix)));
}

export interface TimeSeriesDataPoint {
  timeLabel: string;
  count: number;
  sum: number;
}

export interface RawTimeSeriesDataPoint {
  timeLabel: string;
  value: number;
}

/**
 * ISO (JJJJ-MM[-TT…]) und deutsches Format (TT.MM.JJJJ), sonst null.
 * Date.parse kann das deutsche Format nicht: "31.12.2023" wird NaN und
 * "01.02.2023" der 2. Januar.
 */
export function parseDate(raw: string): Date | null {
  const text = raw.trim();

  const german = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (german) {
    const [day, month, year] = [Number(german[1]), Number(german[2]), Number(german[3])];
    const date = new Date(year, month - 1, day);
    // new Date(2023, 1, 31) landet ohne Fehler im März
    return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }

  if (!/^\d{4}[-/]\d{2}/.test(text)) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

// JJJJ-MM-TT in Ortszeit. toISOString() rechnet nach UTC um, dann rutscht
// 00:30 Uhr auf den Vortag.
function toLocalIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function detectTimeAttributes(geoJson: FeatureCollection): string[] {
  if (!geoJson.features || geoJson.features.length === 0) return [];

  // Je Attribut der erste nicht leere Wert (im ersten Feature kann er fehlen)
  const samples = new Map<string, unknown>();
  for (const feature of geoJson.features) {
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      const current = samples.get(key);
      if (current === undefined || current === null || current === "") samples.set(key, value);
    }
  }

  const timeAttrs: string[] = [];

  for (const [key, value] of samples) {
    if (isTimeAttributeName(key)) {
      timeAttrs.push(key);
      continue;
    }

    // Jahreszahl; aus CSVs kommt sie als String
    const numericValue = toFiniteNumber(value);
    if (numericValue !== null && numericValue >= 1900 && numericValue <= 2100 && Number.isInteger(numericValue)) {
      timeAttrs.push(key);
      continue;
    }

    if (typeof value === "string" && parseDate(value) !== null) {
      timeAttrs.push(key);
    }
  }

  return timeAttrs;
}

/** Anzahl je Zeitpunkt, mit valueAttr zusätzlich die Summe. */
export function aggregateTimeSeries(
  geoJson: FeatureCollection,
  timeAttr: string,
  valueAttr: string | null = null
): TimeSeriesDataPoint[] {
  const aggregated = new Map<string, { count: number; sum: number }>();

  for (const feature of geoJson.features) {
    if (!feature.properties) continue;

    const rawTime = feature.properties[timeAttr];
    if (rawTime === null || rawTime === undefined || rawTime === "") continue;

    let timeLabel = String(rawTime);
    if (typeof rawTime === "string") {
      const parsed = rawTime.length > 4 ? parseDate(rawTime) : null;
      if (parsed) {
        // Auf Jahre zusammenfassen
        timeLabel = String(parsed.getFullYear());
      }
    } else if (typeof rawTime === "number") {
      timeLabel = String(Math.floor(rawTime));
    }

    const current = aggregated.get(timeLabel) || { count: 0, sum: 0 };
    current.count += 1;

    if (valueAttr) {
      const val = toFiniteNumber(feature.properties[valueAttr]);
      if (val !== null) {
        current.sum += val;
      }
    }

    aggregated.set(timeLabel, current);
  }

  const sortedKeys = Array.from(aggregated.keys()).sort((a, b) => {
    const numA = Number(a);
    const numB = Number(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });

  return sortedKeys.map(key => ({
    timeLabel: key,
    count: aggregated.get(key)!.count,
    sum: aggregated.get(key)!.sum
  }));
}

/** Einzelwerte ohne Aggregation */
export function getRawTimeSeries(
  geoJson: FeatureCollection,
  timeAttr: string,
  valueAttr: string
): RawTimeSeriesDataPoint[] {
  const points: RawTimeSeriesDataPoint[] = [];

  for (const feature of geoJson.features) {
    if (!feature.properties) continue;
    const rawTime = feature.properties[timeAttr];
    if (rawTime === null || rawTime === undefined || rawTime === "") continue;

    let timeLabel = String(rawTime);

    if (typeof rawTime === "string") {
      const parsed = rawTime.length > 4 ? parseDate(rawTime) : null;
      if (parsed) {
        timeLabel = toLocalIsoDate(parsed); // sortiert sich als String richtig
      }
    }

    const val = toFiniteNumber(feature.properties[valueAttr]);
    if (val !== null) {
      points.push({ timeLabel, value: val });
    }
  }

  points.sort((a, b) => {
    const numA = Number(a.timeLabel);
    const numB = Number(b.timeLabel);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.timeLabel.localeCompare(b.timeLabel);
  });

  return points;
}
