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
    // Zustand erst beim Klick lesen: ein Hook-Aufruf ohne Selector würde die
    // Komponente an den gesamten Store binden und bei jedem Kartenschwenk neu rendern
    const state = useDashboardStore.getState();

    // Nur die Metadaten, um GeoJSON neu zu fetchen bzw. den Zustand wiederherzustellen
    const workspaceData = {
      layers: state.layers.map(l => ({
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

    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      toast.success("Workspace-Link in Zwischenablage kopiert!");
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      toast.error("Fehler beim Kopieren des Links");
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
