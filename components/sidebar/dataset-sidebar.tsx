"use client";

/**
 * Sidebar: Suche mit 500ms Debounce, Race-Condition-Schutz für veraltete
 * API-Antworten, und WFS-URL-Isolation aus CKAN-Paketen.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useDashboardStore } from "@/store/useDashboardStore";
import { DresdenDataset } from "@/types/dresden-data";
import { searchDresdenDatasets } from "@/lib/dresden-api";

import { useLoadWfsLayer } from "@/components/map/map-view";
import { parseCsvToGeoJson } from "@/lib/csv-utils";
import { LayerPanel } from "@/components/sidebar/layer-panel";
import { TablePanel } from "@/components/sidebar/table-panel";
import { DataStories } from "@/components/sidebar/data-stories";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Database, MapPin, AlertTriangle, Link, Loader2, ArrowRight, Clock, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

/** Mindestlänge des Suchbegriffs, bevor ein Request ausgelöst wird. */
const MIN_QUERY_LENGTH = 3;

/** Wartezeit in ms nach der letzten Tastatureingabe vor dem API-Request. */
const DEBOUNCE_MS = 500;

/** Isoliert die WFS-URL eines Datensatzes: wfsUrl → serviceUrl mit WFS-Signatur → erste serviceUrl → null. */
function extractWfsUrl(dataset: DresdenDataset): string | null {
  if (dataset.wfsUrl) {
    return dataset.wfsUrl;
  }

  const wfsSignatures = ["service=wfs", "wfs_srv", "/wfs"];
  for (const url of dataset.serviceUrls) {
    const lower = url.toLowerCase();
    if (wfsSignatures.some((sig) => lower.includes(sig))) {
      return url;
    }
  }

  for (const url of dataset.serviceUrls) {
    if (url.toLowerCase().includes("wfs")) {
      return url;
    }
  }

  return dataset.serviceUrls[0] ?? null;
}

export function DatasetSidebar() {
  const {
    searchQuery,
    setSearchQuery,
    datasets,
    setDatasets,
    appendDatasets,
    totalDatasets,
    setTotalDatasets,
    datasetsStart,
    setDatasetsStart,
    isLoading,
    setIsLoading,
    layers,
    addLayer,
    addTable
  } = useDashboardStore(
    // Nur die benötigten Felder abonnieren: Ohne Selector renderte die Sidebar
    // bei jeder Store-Änderung neu, auch bei jedem Kartenschwenk (mapBoundsFilter)
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      setSearchQuery: s.setSearchQuery,
      datasets: s.datasets,
      setDatasets: s.setDatasets,
      appendDatasets: s.appendDatasets,
      totalDatasets: s.totalDatasets,
      setTotalDatasets: s.setTotalDatasets,
      datasetsStart: s.datasetsStart,
      setDatasetsStart: s.setDatasetsStart,
      isLoading: s.isLoading,
      setIsLoading: s.setIsLoading,
      layers: s.layers,
      addLayer: s.addLayer,
      addTable: s.addTable,
    }))
  );

  const loadLayer = useLoadWfsLayer();

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingMoreRef = useRef(false);
  const currentQueryRef = useRef<string>("");

  // Direkteingabe WFS/WMS-URL
  const [directUrl, setDirectUrl] = useState("");
  const [isDirectLoading, setIsDirectLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      toast.info(`Lade CSV: ${file.name}`);
      const geoJson = await parseCsvToGeoJson(file);
      const withGeometry = geoJson.features.filter((feature) => feature.geometry !== null).length;

      if (withGeometry === 0) {
        // Keine einzige Zeile hat eine Koordinate oder WKT-Geometrie: Das ist
        // kein Kartenlayer, sondern eine reine Tabelle (siehe table-panel.tsx
        // und attribute-table.tsx). addTable übernimmt selbst, ob sie primär
        // wird und damit die Analytics-Widgets speist.
        addTable({ label: file.name, geoJson });
        toast.success(`${geoJson.features.length} Zeilen als Tabelle importiert.`, {
          description: "Keine Geometriespalte erkannt (lat/lon oder WKT wie \"shape\") – die Daten stehen als Tabelle für Auswertungen bereit.",
        });
        return;
      }

      // addLayer entscheidet selbst, ob der Layer primär wird – eine bereits
      // aktive Tabelle wird dabei bewusst nicht verdrängt
      addLayer({
        label: file.name,
        wfsUrl: `local-csv://${file.name}`,
        typeName: file.name,
        geoJson: geoJson,
        visible: true,
        isLoading: false,
      });

      if (withGeometry < geoJson.features.length) {
        toast.success(`${withGeometry} von ${geoJson.features.length} Features aus CSV geladen.`, {
          description: `${geoJson.features.length - withGeometry} Zeilen ohne gültige Geometrie erscheinen nicht auf der Karte.`,
        });
      } else {
        toast.success(`${geoJson.features.length} Features aus CSV geladen.`);
      }
    } catch (error) {
      console.error("CSV Import Error:", error);
      toast.error("Fehler beim CSV-Import", { description: String(error) });
    } finally {
      // Auch nach dem Tabellen-Import zurücksetzen, sonst löst dieselbe Datei
      // bei erneuter Auswahl kein onChange mehr aus
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const loadFromUrl = useCallback(async () => {
    const url = directUrl.trim();
    if (!url) return;
    try { new URL(url); } catch {
      toast.error("Ungültige URL", { description: "Bitte eine vollständige URL mit http(s):// eingeben." });
      return;
    }
    setIsDirectLoading(true);
    try {
      const baseUrl = new URL(url);
      const capUrl = new URL(`${baseUrl.origin}${baseUrl.pathname}`);
      const preservedParams = ["nodeid", "node_id", "id", "map"];
      baseUrl.searchParams.forEach((value, key) => {
        if (preservedParams.some(p => key.toLowerCase() === p)) {
          capUrl.searchParams.set(key, value);
        }
      });
      // Kein Name übergeben: Der Layer übernimmt den Titel aus den Capabilities
      await loadLayer(capUrl.toString());
      setDirectUrl("");
    } catch (err) {
      toast.error("Fehler beim Laden", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsDirectLoading(false);
    }
  }, [directUrl, loadLayer]);

  const fetchDatasets = useCallback(
    async (query: string, start: number = 0, append: boolean = false) => {
      currentQueryRef.current = query;

      if (!append) {
        setIsLoading(true);
        setDatasetsStart(0);
      }

      try {
        const results = await searchDresdenDatasets(query, start, 50);

        // Veraltete Antwort verwerfen, falls inzwischen eine neue Query läuft
        if (currentQueryRef.current !== query) return;

        if (append) {
          appendDatasets(results.datasets);
          setDatasetsStart(start);
        } else {
          setDatasets(results.datasets);
          setTotalDatasets(results.total);
        }
      } catch (error: unknown) {
        if (currentQueryRef.current !== query) return;
        const message =
          error instanceof Error
            ? error.message
            : "Unbekannter Fehler beim Laden der Datensätze";
        toast.error("Suche fehlgeschlagen", { description: message });
      } finally {
        if (currentQueryRef.current === query) {
          setIsLoading(false);
        }
      }
    },
    [
      appendDatasets,
      setDatasets,
      setDatasetsStart,
      setIsLoading,
      setTotalDatasets,
    ]
  );

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const trimmed = searchQuery.trim();

    if (!trimmed || trimmed.length < MIN_QUERY_LENGTH) {
      setDatasets([]);
      setTotalDatasets(0);
      setIsLoading(false);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchDatasets(trimmed, 0, false);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery, fetchDatasets, setDatasets, setTotalDatasets, setIsLoading]);

  const handleLoadMore = async () => {
    if (isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;

    const nextStart = datasetsStart + 50;
    await fetchDatasets(searchQuery.trim(), nextStart, true);

    isLoadingMoreRef.current = false;
  };

  const handleDatasetClick = useCallback(
    (dataset: DresdenDataset) => {
      const wfsUrl = extractWfsUrl(dataset);
      if (!wfsUrl) {
        toast.warning("Kein WFS-Dienst gefunden", {
          description: `"${dataset.title}" hat keinen zugreifbaren WFS-Endpunkt.`,
        });
        return;
      }
      loadLayer(wfsUrl, dataset.title);
    },
    [loadLayer]
  );

  const trimmedQuery = searchQuery.trim();
  const queryTooShort = trimmedQuery.length > 0 && trimmedQuery.length < MIN_QUERY_LENGTH;
  const hasMore = totalDatasets > datasets.length && datasets.length > 0;

  const loadedWfsUrls = new Set(layers.map((l) => l.wfsUrl));

  const [activeTab, setActiveTab] = useState<string>("highlights");

  return (
    <div className="h-full flex flex-col bg-muted/10">
      <div id="tour-sidebar" className="p-4 border-b shrink-0 bg-background space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2 text-foreground">
          <Database className="h-4 w-4" />
          Dresden Datenkatalog
        </h2>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="highlights">Highlights</TabsTrigger>
            <TabsTrigger value="catalog">Suche & Katalog</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === "highlights" && (
          <div className="p-4">
            <DataStories />
          </div>
        )}

        {activeTab === "catalog" && (
          <div className="p-4 space-y-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                type="search"
                placeholder="Suchen (z.B. Baumkataster)..."
                className="pl-9 h-9 text-sm bg-background"
                value={searchQuery}
                onChange={(e) => {
                  const val = e.target.value;
                  setSearchQuery(val);
                }}
                aria-label="Datensätze durchsuchen"
              />
            </div>

            {queryTooShort && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                Bitte mindestens {MIN_QUERY_LENGTH} Zeichen eingeben.
              </p>
            )}

            <div className="pt-1 border-t">
              <p className="text-[11px] text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                <Link className="h-3 w-3" />
                WFS / WMS direkt laden
              </p>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <Input
                    id="direct-url-input"
                    type="url"
                    placeholder="https://…?Service=WFS…"
                    className="h-8 text-xs bg-background pr-2 font-mono"
                    value={directUrl}
                    onChange={(e) => setDirectUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loadFromUrl()}
                    disabled={isDirectLoading}
                    aria-label="WFS oder WMS URL direkt laden"
                  />
                </div>
                <button
                  onClick={loadFromUrl}
                  disabled={isDirectLoading || !directUrl.trim()}
                  className={cn(
                    "h-8 w-8 shrink-0 rounded-md border flex items-center justify-center transition-colors",
                    directUrl.trim() && !isDirectLoading
                      ? "bg-primary text-primary-foreground hover:bg-primary/90 border-primary"
                      : "bg-muted text-muted-foreground border-border cursor-not-allowed"
                  )}
                  aria-label="URL laden"
                >
                  {isDirectLoading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ArrowRight className="h-3.5 w-3.5" />}
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
                  <Upload className="h-3 w-3" />
                  Lokale CSV laden
                </p>
                <input
                  type="file"
                  accept=".csv"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                  id="csv-upload"
                />
                <label
                  htmlFor="csv-upload"
                  className="h-7 px-3 text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md flex items-center justify-center cursor-pointer transition-colors border shadow-sm"
                >
                  CSV Auswählen
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-3">

            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 p-3 border rounded-lg bg-card shadow-sm"
                >
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2 mt-1" />
                  <div className="flex gap-2 mt-2">
                    <Skeleton className="h-5 w-12 rounded-full" />
                    <Skeleton className="h-5 w-12 rounded-full" />
                  </div>
                </div>
              ))

            ) : datasets.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground px-1">
                {datasets.length}{" "}
                {datasets.length === 1 ? "Datensatz" : "Datensätze"} gefunden
              </p>

              {datasets.map((dataset) => (
                <button
                  key={dataset.id}
                  onClick={() => handleDatasetClick(dataset)}
                  className={cn(
                    "flex flex-col text-left gap-1.5 p-3 border rounded-lg transition-all duration-200 w-full",
                    loadedWfsUrls.has(extractWfsUrl(dataset) ?? "")
                      ? "bg-primary/5 border-primary shadow-sm ring-1 ring-primary/20"
                      : "bg-card border-border hover:border-primary/50 hover:bg-muted/30"
                  )}
                  aria-pressed={loadedWfsUrls.has(extractWfsUrl(dataset) ?? "")}
                  aria-label={`Datensatz auswählen: ${dataset.title}`}
                >
                  <div className="font-medium text-sm leading-tight text-foreground line-clamp-2">
                    {dataset.title}
                  </div>

                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="line-clamp-1">{dataset.publisher}</span>
                  </div>

                  {dataset.metadata_modified && (
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5" title="Letzte Aktualisierung des Metadatensatzes auf GovData">
                      <Clock className="h-3 w-3 shrink-0" />
                      <span>Aktualisiert: {new Date(dataset.metadata_modified).toLocaleDateString("de-DE")}</span>
                    </div>
                  )}

                  <div
                    className="text-xs text-muted-foreground line-clamp-2 leading-relaxed"
                    title={dataset.description}
                  >
                    {dataset.description}
                  </div>

                  {loadedWfsUrls.has(extractWfsUrl(dataset) ?? "") && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                      <span className="text-[10px] text-green-600 font-medium">Bereits auf Karte</span>
                    </div>
                  )}
                </button>
              ))}

              {hasMore && (
                <button
                  onClick={handleLoadMore}
                  className="mt-1 w-full py-2.5 text-xs font-medium bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg transition-colors border border-dashed"
                >
                  Mehr laden ({datasets.length} von {totalDatasets})
                </button>
              )}
            </>

          ) : !trimmedQuery || trimmedQuery.length < MIN_QUERY_LENGTH ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center text-muted-foreground">
              <Search className="h-10 w-10 mb-4 opacity-15" />
              <p className="text-sm font-medium text-foreground/70">
                WFS-Datensätze suchen
              </p>
              <p className="text-xs mt-2 leading-relaxed max-w-[200px]">
                Gib einen Begriff ein (z.B. &quot;Baum&quot;, &quot;Schule&quot;,
                &quot;Straße&quot;), um Geodatensätze der Stadt Dresden zu finden.
              </p>
            </div>

          ) : (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center text-muted-foreground">
              <Database className="h-10 w-10 mb-4 opacity-15" />
              <p className="text-sm font-medium text-foreground/70">
                Keine WFS-Datensätze gefunden
              </p>
              <p className="text-xs mt-2 leading-relaxed">
                Für &quot;{trimmedQuery}&quot; gibt es keine verfügbaren
                Geodienste. Versuche einen anderen Suchbegriff.
              </p>
            </div>
          )}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0">
        <LayerPanel />
        <TablePanel />
      </div>
    </div>
  );
}
