"use client";

import { useMemo } from "react";
import { useDashboardStore, MapLayer } from "@/store/useDashboardStore";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Palette, Flame } from "lucide-react";
import { buildThematicStyling } from "@/lib/thematic-styling";
import { dominantGeometryType } from "@/lib/dataset-suggestions";

export function LayerStyling({ layer }: { layer: MapLayer }) {
  const updateLayer = useDashboardStore((s) => s.updateLayer);

  // Über ALLE Features sammeln: Im ersten Feature können Werte fehlen, die
  // erst bei anderen vorkommen
  const attributes = useMemo(() => {
    const usable = new Set<string>();
    for (const feature of layer.geoJson?.features ?? []) {
      if (!feature.properties) continue;
      for (const [key, value] of Object.entries(feature.properties)) {
        if (value === null || typeof value === "object") continue;
        usable.add(key);
      }
    }
    return Array.from(usable).sort((a, b) => a.localeCompare(b, "de"));
  }, [layer.geoJson]);

  // Als Array statt Record: Attributnamen können reine Zahlen sein ("2024"),
  // und solche Schlüssel würde ein Objekt an den Anfang sortieren.
  const thematicOptions = useMemo(
    () => [
      { value: "none", label: "Standardfarbe (Keine)" },
      ...attributes.map((attr) => ({ value: attr, label: attr })),
    ],
    [attributes]
  );

  const geometryType = useMemo(
    () => (layer.geoJson ? dominantGeometryType(layer.geoJson) : null),
    [layer.geoJson]
  );
  const isPointLayer = geometryType === "Point" || geometryType === "MultiPoint";

  // Bei aktiver Heatmap bleibt der Schalter bedienbar, auch wenn der Layer
  // keine Punkte führt: Sonst ließe sich ein aus einem geteilten Workspace
  // wiederhergestelltes renderAsHeatmap nicht mehr abschalten.
  const heatmapLocked = !isPointLayer && !layer.renderAsHeatmap;

  const handleHeatmapToggle = (checked: boolean) => {
    updateLayer(layer.id, { renderAsHeatmap: checked });
  };

  const handleThematicChange = (attribute: string | null) => {
    if (!attribute) return;
    if (attribute === "none") {
      updateLayer(layer.id, { thematicStyling: undefined });
      return;
    }

    updateLayer(layer.id, {
      // Eine aktive Heatmap würde die Einfärbung überdecken
      renderAsHeatmap: false,
      thematicStyling: buildThematicStyling(layer.geoJson ?? null, attribute, layer.color),
    });
  };

  return (
    <Popover>
      <PopoverTrigger render={
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
          <Palette className="h-3.5 w-3.5" />
        </Button>
      } />
      <PopoverContent className="w-64 p-4 space-y-4" side="right" align="start">
        <h4 className="font-medium text-sm border-b pb-2">Räumliche Analyse & Stil</h4>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2 text-xs">
              <Flame className="h-3.5 w-3.5 text-orange-500" />
              Als Heatmap anzeigen
            </Label>
            <Switch
              checked={layer.renderAsHeatmap || false}
              onCheckedChange={handleHeatmapToggle}
              disabled={heatmapLocked}
            />
          </div>
          {geometryType && !isPointLayer && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Nur für Punktdaten sinnvoll: Flächen werden auf ihren Mittelpunkt
              reduziert und alle gleich stark gewichtet. Die Karte zeigte dann
              den Zuschnitt der Gebiete statt der Werte – dicht unterteilte
              Innenstadtlagen erscheinen heiß, große Randgebiete kalt.
            </p>
          )}
        </div>

        <div className="space-y-2 pt-2 border-t">
          <Label className="text-xs">Färben nach Attribut (Thematic Mapping)</Label>
          <Select
            items={thematicOptions}
            value={layer.thematicStyling?.attribute || "none"}
            onValueChange={handleThematicChange}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Attribut wählen" />
            </SelectTrigger>
            <SelectContent>
              {thematicOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

      </PopoverContent>
    </Popover>
  );
}
