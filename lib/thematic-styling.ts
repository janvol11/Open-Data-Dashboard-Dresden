import type { FeatureCollection } from "geojson";
import type { MapLayer } from "@/store/useDashboardStore";
import { collectNumericValues, computeQuantileBreaks } from "@/lib/stats-utils";
import { buildSequentialRamp } from "@/lib/color-utils";
import { CATEGORICAL_COLORS } from "@/lib/palettes";

const MAX_NUMERIC_CLASSES = 5;

/**
 * Zahlen bekommen eine Farbrampe in der Layer-Farbe, alles andere die
 * Kategorie-Palette. Ergeben sich weniger als zwei Klassen (etwa nur ein
 * Wert), wird ebenfalls kategorisch eingefärbt.
 */
export function buildThematicStyling(
  geoJson: FeatureCollection | null,
  attribute: string,
  baseColor: string
): NonNullable<MapLayer["thematicStyling"]> {
  const numericValues = collectNumericValues(geoJson, attribute);
  const breaks =
    numericValues.length > 0 ? computeQuantileBreaks(numericValues, MAX_NUMERIC_CLASSES) : [];

  if (breaks.length >= 2) {
    return {
      attribute,
      type: "numeric",
      colors: buildSequentialRamp(baseColor, breaks.length),
      ranges: breaks,
    };
  }

  return {
    attribute,
    type: "categorical",
    colors: CATEGORICAL_COLORS,
  };
}

/**
 * Farbindex je Kategorie nach alphabetischer Reihenfolge. Berechnet auf dem
 * ganzen Datensatz, damit sich die Farben beim Filtern nicht verschieben.
 */
export function buildCategoryColorIndex(layer: MapLayer): Map<string, number> | null {
  const attribute = layer.thematicStyling?.attribute;
  if (!layer.geoJson || !attribute || layer.thematicStyling?.type !== "categorical") {
    return null;
  }

  const categories = new Set<string>();
  for (const feature of layer.geoJson.features) {
    const value = feature.properties?.[attribute];
    if (value === undefined || value === null || value === "") continue;
    categories.add(String(value));
  }

  const index = new Map<string, number>();
  Array.from(categories)
    .sort((a, b) => a.localeCompare(b, "de"))
    .forEach((name, i) => index.set(name, i));
  return index;
}
