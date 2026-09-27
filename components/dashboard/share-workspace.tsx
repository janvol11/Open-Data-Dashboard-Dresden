"use client";

import { useDashboardStore } from "@/store/useDashboardStore";
import LZString from "lz-string";
import { Share2, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function ShareWorkspace() {
  const [copied, setCopied] = useState(false);

  const handleShare = () => {
    const state = useDashboardStore.getState();

    // Nur was zum Neuladen nötig ist, keine Geodaten
    const workspaceData = {
      // Lokale Layer lassen sich nicht neu laden, und der Dateiname hat im Link nichts verloren
      layers: state.layers.filter((l) => !l.wfsUrl.startsWith("local-")).map(l => ({
        wfsUrl: l.wfsUrl,
        label: l.label,
        typeName: l.typeName,
        color: l.color,
        visible: l.visible,
        opacity: l.opacity,
        renderAsHeatmap: l.renderAsHeatmap,
        thematicStyling: l.thematicStyling
      })),
      chartFilter: state.chartFilter,
      visualAnalyticsAttribute: state.visualAnalyticsAttribute,
      correlationX: state.correlationX,
      correlationY: state.correlationY,
      temporalAttribute: state.temporalAttribute,
      temporalValueAttr: state.temporalValueAttr,
      temporalChartType: state.temporalChartType,
    };

    const json = JSON.stringify(workspaceData);
    const compressed = LZString.compressToEncodedURIComponent(json);
    
    const url = new URL(window.location.href);
    url.hash = `workspace=${compressed}`;

    const localLayerCount = state.layers.filter((l) => l.wfsUrl.startsWith("local-")).length;

    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      toast.success("Link kopiert", {
        description:
          localLayerCount > 0
            ? `${localLayerCount} lokale${localLayerCount === 1 ? "r" : ""} Layer (CSV/Verknüpfung) ${localLayerCount === 1 ? "ist" : "sind"} im Link nicht enthalten.`
            : undefined,
      });
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      toast.error("Link konnte nicht kopiert werden");
    });
  };

  return (
    <Button
      id="tour-share"
      variant="outline" 
      size="sm" 
      className="h-8 gap-2 text-xs font-medium"
      onClick={handleShare}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Share2 className="h-3.5 w-3.5" />}
      {copied ? "Kopiert" : "Teilen"}
    </Button>
  );
}
