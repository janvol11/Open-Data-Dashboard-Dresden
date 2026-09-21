"use client";

import { useShallow } from "zustand/react/shallow";
import { useDashboardStore } from "@/store/useDashboardStore";
import { useLoadWfsLayer } from "@/components/map/map-view";
import {
  TreeDeciduous,
  Baby,
  Loader2,
  Sparkles,
  BookOpen,
  MapPin,
  CheckCircle2,
  ChevronRight,
  Bike,
  Trash2,
  Landmark,
  Accessibility,
  Filter,
  LayersIcon,
  Percent,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { buildThematicStyling } from "@/lib/thematic-styling";

interface DataStory {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  url: string;
  /** Gewünschter Layer bei Diensten mit mehreren; ohne Angabe wird der erste Layer der Capabilities geladen. */
  typeName?: string;
  gradient: string;
  iconBg: string;
  category: string;
  featureHint: string;
  /** "Was lernst du hier?"-Tipp */
  insight?: string;
  /**
   * Attribut, das nach dem Laden automatisch als Thematic Mapping angewendet
   * wird – für Layer, die bereits als fertige Choroplethe vorliegen (Polygon
   * + Kennzahl), damit sie sofort eingefärbt statt einfarbig erscheinen.
   */
  autoStyleAttribute?: string;
}

const DATA_STORIES: DataStory[] = [
  {
    id: "story-baeume",
    title: "Stadtbäume",
    description: "Alle erfassten Straßen- und Anlagenbäume Dresdens – über 50.000 georeferenzierte Datenpunkte.",
    icon: TreeDeciduous,
    url: "https://kommisdd.dresden.de/net3/public/ogc.ashx?NodeId=1633&Service=WFS&Request=GetCapabilities",
    gradient: "from-emerald-500/20 to-green-600/10",
    iconBg: "bg-emerald-500",
    category: "Stadtgrün",
    featureHint: "~50.000 Bäume",
    insight: "Ideal für Heatmap-Visualisierung und Baumartenanalyse",
  },
  {
    id: "story-gruenanlagen",
    title: "Grünanlagen",
    description: "Öffentliche Parks, Gartenanlagen und Grünflächen nach Grünanlagensatzung.",
    icon: Bike,
    url: "https://kommisdd.dresden.de/net3/public/ogc.ashx?NodeId=757&Service=WFS&Request=GetCapabilities",
    // Knoten liefert 6 Layer, beginnend mit "Spielbereiche (Punkte)" statt Grünflächen
    typeName: "cls:L569",
    gradient: "from-lime-500/20 to-green-600/10",
    iconBg: "bg-lime-600",
    category: "Stadtgrün",
    featureHint: "Parks & Anlagen",
    insight: "Zeigt Polygone der Grünflächen mit Kategorien",
  },
  {
    id: "story-kitas",
    title: "Kitas & Krippen",
    description: "Standorte und Träger aller Kindertageseinrichtungen im Stadtgebiet.",
    icon: Baby,
    url: "https://kommisdd.dresden.de/net3/public/ogc.ashx?NodeId=803&Service=WFS&Request=GetCapabilities",
    gradient: "from-sky-500/20 to-blue-600/10",
    iconBg: "bg-sky-500",
    category: "Soziales",
    featureHint: "~520 Einrichtungen",
    insight: "Kategorisches Styling nach Träger empfohlen",
  },
  {
    id: "story-schulen",
    title: "Grundschulen",
    description: "Alle Grundschulen in Dresden mit Standort, Schulart und Trägerschaft.",
    icon: BookOpen,
    url: "https://kommisdd.dresden.de/net3/public/ogc.ashx?NodeId=722&Service=WFS&Request=GetCapabilities",
    gradient: "from-violet-500/20 to-purple-600/10",
    iconBg: "bg-violet-500",
    category: "Bildung",
    featureHint: "~100 Schulen",
    insight: "Vergleiche staatliche und freie Träger",
  },
  {
    id: "story-spielplaetze",
    title: "Spielplätze",
    description: "Öffentliche Spielplätze der Stadtverwaltung mit Ausstattungsinfos.",
    icon: MapPin,
    url: "https://kommisdd.dresden.de/net3/public/ogc.ashx?NodeId=327&Service=WFS&Request=GetCapabilities",
    gradient: "from-orange-500/20 to-amber-600/10",
    iconBg: "bg-orange-500",
    category: "Freizeit",
    featureHint: "~400 Spielplätze",
    insight: "Räumliche Verteilung nach Stadtteilen analysieren",
  },
  {
    id: "story-baukultur",
    title: "Baukultur",
    description: "Baukulturell bedeutsame Bauwerke Dresdens mit Bauzeit, Bauherr und Planungsbüro.",
    icon: Landmark,
    url: "https://kommisdd.dresden.de/net3/public/ogc.ashx?NodeId=1433&Service=WFS&Request=GetCapabilities",
    typeName: "cls:L1090",
    gradient: "from-rose-500/20 to-pink-600/10",
    iconBg: "bg-rose-500",
    category: "Kultur",
    featureHint: "~105 Bauwerke",
    insight: "Bauzeit als Zeitachse für die Zeitreihenanalyse nutzen",
  },
  {
    id: "story-barrierefrei",
    title: "Barrierefreiheit im Verkehr",
    description: "Barrierefreie Haltestellen, Zugänge und Querungen aus dem Infoportal Barrierefreiheit.",
    icon: Accessibility,
    url: "https://kommisdd.dresden.de/net3/public/ogc.ashx?NodeId=1522&Service=WFS&Request=GetCapabilities",
    typeName: "cls:L1171",
    gradient: "from-cyan-500/20 to-teal-600/10",
    iconBg: "bg-cyan-600",
    category: "Soziales",
    featureHint: "~74 Standorte",
    insight: "Lücken in der Barrierefreiheit identifizieren",
  },
  {
    id: "story-entsorgung",
    title: "Entsorgung & Recycling",
    description: "Wertstoffcontainer-Standplätze im Stadtgebiet mit Angaben zu Papier und Altkleidern.",
    icon: Trash2,
    url: "https://kommisdd.dresden.de/net3/public/ogc.ashx?NodeId=920&Service=WFS&Request=GetCapabilities",
    // Knoten beginnt mit "Abfallsäcke - Ausgabestellen"; gemeint sind die Containerstandplätze
    typeName: "cls:L567",
    gradient: "from-slate-500/20 to-gray-600/10",
    iconBg: "bg-slate-500",
    category: "Infrastruktur",
    featureHint: "Abfallinfrastruktur",
    insight: "Containerstandorte nach Typ einfärben",
  },
  {
    id: "story-sgb2",
    title: "SGB II je Stadtteil",
    description:
      "Anteil erwerbsfähiger SGB-II-Leistungsberechtigter je Stadtteil – der gängige kleinräumige Indikator zur Arbeitsmarktlage, da Dresden keine Arbeitslosenquote unterhalb der Gesamtstadt veröffentlicht.",
    icon: Percent,
    url: "https://kommisdd.dresden.de/net3/public/ogc.ashx?NodeId=539&Service=WFS&Request=GetCapabilities",
    gradient: "from-indigo-500/20 to-indigo-600/10",
    iconBg: "bg-indigo-500",
    category: "Statistik",
    featureHint: "61 Stadtteile",
    insight: "Bereits als Choroplethe verknüpft – lädt direkt eingefärbt",
    autoStyleAttribute: "prozent",
  },
  {
    id: "story-bevoelkerung-75",
    title: "Bevölkerung ab 75 Jahre",
    description:
      "Anteil der Einwohner:innen ab 75 Jahren je Stadtteil – Grundlage für Seniorenplanung, Pflegeinfrastruktur und Barrierefreiheit.",
    icon: Users,
    url: "https://kommisdd.dresden.de/net3/public/ogc.ashx?NodeId=379&Service=WFS&Request=GetCapabilities",
    gradient: "from-indigo-500/20 to-purple-600/10",
    iconBg: "bg-indigo-600",
    category: "Statistik",
    featureHint: "61 Stadtteile",
    insight: "Bereits als Choroplethe verknüpft – lädt direkt eingefärbt",
    autoStyleAttribute: "prozent",
  },
];

const ALL_CATEGORIES = ["Alle", ...Array.from(new Set(DATA_STORIES.map((s) => s.category)))];

const CATEGORY_COLORS: Record<string, string> = {
  Stadtgrün:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Soziales:     "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  Bildung:      "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  Freizeit:     "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  Infrastruktur:"bg-slate-100 text-slate-700 dark:bg-slate-800/30 dark:text-slate-400",
  Kultur:       "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  Statistik:    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
};

const FILTER_CHIP_ACTIVE = "bg-primary text-primary-foreground shadow-sm";
const FILTER_CHIP_IDLE   = "bg-muted text-muted-foreground hover:bg-muted/80";

export function DataStories() {
  const loadLayer = useLoadWfsLayer();
  const { layers, updateLayer } = useDashboardStore(
    useShallow((s) => ({
      layers: s.layers,
      updateLayer: s.updateLayer,
    }))
  );
  const [loadingStoryId, setLoadingStoryId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("Alle");

  // Für Layer, die bereits als fertige Choroplethe vorliegen: Direkt nach dem
  // Laden einfärben statt einfarbig darzustellen und ein zweites Klicken auf
  // "Färben nach Attribut" zu verlangen.
  const applyAutoStyle = useCallback(
    (layerId: string, story: DataStory) => {
      if (!story.autoStyleAttribute) return;
      const fresh = useDashboardStore.getState().layers.find((l) => l.id === layerId);
      if (!fresh?.geoJson) return;
      updateLayer(layerId, {
        thematicStyling: buildThematicStyling(fresh.geoJson, story.autoStyleAttribute, fresh.color),
      });
    },
    [updateLayer]
  );

  const loadedWfsUrls = useMemo(() => new Set(layers.map((l) => l.wfsUrl)), [layers]);

  const filteredStories = useMemo(
    () =>
      activeCategory === "Alle"
        ? DATA_STORIES
        : DATA_STORIES.filter((s) => s.category === activeCategory),
    [activeCategory]
  );

  const handleLoadStory = useCallback(async (story: DataStory) => {
    if (loadedWfsUrls.has(story.url)) {
      toast.info(`„${story.title}“ ist bereits auf der Karte.`);
      return;
    }
    if (loadingStoryId) return;

    setLoadingStoryId(story.id);
    try {
      const layerId = await loadLayer(story.url, story.title, story.typeName);
      if (layerId) applyAutoStyle(layerId, story);
    } catch (err) {
      toast.error(`Fehler beim Laden von ${story.title}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoadingStoryId(null);
    }
  }, [loadedWfsUrls, loadingStoryId, loadLayer, applyAutoStyle]);

  const handleLoadAll = useCallback(async () => {
    const targets = filteredStories.filter((s) => !loadedWfsUrls.has(s.url));
    if (targets.length === 0) {
      toast.info("Alle Datensätze dieser Kategorie sind bereits geladen.");
      return;
    }
    toast.info(`Lade ${targets.length} Datensatz${targets.length > 1 ? "ätze" : ""}…`);
    for (const story of targets) {
      setLoadingStoryId(story.id);
      try {
        const layerId = await loadLayer(story.url, story.title, story.typeName);
        if (layerId) applyAutoStyle(layerId, story);
      } catch {
        // Fehler einzeln ignorieren, weiter machen
      }
      setLoadingStoryId(null);
    }
  }, [filteredStories, loadedWfsUrls, loadLayer, applyAutoStyle]);

  const loadedInFilter = filteredStories.filter((s) => loadedWfsUrls.has(s.url)).length;
  const allFilterLoaded = loadedInFilter === filteredStories.length;

  return (
    <div className="pt-1 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center h-6 w-6 rounded-md bg-amber-500/15">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-foreground tracking-tight leading-none">
              Beliebte Datensätze
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Direkt laden &amp; erkunden
            </p>
          </div>
        </div>

        <button
          onClick={handleLoadAll}
          disabled={allFilterLoaded || loadingStoryId !== null}
          className={cn(
            "flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border transition-colors",
            allFilterLoaded || loadingStoryId !== null
              ? "text-muted-foreground/40 border-border/30 cursor-not-allowed"
              : "text-primary border-primary/30 hover:bg-primary/5"
          )}
          title="Alle Datensätze dieser Kategorie laden"
        >
          <LayersIcon className="h-3 w-3" />
          Alle laden
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Filter className="h-3 w-3 text-muted-foreground/50 mt-0.5 shrink-0" />
        {ALL_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "text-[10px] font-medium px-2 py-0.5 rounded-full transition-all duration-150",
              activeCategory === cat ? FILTER_CHIP_ACTIVE : FILTER_CHIP_IDLE
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      <AnimatePresence mode="popLayout">
        <div className="flex flex-col gap-2">
          {filteredStories.map((story) => {
            const isLoaded  = loadedWfsUrls.has(story.url);
            const isLoading = loadingStoryId === story.id;
            const isBusy    = loadingStoryId !== null && !isLoading;
            const Icon      = story.icon;

            return (
              <motion.button
                key={story.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.18 }}
                onClick={() => handleLoadStory(story)}
                disabled={isLoaded || isLoading || isBusy}
                className={cn(
                  "group relative w-full text-left rounded-xl border overflow-hidden transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  isLoaded
                    ? "border-border/60 opacity-70 cursor-default"
                    : isBusy
                    ? "border-border/40 opacity-50 cursor-not-allowed"
                    : "border-border hover:border-primary/40 hover:shadow-md cursor-pointer active:scale-[0.99]"
                )}
              >
                <div
                  className={cn(
                    "absolute inset-0 bg-linear-to-br opacity-60 transition-opacity duration-200",
                    story.gradient,
                    !isLoaded && !isBusy && "group-hover:opacity-100"
                  )}
                />

                <div className="relative flex items-start gap-3 p-3">
                  <div
                    className={cn(
                      "shrink-0 flex items-center justify-center h-8 w-8 rounded-lg shadow-sm",
                      story.iconBg
                    )}
                  >
                    <Icon className="h-4 w-4 text-white" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <span className="font-semibold text-xs text-foreground leading-tight">
                        {story.title}
                      </span>
                      {isLoaded ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500 mt-0.5" />
                      ) : isLoading ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 text-primary animate-spin mt-0.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all mt-0.5" />
                      )}
                    </div>

                    <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5 line-clamp-2">
                      {story.description}
                    </p>

                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium",
                          CATEGORY_COLORS[story.category] ?? "bg-muted text-muted-foreground"
                        )}
                      >
                        {story.category}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {story.featureHint}
                      </span>
                      {isLoaded && (
                        <span className="text-[9px] text-green-600 dark:text-green-400 font-medium">
                          · Auf Karte
                        </span>
                      )}
                    </div>

                    {story.insight && !isLoaded && (
                      <p className="text-[9px] text-primary/70 mt-1 leading-snug opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        {story.insight}
                      </p>
                    )}
                  </div>
                </div>

                {isLoading && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/20 overflow-hidden">
                    <div className="h-full bg-primary animate-[loading-bar_1.5s_ease-in-out_infinite]" />
                  </div>
                )}
              </motion.button>
            );
          })}
        </div>
      </AnimatePresence>

      <p className="text-[10px] text-muted-foreground text-center pt-1 opacity-60">
        {loadedInFilter} / {filteredStories.length} geladen · Klicken zum Laden
      </p>
    </div>
  );
}
