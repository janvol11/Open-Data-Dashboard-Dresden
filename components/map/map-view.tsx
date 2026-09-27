"use client";

import { useCallback } from "react";
import { useDashboardStore } from "@/store/useDashboardStore";
import {
  fetchWfsCapabilities,
  fetchWfsFeatures,
  getMatchedFeatureCount,
  WFS_FEATURE_LIMIT,
} from "@/lib/wfs-service";
import { analyzeDatasetForSuggestions } from "@/lib/dataset-suggestions";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

// Leaflet braucht window, also kein SSR
const DynamicLeafletMap = dynamic(() => import("./leaflet-map"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex flex-col items-center justify-center bg-muted/10 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
      <p className="text-sm font-medium">Karte wird geladen...</p>
    </div>
  ),
});

/**
 * Lädt einen WFS als neuen Layer und gibt dessen ID zurück (bei Fehler undefined).
 * Ohne preferredTypeName wird der erste Layer aus den Capabilities genommen.
 */
export function useLoadWfsLayer() {
  const addLayer = useDashboardStore((s) => s.addLayer);
  const updateLayer = useDashboardStore((s) => s.updateLayer);

  const loadLayer = useCallback(
    async (wfsUrl: string, givenLabel?: string, preferredTypeName?: string): Promise<string | undefined> => {
      // Ohne Namen erst den Host zeigen, später den Titel aus den Capabilities
      let label = givenLabel ?? new URL(wfsUrl).hostname;
      // getState() statt Closure: Ein Doppelklick soll nicht zweimal laden
      const existing = useDashboardStore.getState().layers.find((l) => l.wfsUrl === wfsUrl);
      if (existing) {
        toast.info("Layer bereits geladen", {
          description: `"${existing.label}" ist bereits auf der Karte.`,
        });
        return undefined;
      }

      const layerId = addLayer({
        label,
        wfsUrl,
        typeName: null,
        geoJson: null,
        visible: true,
        isLoading: true,
      });

      try {
        const { layerNames, layerTitles, serviceTitle } = await fetchWfsCapabilities(wfsUrl);

        if (preferredTypeName && !layerNames.includes(preferredTypeName)) {
          console.warn(
            `[WFS] Layer "${preferredTypeName}" für "${label}" nicht in den Capabilities; ` +
              `verfügbar: ${layerNames.join(", ") || "keine"}`
          );
        }

        const typeName =
          (preferredTypeName && layerNames.includes(preferredTypeName)
            ? preferredTypeName
            : layerNames[0]) ?? null;

        if (!typeName) {
          toast.warning("Keine Layer gefunden", {
            description: `WFS Capabilities für "${label}" enthielten keine Layer.`,
          });
          updateLayer(layerId, { isLoading: false, typeName: null });
          return undefined;
        }

        if (!givenLabel) {
          label = layerTitles[typeName] || serviceTitle || label;
        }
        updateLayer(layerId, { typeName, label });
        toast.info(`Lade „${label}“ …`, { id: `loading-${layerId}` });

        const geoJson = await fetchWfsFeatures(wfsUrl, typeName);

        updateLayer(layerId, { geoJson, isLoading: false });

        const count = geoJson.features?.length ?? 0;
        if (count === 0) {
          toast.warning("Datensatz geladen, aber keine Features gefunden.", {
            id: `loading-${layerId}`,
          });
        } else {
          // Deutlich sagen, wenn nur ein Ausschnitt geladen wurde
          const matched = getMatchedFeatureCount(geoJson);
          if (matched !== null ? matched > count : count >= WFS_FEATURE_LIMIT) {
            toast.warning(
              matched !== null
                ? `Nur ${count} von ${matched.toLocaleString("de-DE")} Features geladen.`
                : `Nur die ersten ${count} Features geladen.`,
              {
                id: `loading-${layerId}`,
                description: "Mehr ruft das Dashboard pro Datensatz nicht ab. Karte und Auswertungen zeigen nur diesen Ausschnitt.",
              }
            );
          } else {
            toast.success(`${count} Features geladen.`, { id: `loading-${layerId}` });
          }

          const layerColor = useDashboardStore.getState().layers.find((l) => l.id === layerId)?.color;
          const suggestions = layerColor
            ? analyzeDatasetForSuggestions(geoJson, layerId, `${wfsUrl}#${typeName}`, layerColor)
            : [];
          if (suggestions.length > 0) {
            let dismissedIds: Set<string>;
            try {
              const raw = localStorage.getItem("dismissed-suggestion-ids");
              dismissedIds = new Set(raw ? JSON.parse(raw) : []);
            } catch {
              dismissedIds = new Set();
            }

            const { pendingSuggestions, setPendingSuggestions } = useDashboardStore.getState();
            const existingIds = new Set(pendingSuggestions.map((s) => s.id));

            const newUnique = suggestions.filter(
              (s) => !dismissedIds.has(s.id) && !existingIds.has(s.id)
            );

            if (newUnique.length > 0) {
              setPendingSuggestions([...pendingSuggestions, ...newUnique]);
            }
          }
        }

        return layerId;
      } catch (error) {
        console.error("Fehler beim Laden der WFS-Daten:", error);
        toast.error("Fehler beim Laden der Geodaten.", { id: `loading-${layerId}` });
        updateLayer(layerId, { isLoading: false, geoJson: null });
        return undefined;
      }
    },
    [addLayer, updateLayer]
  );

  return loadLayer;
}

export function MapView() {
  const hasAnyLoading = useDashboardStore((s) => s.layers.some((l) => l.isLoading));

  return (
    <div className="w-full h-full relative">
      {hasAnyLoading && (
        <div className="absolute top-2 right-2 z-50 bg-card/90 backdrop-blur border shadow-sm rounded-lg px-3 py-2 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-xs font-medium">Layer wird geladen…</span>
        </div>
      )}
      <DynamicLeafletMap />
    </div>
  );
}
