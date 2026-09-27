import { FeatureCollection } from "geojson";

export type DataType = "string" | "number" | "boolean" | "unknown";

/** Zahl oder null. Anders als Number() wird aus null oder "" keine 0. */
export function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

export interface AttributeStats {
  name: string;
  type: DataType;
  count: number;
  nullCount: number;
  nullPercentage: number;
  uniqueCount: number;

  min?: number;
  max?: number;
  avg?: number;

  frequencies?: Array<{ name: string; value: number; percentage: number }>;
}

// "number" nur, wenn wirklich jeder Wert eine Zahl ist. Oft steht z.B.
// "unbekannt" zwischen lauter Baujahren.
export function determineDataType(values: unknown[]): DataType {
  const nonNullValues = values.filter(v => v !== null && v !== undefined && v !== "");
  if (nonNullValues.length === 0) return "unknown";

  if (nonNullValues.every(v => typeof v === "boolean")) return "boolean";
  if (nonNullValues.every(v => toFiniteNumber(v) !== null)) return "number";

  return "string";
}

export function calculateFeatureStats(geoJson: FeatureCollection | null): AttributeStats[] {
  if (!geoJson || !geoJson.features || geoJson.features.length === 0) return [];

  const features = geoJson.features;
  const totalFeatures = features.length;

  const allAttributes = new Set<string>();
  features.forEach(f => {
    if (f.properties) {
      Object.keys(f.properties).forEach(k => allAttributes.add(k));
    }
  });

  const stats: AttributeStats[] = [];

  allAttributes.forEach(attr => {
    const rawValues = features.map(f => f.properties ? f.properties[attr] : null);

    let nullCount = 0;
    const validValues: unknown[] = [];

    rawValues.forEach(v => {
      if (v === null || v === undefined || v === "") {
        nullCount++;
      } else {
        validValues.push(v);
      }
    });

    const nullPercentage = (nullCount / totalFeatures) * 100;
    const type = determineDataType(validValues);
    const uniqueValues = new Set(validValues);

    const attrStat: AttributeStats = {
      name: attr,
      type,
      count: totalFeatures,
      nullCount,
      nullPercentage,
      uniqueCount: uniqueValues.size,
    };

    if (validValues.length > 0) {
      if (type === "number") {
        const numValues = validValues
          .map(v => toFiniteNumber(v))
          .filter((v): v is number => v !== null);

        if (numValues.length > 0) {
          // Kein Math.min(...values), das wirft bei ~100.000 Werten einen RangeError
          let min = Infinity, max = -Infinity, sum = 0;
          for (const v of numValues) {
            if (v < min) min = v;
            if (v > max) max = v;
            sum += v;
          }
          attrStat.min = min;
          attrStat.max = max;
          attrStat.avg = sum / numValues.length;
        }

        // Zahlen mit wenigen Ausprägungen auch als Häufigkeiten
        if (uniqueValues.size <= 20) {
          attrStat.frequencies = computeFrequencies(validValues);
        }
      } else if (type === "string" || type === "boolean") {
        attrStat.frequencies = computeFrequencies(validValues).slice(0, 20);
      }
    }

    stats.push(attrStat);
  });

  return stats.sort((a, b) => a.name.localeCompare(b.name));
}

// Als String vergleichen, weil computeFrequencies auch über String(v) gruppiert
// (2024 soll zu "2024" passen)
export function matchesCategoryValue(
  raw: unknown,
  value: string | number
): boolean {
  if (raw === null || raw === undefined) return false;
  return String(raw) === String(value);
}

function computeFrequencies(values: unknown[]) {
  const counts: Record<string, number> = {};
  values.forEach(v => {
    const key = String(v);
    counts[key] = (counts[key] || 0) + 1;
  });

  const total = values.length;
  return Object.entries(counts)
    .map(([name, value]) => ({
      name,
      value,
      percentage: (value / total) * 100
    }))
    .sort((a, b) => b.value - a.value);
}

export function collectNumericValues(
  geoJson: FeatureCollection | null,
  attribute: string
): number[] {
  if (!geoJson?.features) return [];

  const values: number[] = [];
  for (const feature of geoJson.features) {
    const num = toFiniteNumber(feature.properties?.[attribute]);
    if (num !== null) values.push(num);
  }
  return values;
}

/** Obere Grenzen der Quantilklassen. Doppelte Grenzen fallen weg (keine leeren Klassen). */
export function computeQuantileBreaks(values: number[], numClasses: number): number[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0 || numClasses < 1) return [];

  const breaks: number[] = [];
  for (let i = 1; i <= numClasses; i++) {
    const idx = Math.min(
      Math.max(Math.ceil((i / numClasses) * sorted.length) - 1, 0),
      sorted.length - 1
    );
    const value = sorted[idx];
    if (breaks.length === 0 || value > breaks[breaks.length - 1]) breaks.push(value);
  }

  const max = sorted[sorted.length - 1];
  if (breaks[breaks.length - 1] < max) breaks.push(max);

  return breaks;
}

export function getOverallDataHealth(stats: AttributeStats[]): number {
  if (stats.length === 0) return 0;
  const completeness = stats.reduce((acc, stat) => acc + (100 - stat.nullPercentage), 0) / stats.length;
  return completeness;
}
