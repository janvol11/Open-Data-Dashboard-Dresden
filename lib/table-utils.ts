import type { FeatureCollection } from "geojson";
import { determineDataType, type DataType } from "@/lib/stats-utils";

export interface TableColumn {
  name: string;
  type: DataType;
  /** Sieht aus wie eine Zahl, ist aber ein Code (z.B. "01" mit führender Null) */
  isCode: boolean;
}

/** "01" → true (wird als Zahl zu "1"), "42" → false */
function looksLikeCode(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return false;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return false;
  return String(num) !== trimmed;
}

/** Spalten aus allen Zeilen, nicht nur der ersten (manchen fehlen Felder). */
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
