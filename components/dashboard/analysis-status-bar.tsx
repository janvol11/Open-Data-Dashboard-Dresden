"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertTriangle, Filter, X } from "lucide-react";
import { useDashboardStore } from "@/store/useDashboardStore";
import { getMatchedFeatureCount, WFS_FEATURE_LIMIT } from "@/lib/wfs-service";

/**
 * Zeigt über den Widgets, worauf sich die Auswertungen gerade beziehen: ob der
 * primäre Datensatz nur als gekappter Ausschnitt geladen ist und ob ein
 * Diagrammfilter aktiv ist. Beides wirkt auf alle Widgets, ein kurzer Toast
 * beim Laden bzw. der Chip in der Attribut-Verteilung allein reichen nicht.
 */
export function AnalysisStatusBar() {
  const { primaryLayer, chartFilter, setChartFilter } = useDashboardStore(
    useShallow((s) => ({
      primaryLayer: s.layers.find((l) => l.id === s.primaryLayerId) ?? null,
      chartFilter: s.chartFilter,
      setChartFilter: s.setChartFilter,
    }))
  );

  // Je Layer merken, damit der Hinweis bei einem weiteren gekappten Datensatz
  // wieder erscheint; nach einem Neuladen der Seite ist er ebenfalls zurück
  const [dismissedLayerIds, setDismissedLayerIds] = useState<string[]>([]);

  const sample =
    primaryLayer && !dismissedLayerIds.includes(primaryLayer.id) ? getSampleInfo(primaryLayer) : null;
  if (!sample && !chartFilter) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pt-4 -mb-2">
      {sample && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <span>
            <strong className="font-semibold">Nur ein Ausschnitt:</strong> Karte und Auswertungen zeigen{" "}
            {sample.total !== null
              ? `${sample.loaded.toLocaleString("de-DE")} von ${sample.total.toLocaleString("de-DE")} Objekten`
              : `nur die ersten ${sample.loaded.toLocaleString("de-DE")} Objekte`}{" "}
            aus „{sample.label}“. Der Dienst liefert pro Abruf höchstens {WFS_FEATURE_LIMIT} Objekte.
          </span>
          <button
            type="button"
            onClick={() => primaryLayer && setDismissedLayerIds((ids) => [...ids, primaryLayer.id])}
            aria-label="Hinweis schließen"
            title="Hinweis schließen"
            className="-mr-1 shrink-0 rounded p-0.5 text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {chartFilter && (
        <button
          type="button"
          onClick={() => setChartFilter(null)}
          title="Filter aufheben"
          className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
        >
          <Filter className="h-3.5 w-3.5" />
          Gefiltert: {chartFilter.attribute} = {String(chartFilter.value)}
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function getSampleInfo(
  layer: ReturnType<typeof useDashboardStore.getState>["layers"][number] | null
): { loaded: number; total: number | null; label: string } | null {
  // Eigene CSV-Importe und Joins sind vollständig, nur WFS-Abrufe werden gekappt
  if (!layer?.geoJson || layer.wfsUrl.startsWith("local-")) return null;

  const loaded = layer.geoJson.features.length;
  const total = getMatchedFeatureCount(layer.geoJson);
  const truncated = total !== null ? total > loaded : loaded >= WFS_FEATURE_LIMIT;
  return truncated ? { loaded, total, label: layer.label } : null;
}
