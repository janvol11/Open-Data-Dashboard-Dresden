"use client";

import type { MapLayer } from "@/store/useDashboardStore";
import { buildCategoryColorIndex } from "@/lib/thematic-styling";

/** Mehr Kategorien würden die Legende sprengen; Rest wird gezählt statt aufgelistet. */
const MAX_CATEGORY_ROWS = 8;

/** Ganze Zahlen ohne Nachkommastelle, sonst eine – passend für Prozent- und Zählwerte gleichermaßen. */
function formatBreak(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString("de-DE")
    : value.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function NumericLegend({ layer }: { layer: MapLayer }) {
  const { ranges, colors } = layer.thematicStyling!;
  if (!ranges) return null;

  return (
    <div className="space-y-1">
      {colors.slice(0, ranges.length).map((color, i) => {
        const upper = ranges[i];
        const lower = i === 0 ? null : ranges[i - 1];
        const label =
          lower === null
            ? `≤ ${formatBreak(upper)}`
            : i === ranges.length - 1
            ? `> ${formatBreak(lower)}`
            : `${formatBreak(lower)} – ${formatBreak(upper)}`;

        return (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
            <span className="text-muted-foreground tabular-nums">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function CategoricalLegend({ layer }: { layer: MapLayer }) {
  const index = buildCategoryColorIndex(layer);
  if (!index) return null;

  const { colors } = layer.thematicStyling!;
  const entries = Array.from(index.entries()).sort((a, b) => a[1] - b[1]);
  const visible = entries.slice(0, MAX_CATEGORY_ROWS);
  const rest = entries.length - visible.length;

  return (
    <div className="space-y-1">
      {visible.map(([name, i]) => (
        <div key={name} className="flex items-center gap-1.5 text-[10px]">
          <span
            className="h-2.5 w-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: colors[i % colors.length] }}
          />
          <span className="text-muted-foreground truncate" title={name}>{name}</span>
        </div>
      ))}
      {rest > 0 && <p className="text-[9px] text-muted-foreground/70 pl-4">+{rest} weitere</p>}
    </div>
  );
}

/**
 * Legende für alle Layer mit aktivem Thematic Mapping. Eine aktive Heatmap
 * überdeckt die Einfärbung auf der Karte (siehe leaflet-map.tsx) – ein Layer
 * mit beidem gesetzt bekommt deshalb konsequent auch keine Legende.
 */
export function MapLegend({ layers }: { layers: MapLayer[] }) {
  const active = layers.filter((l) => l.visible && l.thematicStyling && !l.renderAsHeatmap);
  if (active.length === 0) return null;

  return (
    <div className="absolute left-3 bottom-3 z-1000 flex flex-col gap-2 max-h-[45vh] overflow-y-auto pointer-events-none">
      {active.map((layer) => (
        <div
          key={layer.id}
          className="pointer-events-auto bg-background/90 backdrop-blur-sm rounded-lg border shadow-sm px-2.5 py-2 max-w-[190px]"
          style={{ borderLeftColor: layer.color, borderLeftWidth: 2 }}
        >
          <p className="text-[10px] font-medium truncate mb-1" title={layer.label}>
            {layer.label}
          </p>
          <p className="text-[9px] text-muted-foreground font-mono truncate mb-1.5">
            {layer.thematicStyling!.attribute}
          </p>
          {layer.thematicStyling!.type === "numeric" ? (
            <NumericLegend layer={layer} />
          ) : (
            <CategoricalLegend layer={layer} />
          )}
        </div>
      ))}
    </div>
  );
}
