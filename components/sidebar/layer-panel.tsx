"use client";

import { useShallow } from "zustand/react/shallow";
import { useDashboardStore, MapLayer } from "@/store/useDashboardStore";
import { Eye, EyeOff, Trash2, Layers, ChevronDown, ChevronUp, Star } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { LayerStyling } from "./layer-styling";
import { InfoHint } from "@/components/info-hint";

function LayerRow({ layer }: { layer: MapLayer }) {
  const { removeLayer, updateLayer, setPrimaryLayer, primaryLayerId } = useDashboardStore(
    useShallow((s) => ({
      removeLayer: s.removeLayer,
      updateLayer: s.updateLayer,
      setPrimaryLayer: s.setPrimaryLayer,
      primaryLayerId: s.primaryLayerId,
    }))
  );
  const isPrimary = layer.id === primaryLayerId;

  return (
    <div
      className={cn(
        "flex items-start gap-2 p-2.5 rounded-lg border transition-all",
        isPrimary
          ? "border-l-2 bg-muted/30"
          : "border-border bg-card hover:bg-muted/20"
      )}
      style={isPrimary ? { borderLeftColor: layer.color } : undefined}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: layer.color }}
          />
          <span className="text-xs font-medium truncate leading-tight" title={layer.label}>
            {layer.label}
          </span>
        </div>
        {layer.typeName && (
          <p className="text-[10px] text-muted-foreground font-mono truncate pl-4">
            {layer.typeName}
          </p>
        )}
        {layer.isLoading && (
          <p className="text-[10px] text-primary pl-4 animate-pulse">Wird geladen…</p>
        )}

        {!layer.isLoading && layer.geoJson && (
          <div className="pl-4 mt-1.5 flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-12">Opazität</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={layer.opacity}
              onChange={(e) => updateLayer(layer.id, { opacity: parseFloat(e.target.value) })}
              className="flex-1 h-1 accent-primary"
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <LayerStyling layer={layer} />

        {!isPrimary && layer.geoJson && (
          <button
            onClick={() => setPrimaryLayer(layer.id)}
            title="Als primären Layer für Analytics setzen"
            className="p-1 rounded hover:bg-amber-100 hover:text-amber-600 text-muted-foreground transition-colors"
          >
            <Star className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
          title={layer.visible ? "Layer ausblenden" : "Layer einblenden"}
          className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
        >
          {layer.visible
            ? <Eye className="h-3.5 w-3.5" />
            : <EyeOff className="h-3.5 w-3.5 opacity-50" />}
        </button>

        <button
          onClick={() => removeLayer(layer.id)}
          title="Layer entfernen"
          className="p-1 rounded hover:bg-red-50 hover:text-red-500 text-muted-foreground transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function LayerPanel() {
  const { layers, clearLayers } = useDashboardStore(
    useShallow((s) => ({
      layers: s.layers,
      clearLayers: s.clearLayers,
    }))
  );
  const [collapsed, setCollapsed] = useState(false);

  if (layers.length === 0) return null;

  return (
    <div id="tour-layer-panel" className="border-t bg-card/50">
      {/* Kein äußeres <button>: "Alle löschen" ist eine eigene Schaltfläche,
          und verschachtelte <button>-Elemente sind ungültiges HTML. Ein-/
          Ausklappen übernehmen daher zwei eigenständige Schaltflächen. */}
      <div className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors">
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls="layer-panel-list"
          className="flex flex-1 min-w-0 items-center gap-2 text-left"
        >
          <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold text-foreground">
            Aktive Layer ({layers.length})
          </span>
          <div className="flex -space-x-1">
            {layers.slice(0, 4).map((l) => (
              <span
                key={l.id}
                className="inline-block h-2 w-2 rounded-full border border-background"
                style={{ backgroundColor: l.color }}
              />
            ))}
            {layers.length > 4 && (
              <span className="text-[10px] text-muted-foreground ml-1">+{layers.length - 4}</span>
            )}
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <InfoHint title="Layer">
            <p>Ein Layer ist ein geladener Datensatz, der als eigene Ebene über der Karte liegt. Mehrere Layer lassen sich gleichzeitig anzeigen.</p>
            <p>Der Layer mit dem <strong>Stern</strong> ist der aktive: Nur er fließt in Diagramme, Qualitätsreport und Tabelle ein. Über das Auge blendest du einen Layer aus, ohne ihn zu entfernen.</p>
          </InfoHint>
          {layers.length > 0 && (
            <button
              onClick={clearLayers}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors px-1"
              title="Alle Layer entfernen"
            >
              Alle löschen
            </button>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-controls="layer-panel-list"
            aria-label={collapsed ? "Layerliste ausklappen" : "Layerliste einklappen"}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {collapsed
              ? <ChevronDown className="h-3.5 w-3.5" />
              : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div id="layer-panel-list" className="px-3 pb-3 flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          {layers.map((layer) => (
            <LayerRow key={layer.id} layer={layer} />
          ))}
          <p className="text-[10px] text-muted-foreground text-center pt-1">
            Der markierte Layer ist die Grundlage aller Auswertungen
          </p>
        </div>
      )}
    </div>
  );
}
