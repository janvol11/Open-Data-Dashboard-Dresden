// Zentraler Store des Dashboards, Multi-Layer-fähig: Mehrere WFS-Datensätze
// können gleichzeitig auf der Karte eingeblendet werden.

import { create } from "zustand";
import { DresdenDataset } from "@/types/dresden-data";
import type { FeatureCollection } from "geojson";
import type { Suggestion } from "@/lib/dataset-suggestions";

// Distinkte Farben für bis zu 8 gleichzeitige Layer
export const LAYER_COLORS = [
  "#3b82f6", // Blau
  "#ef4444", // Rot
  "#22c55e", // Grün
  "#f59e0b", // Amber
  "#a855f7", // Violett
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#ec4899", // Pink
] as const;

export type LayerColor = (typeof LAYER_COLORS)[number];

/** Ein einzelner Karten-Layer – repräsentiert einen geladenen WFS-Datensatz. */
export interface MapLayer {
  id: string;
  /** Anzeigename (Datensatz-Titel oder URL-Hostname) */
  label: string;
  wfsUrl: string;
  /** Verwendeter Layer-Name (aus GetCapabilities) */
  typeName: string | null;
  geoJson: FeatureCollection | null;
  /** Zugewiesene Farbe (aus LAYER_COLORS) */
  color: LayerColor;
  visible: boolean;
  isLoading: boolean;
  /** 0.0 – 1.0 */
  opacity: number;
  renderAsHeatmap?: boolean;
  thematicStyling?: {
    attribute: string;
    type: "numeric" | "categorical";
    colors: string[];
    /** Für numerische Quantile/Klassengrenzen */
    ranges?: number[];
  };
}

/**
 * Eine reine Attributtabelle ohne Geometrie – z.B. eine hochgeladene CSV ohne
 * lat/lon- oder WKT-Spalte. Bewusst kein MapLayer: Ohne Geometrie ergeben
 * Sichtbarkeit, Opazität, Farbe und thematische Kartenstile keinen Sinn.
 *
 * `geoJson` trägt trotzdem den Namen `FeatureCollection` (jedes Feature mit
 * `geometry: null`) statt eines schlichten `Record<string, unknown>[]`: So
 * lassen sich Statistik, Zeitreihen- und Korrelationsanalyse unverändert
 * wiederverwenden – sie greifen ohnehin nur auf `.properties` zu.
 */
export interface DataTable {
  id: string;
  /** Anzeigename (Dateiname) */
  label: string;
  geoJson: FeatureCollection;
}

export interface DashboardState {
  // Suche
  searchQuery: string;

  // Datensatz-Liste
  datasets: DresdenDataset[];
  totalDatasets: number;
  datasetsStart: number;
  isLoading: boolean;

  // Multi-Layer
  /** Alle Layer, geordnet nach Hinzufüge-Zeitpunkt */
  layers: MapLayer[];
  /** ID des "primären" Layers für Analytics/Qualitätsbericht */
  primaryLayerId: string | null;

  // Tabellen (Geometrie-lose CSV-Importe)
  /** Alle importierten Tabellen, geordnet nach Hinzufüge-Zeitpunkt */
  tables: DataTable[];
  /**
   * ID der "primären" Tabelle für Analytics/Qualitätsbericht. Layer und
   * Tabellen teilen sich dieselben Auswertungs-Widgets über `geoJsonData` –
   * es kann daher immer nur EINE Quelle primär sein: `primaryLayerId` und
   * `primaryTableId` schließen sich gegenseitig aus (siehe setPrimaryLayer/
   * setPrimaryTable).
   */
  primaryTableId: string | null;

  // Legacy-Kompatibilität für Analytics/QualityReport
  /** = geoJson des primären Layers ODER der primären Tabelle (readonly, abgeleitet) */
  geoJsonData: FeatureCollection | null;
  availableAttributes: string[];
  isMapLoading: boolean;

  selectedDataset: DresdenDataset | null;
  selectedWfsUrl: string | null;

  // Cross-Filtering
  chartFilter: { attribute: string; value: string | number } | null;
  mapBoundsFilter: [[number, number], [number, number]] | null;

  // Analytics Widget Configuration
  visualAnalyticsAttribute: string | null;
  correlationX: string | null;
  correlationY: string | null;
  temporalAttribute: string | null;
  temporalValueAttr: string | null;
  temporalChartType: "bar" | "line" | null;

  // Actions
  setSearchQuery: (query: string) => void;
  setDatasets: (datasets: DresdenDataset[]) => void;
  appendDatasets: (datasets: DresdenDataset[]) => void;
  setTotalDatasets: (total: number) => void;
  setDatasetsStart: (start: number) => void;
  setIsLoading: (isLoading: boolean) => void;

  /** Fügt einen neuen Layer hinzu und gibt seine ID zurück. */
  addLayer: (layer: Omit<MapLayer, "id" | "color" | "opacity">) => string;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<MapLayer>) => void;
  setPrimaryLayer: (id: string) => void;
  clearLayers: () => void;

  /** Fügt eine neue Tabelle hinzu und gibt ihre ID zurück. */
  addTable: (table: Omit<DataTable, "id">) => string;
  removeTable: (id: string) => void;
  updateTable: (id: string, patch: Partial<DataTable>) => void;
  setPrimaryTable: (id: string) => void;
  clearTables: () => void;

  // Legacy actions (weiterhin supported)
  setSelectedDatasetAndWfsUrl: (dataset: DresdenDataset | null, wfsUrl: string | null) => void;
  setSelectedDataset: (dataset: DresdenDataset | null) => void;
  setGeoJsonData: (data: FeatureCollection | null) => void;
  setAvailableAttributes: (attributes: string[]) => void;
  setIsMapLoading: (isMapLoading: boolean) => void;
  // Layout & Dashboards
  widgetOrder: string[];
  hiddenWidgets: string[];
  setWidgetOrder: (order: string[]) => void;
  toggleWidgetVisibility: (id: string) => void;

  // Cross-Filtering Actions
  setChartFilter: (filter: { attribute: string; value: string | number } | null) => void;
  setMapBoundsFilter: (bounds: [[number, number], [number, number]] | null) => void;

  setVisualAnalyticsAttribute: (attr: string | null) => void;
  setCorrelationAttributes: (x: string | null, y: string | null) => void;
  setTemporalConfig: (attr: string | null, valueAttr: string | null, chartType: "bar" | "line" | null) => void;

  // Suggestions
  pendingSuggestions: Suggestion[];
  setPendingSuggestions: (suggestions: Suggestion[]) => void;
  removeSuggestion: (id: string) => void;
  clearPendingSuggestions: () => void;
}

function nextColor(layers: MapLayer[]): LayerColor {
  return LAYER_COLORS[layers.length % LAYER_COLORS.length];
}

/**
 * Store-Patch, der den ersten vorhandenen Layer zur Primärquelle macht (oder
 * alles leert, wenn keiner da ist). Für den Wegfall der primären Tabelle.
 */
function primaryLayerFallback(layers: MapLayer[]): Partial<DashboardState> {
  const layer = layers[0] ?? null;
  return {
    primaryLayerId: layer?.id ?? null,
    geoJsonData: layer?.geoJson ?? null,
    availableAttributes: [],
    selectedWfsUrl: layer?.wfsUrl ?? null,
  };
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  // Initialzustände
  searchQuery: "",
  datasets: [],
  totalDatasets: 0,
  datasetsStart: 0,
  isLoading: false,
  layers: [],
  primaryLayerId: null,
  tables: [],
  primaryTableId: null,

  geoJsonData: null,
  availableAttributes: [],
  isMapLoading: false,

  selectedDataset: null,
  selectedWfsUrl: null,

  chartFilter: null,
  mapBoundsFilter: null,

  visualAnalyticsAttribute: null,
  correlationX: null,
  correlationY: null,
  temporalAttribute: null,
  temporalValueAttr: null,
  temporalChartType: null,

  widgetOrder: ["map", "temporal", "visual_analytics", "data_quality", "correlation", "attribute_table"],
  hiddenWidgets: [],

  pendingSuggestions: [],

  // Action-Implementierungen

  setSearchQuery: (query) =>
    set(() => {
      if (!query || query.trim() === "") {
        return {
          searchQuery: query,
          datasets: [],
          totalDatasets: 0,
          datasetsStart: 0,
        };
      }
      return { searchQuery: query };
    }),

  setDatasets: (datasets) => set({ datasets }),
  appendDatasets: (newDatasets) =>
    set((state) => ({ datasets: [...state.datasets, ...newDatasets] })),
  setTotalDatasets: (total) => set({ totalDatasets: total }),
  setDatasetsStart: (start) => set({ datasetsStart: start }),
  setIsLoading: (isLoading) => set({ isLoading }),

  // Multi-Layer Actions

  addLayer: (layerData) => {
    const state = get();
    const id = `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const color = nextColor(state.layers);

    const newLayer: MapLayer = {
      ...layerData,
      id,
      color,
      opacity: 0.8,
    };

    // Erster Layer wird automatisch primär – aber nur, wenn noch nichts
    // anderes (auch keine Tabelle) die Analytics-Widgets speist, sonst würde
    // ein neu geladener Layer stillschweigend eine bereits aktive Tabelle verdrängen
    const isPrimary = state.layers.length === 0 && state.tables.length === 0;

    set((s) => ({
      layers: [...s.layers, newLayer],
      primaryLayerId: isPrimary ? id : s.primaryLayerId,
      selectedWfsUrl: isPrimary ? layerData.wfsUrl : s.selectedWfsUrl, // Legacy-Sync
      // Wie bei addTable: Wer primär wird, speist die Widgets sofort – Aufrufer
      // müssen geoJsonData dann nicht mehr selbst nachziehen
      ...(isPrimary && { geoJsonData: layerData.geoJson, availableAttributes: [] }),
    }));

    return id;
  },

  removeLayer: (id) => {
    set((state) => {
      const newLayers = state.layers.filter((l) => l.id !== id);
      const newPrimary =
        state.primaryLayerId === id
          ? (newLayers[0]?.id ?? null)
          : state.primaryLayerId;

      const primaryLayer = newLayers.find((l) => l.id === newPrimary) ?? null;

      // War schon vor dem Entfernen kein Layer primär (weil stattdessen eine
      // Tabelle die Analytics-Widgets speist), darf das hier geoJsonData
      // nicht anfassen – sonst würde das Löschen eines beliebigen,
      // nicht-primären Layers die aktive Tabelle aus den Widgets werfen
      const layerWasPrimarySource = state.primaryLayerId !== null;

      // Letzten Layer entfernt: eine vorhandene Tabelle übernimmt die Widgets
      // (Gegenstück zu primaryLayerFallback beim Entfernen von Tabellen)
      const tableFallback = layerWasPrimarySource && !primaryLayer ? state.tables[0] ?? null : null;

      return {
        layers: newLayers,
        primaryLayerId: newPrimary,
        ...(layerWasPrimarySource && {
          geoJsonData: primaryLayer?.geoJson ?? tableFallback?.geoJson ?? null,
          availableAttributes: [],
          selectedWfsUrl: primaryLayer?.wfsUrl ?? null,
        }),
        ...(tableFallback && { primaryTableId: tableFallback.id }),
        // Vorschläge zu diesem Layer sind gegenstandslos, ihre action() würde
        // sonst auf eine nicht mehr existierende Layer-ID schreiben
        pendingSuggestions: state.pendingSuggestions.filter(
          (s) => s.layerId !== id
        ),
      };
    });
  },

  updateLayer: (id, patch) => {
    set((state) => {
      const newLayers = state.layers.map((l) =>
        l.id === id ? { ...l, ...patch } : l
      );

      const primaryLayer = newLayers.find((l) => l.id === state.primaryLayerId);
      return {
        layers: newLayers,
        geoJsonData: primaryLayer?.geoJson ?? state.geoJsonData, // Legacy-Sync
      };
    });
  },

  setPrimaryLayer: (id) => {
    set((state) => {
      const layer = state.layers.find((l) => l.id === id);
      return {
        primaryLayerId: id,
        primaryTableId: null, // nur eine Quelle speist gleichzeitig die Analytics-Widgets
        geoJsonData: layer?.geoJson ?? null,
        availableAttributes: [],
        selectedWfsUrl: layer?.wfsUrl ?? null,
      };
    });
  },

  clearLayers: () =>
    set((state) => ({
      layers: [],
      primaryLayerId: null,
      selectedWfsUrl: null,
      selectedDataset: null,
      pendingSuggestions: [],
      // Siehe removeLayer: nur anfassen, wenn tatsächlich ein Layer (und
      // nicht eine Tabelle) die Analytics-Widgets gespeist hat – dann
      // übernimmt eine vorhandene Tabelle
      ...(state.primaryLayerId !== null && {
        primaryTableId: state.tables[0]?.id ?? null,
        geoJsonData: state.tables[0]?.geoJson ?? null,
        availableAttributes: [],
      }),
    })),

  // Tabellen-Actions (siehe removeLayer/clearLayers für die Begründung der
  // wechselseitigen Absicherung zwischen Layer- und Tabellen-Primärquelle)

  addTable: (tableData) => {
    const state = get();
    const id = `table-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newTable: DataTable = { ...tableData, id };

    // Erste Tabelle wird automatisch primär – aber nur, wenn noch nichts
    // anderes (auch kein Layer) die Analytics-Widgets speist
    const isPrimary = state.tables.length === 0 && state.layers.length === 0;

    set((s) => ({
      tables: [...s.tables, newTable],
      primaryTableId: isPrimary ? id : s.primaryTableId,
      ...(isPrimary && {
        geoJsonData: newTable.geoJson,
        availableAttributes: [],
      }),
    }));

    return id;
  },

  removeTable: (id) => {
    set((state) => {
      const newTables = state.tables.filter((t) => t.id !== id);

      if (state.primaryTableId !== id) {
        // Entfernte Tabelle war nicht primär: Analytics-Ziel bleibt unverändert
        return { tables: newTables };
      }

      const fallback = newTables[0] ?? null;
      if (!fallback) {
        // Letzte Tabelle entfernt: auf einen vorhandenen Layer zurückfallen,
        // statt die Widgets leer zu lassen, obwohl noch Daten geladen sind
        return { tables: newTables, primaryTableId: null, ...primaryLayerFallback(state.layers) };
      }
      return {
        tables: newTables,
        primaryTableId: fallback.id,
        geoJsonData: fallback.geoJson,
        availableAttributes: [],
      };
    });
  },

  updateTable: (id, patch) => {
    set((state) => {
      const newTables = state.tables.map((t) => (t.id === id ? { ...t, ...patch } : t));
      const primaryTable = newTables.find((t) => t.id === state.primaryTableId);
      return {
        tables: newTables,
        geoJsonData: primaryTable?.geoJson ?? state.geoJsonData,
      };
    });
  },

  setPrimaryTable: (id) => {
    set((state) => {
      const table = state.tables.find((t) => t.id === id);
      return {
        primaryTableId: id,
        primaryLayerId: null, // nur eine Quelle speist gleichzeitig die Analytics-Widgets
        geoJsonData: table?.geoJson ?? null,
        availableAttributes: [],
        selectedWfsUrl: null,
      };
    });
  },

  clearTables: () =>
    set((state) => ({
      tables: [],
      primaryTableId: null,
      // Siehe removeTable: ein vorhandener Layer übernimmt die Widgets
      ...(state.primaryTableId !== null && primaryLayerFallback(state.layers)),
    })),

  // Legacy Actions

  setSelectedDatasetAndWfsUrl: (dataset, wfsUrl) =>
    set({
      selectedDataset: dataset,
      selectedWfsUrl: wfsUrl,
      geoJsonData: null,
      availableAttributes: [],
      isMapLoading: false,
    }),

  setSelectedDataset: (dataset) =>
    set({
      selectedDataset: dataset,
      selectedWfsUrl: dataset?.wfsUrl ?? null,
      geoJsonData: null,
      availableAttributes: [],
      isMapLoading: false,
    }),

  setGeoJsonData: (data: FeatureCollection | null) => set({ geoJsonData: data }),
  setAvailableAttributes: (attributes: string[]) => set({ availableAttributes: attributes }),
  setIsMapLoading: (isMapLoading: boolean) => set({ isMapLoading }),

  // Layout & Dashboards Actions
  setWidgetOrder: (order: string[]) => set({ widgetOrder: order }),
  toggleWidgetVisibility: (id: string) =>
    set((state) => ({
      hiddenWidgets: state.hiddenWidgets.includes(id)
        ? state.hiddenWidgets.filter((wId) => wId !== id)
        : [...state.hiddenWidgets, id],
    })),

  // Cross-Filtering Actions
  setChartFilter: (filter) => set({ chartFilter: filter }),
  setMapBoundsFilter: (bounds) => set({ mapBoundsFilter: bounds }),

  setVisualAnalyticsAttribute: (attr) => set({ visualAnalyticsAttribute: attr }),
  setCorrelationAttributes: (x, y) => set({ correlationX: x, correlationY: y }),
  setTemporalConfig: (attr, valAttr, cType) => set({
    temporalAttribute: attr,
    temporalValueAttr: valAttr,
    temporalChartType: cType
  }),

  // Suggestions Actions
  setPendingSuggestions: (suggestions) => set({ pendingSuggestions: suggestions }),
  removeSuggestion: (id) => set((state) => ({
    pendingSuggestions: state.pendingSuggestions.filter(s => s.id !== id)
  })),
  clearPendingSuggestions: () => set({ pendingSuggestions: [] }),
}));
