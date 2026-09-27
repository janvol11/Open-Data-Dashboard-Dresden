// Prüft den Workspace aus einem geteilten Link. Der kann von irgendwem stammen,
// also nichts ungeprüft übernehmen.

import type { MapLayer } from "@/store/useDashboardStore";

export interface SharedLayer {
  label: string;
  wfsUrl: string;
  typeName: string | null;
  visible: boolean;
  renderAsHeatmap: boolean;
  thematicStyling?: MapLayer["thematicStyling"];
  /** Wird beim Laden gegen LAYER_COLORS geprüft */
  color?: string;
  /** 0 bis 1 */
  opacity?: number;
}

export interface SharedWorkspace {
  layers: SharedLayer[];
  chartFilter: { attribute: string; value: string | number } | null;
  visualAnalyticsAttribute: string | null;
  correlationX: string | null;
  correlationY: string | null;
  temporalAttribute: string | null;
  temporalValueAttr: string | null;
  temporalChartType: "bar" | "line" | null;
}

const MAX_TEXT_LENGTH = 200;

/** Jeder Layer ist ein eigener WFS-Abruf */
const MAX_SHARED_LAYERS = 20;

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, MAX_TEXT_LENGTH) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseThematicStyling(raw: unknown): MapLayer["thematicStyling"] | undefined {
  if (!isRecord(raw)) return undefined;
  const attribute = asText(raw.attribute);
  const type = raw.type;
  const colors = raw.colors;
  const ranges = raw.ranges;

  if (!attribute || (type !== "numeric" && type !== "categorical")) return undefined;
  if (!Array.isArray(colors) || colors.length === 0) return undefined;
  if (!colors.every((c) => typeof c === "string" && HEX_COLOR.test(c))) return undefined;
  if (
    ranges !== undefined &&
    !(Array.isArray(ranges) && ranges.every((r) => typeof r === "number" && Number.isFinite(r)))
  ) {
    return undefined;
  }

  return { attribute, type, colors: colors as string[], ...(ranges !== undefined && { ranges: ranges as number[] }) };
}

/** Nur http(s). Lokale CSVs und Joins lassen sich nicht neu laden. */
function parseSharedLayer(raw: unknown): SharedLayer | null {
  if (!isRecord(raw) || typeof raw.wfsUrl !== "string") return null;

  let url: URL;
  try {
    url = new URL(raw.wfsUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  return {
    wfsUrl: raw.wfsUrl,
    label: asText(raw.label) ?? url.hostname,
    typeName: asText(raw.typeName),
    visible: raw.visible !== false,
    renderAsHeatmap: raw.renderAsHeatmap === true,
    thematicStyling: parseThematicStyling(raw.thematicStyling),
    color: asText(raw.color) ?? undefined,
    opacity:
      typeof raw.opacity === "number" && Number.isFinite(raw.opacity)
        ? Math.min(Math.max(raw.opacity, 0), 1)
        : undefined,
  };
}

/** Unbrauchbare Teile werden weggelassen, der Rest geladen. */
export function parseSharedWorkspace(raw: unknown): SharedWorkspace | null {
  if (!isRecord(raw)) return null;

  const filter = raw.chartFilter;
  const filterAttribute = isRecord(filter) ? asText(filter.attribute) : null;
  const filterValue = isRecord(filter) ? filter.value : undefined;
  const chartFilter =
    filterAttribute !== null &&
    (typeof filterValue === "string" || (typeof filterValue === "number" && Number.isFinite(filterValue)))
      ? { attribute: filterAttribute, value: filterValue }
      : null;

  const layers = Array.isArray(raw.layers)
    ? raw.layers
        .slice(0, MAX_SHARED_LAYERS)
        .map(parseSharedLayer)
        .filter((l): l is SharedLayer => l !== null)
    : [];

  return {
    layers,
    chartFilter,
    visualAnalyticsAttribute: asText(raw.visualAnalyticsAttribute),
    correlationX: asText(raw.correlationX),
    correlationY: asText(raw.correlationY),
    temporalAttribute: asText(raw.temporalAttribute),
    temporalValueAttr: asText(raw.temporalValueAttr),
    temporalChartType:
      raw.temporalChartType === "bar" || raw.temporalChartType === "line" ? raw.temporalChartType : null,
  };
}
