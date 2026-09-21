"use client";

import { Panel, Group, Separator } from "react-resizable-panels";
import { Map as MapIcon, Database } from "lucide-react";
import { DatasetSidebar } from "@/components/sidebar/dataset-sidebar";
import { MapView } from "@/components/map/map-view";
import { SuggestionPanel } from "@/components/suggestions/SuggestionPanel";
import { VisualAnalytics } from "@/components/analytics/visual-analytics";
import { DataQualityReport } from "@/components/analytics/data-quality-report";
import { CorrelationScatterplot } from "@/components/analytics/correlation-scatterplot";
import { TemporalAnalysis } from "@/components/analytics/temporal-analysis";
import { AttributeTable } from "@/components/analytics/attribute-table";
import { ThemeToggle } from "@/components/theme-toggle";
import { DashboardSettings } from "@/components/dashboard/dashboard-settings";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { OnboardingTour } from "@/components/onboarding-tour";
import { ShareWorkspace } from "@/components/dashboard/share-workspace";
import { useEffect } from "react";
import LZString from "lz-string";
import { useDashboardStore } from "@/store/useDashboardStore";
import type { LayerColor } from "@/store/useDashboardStore";
import { LAYER_COLORS } from "@/store/useDashboardStore";
import { fetchWfsFeatures } from "@/lib/wfs-service";
import { parseSharedWorkspace, type SharedLayer } from "@/lib/shared-workspace";

/** Legt einen Layer aus einem geteilten Link an und lädt seine Features nach. */
async function restoreSharedLayer(l: SharedLayer): Promise<void> {
  const { addLayer, updateLayer } = useDashboardStore.getState();
  const layerId = addLayer({
    label: l.label,
    wfsUrl: l.wfsUrl,
    typeName: l.typeName,
    geoJson: null,
    visible: l.visible,
    isLoading: true,
    renderAsHeatmap: l.renderAsHeatmap,
    thematicStyling: l.thematicStyling,
  });

  try {
    // typeName ohne Wert wird als undefined übergeben, sonst ginge ein
    // Platzhalter als echter Layer-Name an den WFS
    const geoJson = await fetchWfsFeatures(l.wfsUrl, l.typeName ?? undefined);
    const validColor = (LAYER_COLORS as readonly string[]).includes(l.color ?? "")
      ? l.color as LayerColor
      : undefined;
    updateLayer(layerId, {
      geoJson,
      isLoading: false,
      // Nur setzen, wenn der Link sie mitbringt, sonst würde
      // undefined die Voreinstellung aus addLayer überschreiben
      ...(validColor !== undefined && { color: validColor }),
      ...(l.opacity !== undefined && { opacity: l.opacity }),
    });
  } catch {
    updateLayer(layerId, { isLoading: false });
  }
}

export default function DashboardPage() {
  // Kein Store-Hook hier: Ein Abo ohne Selector würde die gesamte Seite bei
  // jeder Store-Änderung neu rendern, auch bei jedem Kartenschwenk. Der
  // Effect braucht den Store nur einmalig und liest ihn über getState().
  useEffect(() => {
    // Geteilten Workspace aus dem URL-Hash wiederherstellen
    const hash = window.location.hash;
    if (!hash.startsWith("#workspace=")) return;

    try {
      const json = LZString.decompressFromEncodedURIComponent(hash.substring(11));
      const workspace = json ? parseSharedWorkspace(JSON.parse(json)) : null;
      if (!workspace) return;

      const store = useDashboardStore.getState();
      if (workspace.chartFilter) {
        store.setChartFilter(workspace.chartFilter);
      }
      if (workspace.visualAnalyticsAttribute) {
        store.setVisualAnalyticsAttribute(workspace.visualAnalyticsAttribute);
      }
      if (workspace.correlationX || workspace.correlationY) {
        store.setCorrelationAttributes(workspace.correlationX, workspace.correlationY);
      }
      if (workspace.temporalAttribute || workspace.temporalValueAttr || workspace.temporalChartType) {
        store.setTemporalConfig(
          workspace.temporalAttribute,
          workspace.temporalValueAttr,
          workspace.temporalChartType
        );
      }

      // restoreSharedLayer fängt Ladefehler selbst ab, es bleiben keine
      // unbehandelten Promise-Rejections zurück
      for (const layer of workspace.layers) {
        void restoreSharedLayer(layer);
      }

      window.history.replaceState(null, "", window.location.pathname);
    } catch (err) {
      console.error("Failed to restore workspace", err);
    }
  }, []);

  return (
    <div className="flex flex-col min-h-screen w-full bg-background">
      <OnboardingTour />
      <header className="sticky top-0 z-20 h-14 border-b flex items-center px-4 bg-card shrink-0 shadow-sm">
        <h1 className="font-semibold text-lg flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          Dresden Data Workspace
        </h1>
        <div className="ml-auto flex items-center gap-2 sm:gap-4">
          <ShareWorkspace />
          <DashboardSettings />
          <ThemeToggle />
          <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded-md hidden sm:inline-block">
            V 0.1.0
          </span>
        </div>
      </header>

      {/* Feste Höhe, damit Leaflet immer eine konkrete Messung hat */}
      <div className="flex w-full" style={{ height: "calc(100vh - 3.5rem)" }}>
        <Group key="dashboard-layout-v2" orientation="horizontal" style={{ height: "100%", width: "100%" }}>

          <Panel defaultSize="20%" minSize="15%" maxSize="40%" style={{ overflow: "hidden" }}>
            <div className="h-full flex flex-col border-r overflow-y-auto">
              <DatasetSidebar />
            </div>
          </Panel>

          <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors" />

          <Panel defaultSize="80%">
            <div className="h-full overflow-y-auto bg-muted/5 relative z-0">
              <DashboardGrid
                widgets={{
                  map: {
                    component: (
                      <>
                        <div className="absolute top-4 left-4 z-1001 bg-background/90 backdrop-blur px-3 py-1.5 border shadow-sm rounded-md text-sm font-medium flex items-center gap-2 pointer-events-none hidden md:flex">
                          <MapIcon className="h-4 w-4 text-blue-500" />
                          Geodaten-Visualisierung
                        </div>
                        <div id="tour-map" className="flex-1 min-h-[60vh] rounded-xl overflow-hidden relative">
                          <MapView />
                          <SuggestionPanel />
                        </div>
                      </>
                    ),
                    className: "md:col-span-12",
                  },
                  visual_analytics: {
                    component: (
                      <div id="tour-analytics" className="flex flex-col h-full min-h-[340px] p-4">
                        <div className="flex-1 min-h-0">
                          <VisualAnalytics />
                        </div>
                      </div>
                    ),
                    className: "md:col-span-8",
                  },
                  temporal: {
                    component: (
                      <div id="tour-temporal" className="flex flex-col h-full min-h-[340px] p-4">
                        <div className="flex-1 min-h-0">
                          <TemporalAnalysis />
                        </div>
                      </div>
                    ),
                    className: "md:col-span-12",
                  },
                  data_quality: {
                    component: (
                      <div id="tour-data-quality" className="flex flex-col h-full min-h-[340px] p-4">
                        <div className="flex-1 min-h-0 overflow-y-auto">
                          <DataQualityReport />
                        </div>
                      </div>
                    ),
                    className: "md:col-span-4",
                  },
                  correlation: {
                    component: (
                      <div id="tour-correlation" className="flex flex-col h-full min-h-[420px] p-4">
                        <CorrelationScatterplot />
                      </div>
                    ),
                    className: "md:col-span-12",
                  },
                  attribute_table: {
                    component: (
                      <div id="tour-attribute-table" className="flex flex-col h-full min-h-[380px] p-4">
                        <AttributeTable />
                      </div>
                    ),
                    className: "md:col-span-12",
                  },
                }}
              />
            </div>
          </Panel>

        </Group>
      </div>
    </div>
  );
}
