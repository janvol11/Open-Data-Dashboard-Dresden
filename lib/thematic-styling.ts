import type { FeatureCollection } from "geojson";
import type { MapLayer } from "@/store/useDashboardStore";
import { collectNumericValues, computeQuantileBreaks } from "@/lib/stats-utils";
import { buildSequentialRamp } from "@/lib/color-utils";

/** Sichtbar unterscheidbare Farben für kategoriale Werte (Reihenfolge = Zuordnung, keine Rangfolge). */
export const CATEGORICAL_PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

const MAX_NUMERIC_CLASSES = 5;

/**
 * Baut die Thematic-Mapping-Konfiguration für ein Attribut: numerische
 * Klassen bekommen eine sequenzielle Rampe in der Layer-Farbe (echte
 * Rangfolge), alles andere die feste kategoriale Palette.
 *
 * Fällt auf "categorical" zurück, wenn sich für ein numerisches Attribut
 * keine mindestens zweistufige Klassierung bilden lässt (z.B. nur ein
 * einziger Wert im gesamten Datensatz) – die Karte ignoriert numerisches
 * Styling ohne `ranges` ohnehin.
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
    colors: CATEGORICAL_PALETTE,
  };
}

/**
 * Kategorie → Farbindex über die Position in der alphabetisch sortierten
 * Kategorieliste (nicht per Hash: das würde Kategorien oft auf dieselbe
 * Farbe verteilen statt sie gleichmäßig auf die Palette zu verteilen).
 *
 * Basis ist bewusst der vollständige Datensatz, nicht die gefilterte Ansicht –
 * sonst würden sich die Farben beim Setzen eines Chart-Filters verschieben.
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
