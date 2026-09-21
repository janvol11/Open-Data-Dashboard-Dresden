import type { FeatureCollection } from "geojson";
import { determineDataType, type DataType } from "@/lib/stats-utils";

export interface TableColumn {
  name: string;
  /** Wie stats-utils es einordnen würde ("number" für jede numerisch lesbare Spalte). */
  type: DataType;
  /**
   * Numerisch lesbar, aber mindestens ein Wert übersteht keinen Zahl→Text-
   * Rücktransport unverändert (z.B. führende Nullen wie "01", vgl. den
   * `blocknr`-Code der Stadtteil-Geometrie). Solche Spalten sind Codes, keine
   * Mengen – als Join-Schlüssel dürfen sie nicht in echte Zahlen zerfallen.
   */
  isCode: boolean;
}

/** "01" übersteht den Rücktransport nicht (Number("01") → "1" ≠ "01"), "42" schon. */
function looksLikeCode(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return false;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return false;
  return String(num) !== trimmed;
}

/**
 * Leitet Spaltennamen und -typen aus den Properties aller Features ab (die
 * Vereinigung, nicht nur das erste Feature – einzelne Zeilen können Spalten
 * auslassen).
 */
export function inferTableColumns(geoJson: FeatureCollection): TableColumn[] {
  const names = new Set<string>();
  for (const feature of geoJson.features) {
    if (!feature.properties) continue;
    for (const key of Object.keys(feature.properties)) names.add(key);
  }

  return Array.from(names)
    .sort((a, b) => a.localeCompare(b, "de"))
    .map((name) => {
      const values = geoJson.features.map((f) => f.properties?.[name] ?? null);
      const type = determineDataType(values);
      const isCode =
        type === "number" && values.some((v) => typeof v === "string" && looksLikeCode(v));

      return { name, type, isCode };
    });
}
