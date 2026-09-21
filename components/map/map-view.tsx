"use client";

import { useCallback } from "react";
import { useDashboardStore } from "@/store/useDashboardStore";
import {
  fetchWfsCapabilities,
  fetchWfsFeatures,
  extractAttributes,
  getMatchedFeatureCount,
  WFS_FEATURE_LIMIT,
} from "@/lib/wfs-service";
import { analyzeDatasetForSuggestions } from "@/lib/dataset-suggestions";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

// Dynamischer Import: Leaflet greift beim Initialisieren auf window zu und
// darf deshalb nicht serverseitig gerendert werden
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
 * Lädt einen WFS-Datensatz als neuen Layer in den Store. Wird von der
 * Sidebar und vom direkten URL-Eingabefeld verwendet.
 *
 * `preferredTypeName` wählt bei Diensten mit mehreren Layern den gewünschten
 * aus; ohne Angabe greift der erste Layer aus den Capabilities, der bei
 * Sammelknoten inhaltlich nicht zur Beschriftung passen kann.
 *
 * Gibt bei Erfolg die neue Layer-ID zurück (sonst `undefined`), damit
 * Aufrufer direkt danach gezielt auf den geladenen Layer zugreifen können
 * (z.B. um automatisch ein Thematic Mapping anzuwenden).
 */
export function useLoadWfsLayer() {
  const addLayer = useDashboardStore((s) => s.addLayer);
  const updateLayer = useDashboardStore((s) => s.updateLayer);
  const setAvailableAttributes = useDashboardStore((s) => s.setAvailableAttributes);

  const loadLayer = useCallback(
    async (wfsUrl: string, label: string, preferredTypeName?: string): Promise<string | undefined> => {
      // Aktuellen Stand lesen statt der Layer aus dem Render-Closure: Bei
      // schnellen Doppelklicks wäre der sonst veraltet und lüde doppelt
      const existing = useDashboardStore.getState().layers.find((l) => l.wfsUrl === wfsUrl);
      if (existing) {
        toast.info("Layer bereits geladen", {
          description: `"${existing.label}" ist bereits auf der Karte.`,
        });
        return undefined;
      }

      // Sofort als "loading" hinzufügen, damit die UI direkt reagiert
      const layerId = addLayer({
        label,
        wfsUrl,
        typeName: null,
        geoJson: null,
        visible: true,
        isLoading: true,
      });

      try {
        const layerNames = await fetchWfsCapabilities(wfsUrl);

        if (preferredTypeName && !layerNames.includes(preferredTypeName)) {
          // Dienst hat seine Layer umbenannt/entfernt; Fallback auf den ersten
          // Layer bleibt bestehen, der Hinweis macht die Abweichung sichtbar
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

        updateLayer(layerId, { typeName });
        toast.info(`Lade Layer: ${typeName}`, { id: `loading-${layerId}` });

        const geoJson = await fetchWfsFeatures(wfsUrl, typeName);

        updateLayer(layerId, { geoJson, isLoading: false });

        const { primaryLayerId } = useDashboardStore.getState();
        if (primaryLayerId === layerId) {
          setAvailableAttributes(extractAttributes(geoJson));
          useDashboardStore.setState({ geoJsonData: geoJson });
        }

        const count = geoJson.features?.length ?? 0;
        if (count === 0) {
          toast.warning("Datensatz geladen, aber keine Features gefunden.", {
            id: `loading-${layerId}`,
          });
        } else {
          // Kappung durch count=500 sichtbar machen: Alle Auswertungen beziehen
          // sich sonst unbemerkt auf einen beliebigen Ausschnitt des Datensatzes
          const matched = getMatchedFeatureCount(geoJson);
          if (matched !== null ? matched > count : count >= WFS_FEATURE_LIMIT) {
            toast.warning(
              matched !== null
                ? `Nur ${count} von ${matched.toLocaleString("de-DE")} Features geladen.`
                : `Nur die ersten ${count} Features geladen.`,
              {
                id: `loading-${layerId}`,
                description: "Der Dienst wird auf diese Anzahl begrenzt abgerufen – Karte und Auswertungen zeigen nur diesen Ausschnitt.",
              }
            );
          } else {
            toast.success(`${count} Features geladen.`, { id: `loading-${layerId}` });
          }

          const suggestions = analyzeDatasetForSuggestions(geoJson, layerId, `${wfsUrl}#${typeName}`);
          if (suggestions.length > 0) {
            // Bereits vom Nutzer verworfene Vorschlag-IDs aus localStorage lesen
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
    [addLayer, updateLayer, setAvailableAttributes]
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
