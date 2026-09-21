import type { FeatureCollection } from "geojson";
import { toFiniteNumber } from "@/lib/stats-utils";

const TIME_ALIASES = ["datum", "date", "jahr", "year", "zeit", "time", "month", "monat", "created_at", "updated_at", "anfang", "ende"];

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
 * Parst ISO-Datumsangaben (JJJJ-MM[-TT…], auch mit "/") und das deutsche Format TT.MM.JJJJ,
 * sonst null. Date.parse allein reicht nicht: "31.12.2023" ergibt NaN, und
 * "01.02.2023" liest V8 als 2. Januar statt 1. Februar.
 */
export function parseDate(raw: string): Date | null {
  const text = raw.trim();

  const german = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (german) {
    const [day, month, year] = [Number(german[1]), Number(german[2]), Number(german[3])];
    const date = new Date(year, month - 1, day);
    // Unmögliche Daten ("31.02.") rollt Date still in den Folgemonat – verwerfen
    return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }

  if (!/^\d{4}[-/]\d{2}/.test(text)) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/**
 * JJJJ-MM-TT in Ortszeit. toISOString() rechnet in UTC um und verschiebt
 * Zeitpunkte kurz nach Mitternacht (z.B. "2023-05-01T00:30:00") auf den Vortag.
 */
function toLocalIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Erkennt heuristisch, welche Attribute Datums-/Zeitwerte sein könnten. */
export function detectTimeAttributes(geoJson: FeatureCollection): string[] {
  if (!geoJson.features || geoJson.features.length === 0) return [];

  const sampleProps = geoJson.features[0].properties;
  if (!sampleProps) return [];

  const timeAttrs: string[] = [];

  for (const [key, value] of Object.entries(sampleProps)) {
    const lowerKey = key.toLowerCase();

    if (TIME_ALIASES.some(alias => lowerKey.includes(alias))) {
      timeAttrs.push(key);
      continue;
    }

    // 4-stellige Jahreszahl zwischen 1900 und 2100 – toFiniteNumber statt
    // typeof-Prüfung, da CSV-Spalten (ohne dynamicTyping) auch als Zahl
    // lesbare Strings liefern, WFS-Dienste aber echte JSON-Zahlen
    const numericValue = toFiniteNumber(value);
    if (numericValue !== null && numericValue >= 1900 && numericValue <= 2100 && Number.isInteger(numericValue)) {
      timeAttrs.push(key);
      continue;
    }

    // parseDate erkennt nur ISO- und deutsche Datumsformate, zufällig als
    // Datum lesbare reine Zahlen fallen dadurch schon heraus
    if (typeof value === "string" && parseDate(value) !== null) {
      timeAttrs.push(key);
    }
  }

  return timeAttrs;
}

/** Aggregiert Features nach einem Zeitattribut; summiert valueAttr falls angegeben, sonst nur Anzahl. */
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
        // Auf Jahr verdichten für einfachere Trend-Diagramme
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

/** Liefert unaggregierte Einzelpunkte einer Zeitreihe (Original-Zeitwert bleibt erhalten). */
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
        timeLabel = toLocalIsoDate(parsed); // YYYY-MM-DD für saubere Sortierung
      }
    }

    // Features ohne Messwert überspringen statt als 0 zu zeichnen
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
