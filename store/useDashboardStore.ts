// Globaler Store (zustand). Es können mehrere Layer gleichzeitig geladen sein.

import { create } from "zustand";
import { DresdenDataset } from "@/types/dresden-data";
import type { FeatureCollection } from "geojson";
import type { Suggestion } from "@/lib/dataset-suggestions";

// Eine Farbe pro Layer, ab dem neunten wiederholt sich die Liste
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

/** Ein Datensatz auf der Karte: WFS, CSV mit Koordinaten oder Join-Ergebnis. */
export interface MapLayer {
  id: string;
  /** Titel des Datensatzes, bis zur Capabilities-Antwort der Hostname */
  label: string;
  wfsUrl: string;
  /** Layer-Name aus GetCapabilities */
  typeName: string | null;
  geoJson: FeatureCollection | null;
  color: LayerColor;
  visible: boolean;
  isLoading: boolean;
  /** 0 bis 1 */
  opacity: number;
  renderAsHeatmap?: boolean;
  thematicStyling?: {
    attribute: string;
    type: "numeric" | "categorical";
    colors: string[];
    /** Obere Klassengrenzen, nur bei "numeric" */
    ranges?: number[];
  };
}

/**
 * CSV ohne erkennbare Geometrie. Erscheint nicht auf der Karte, kann aber die
 * Auswertungen speisen. Die Zeilen liegen trotzdem als FeatureCollection mit
 * geometry: null vor, weil Statistik und Diagramme nur properties lesen.
 */
export interface DataTable {
  id: string;
  /** Dateiname */
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
  /** In Ladereihenfolge */
  layers: MapLayer[];
  /** Layer, aus dem die Auswertungen rechnen */
  primaryLayerId: string | null;

  // Tabellen (CSV ohne Geometrie)
  tables: DataTable[];
  /**
   * Tabelle, aus der die Auswertungen rechnen. Es ist immer höchstens eine
   * Quelle primär, also ist entweder primaryLayerId oder primaryTableId gesetzt.
   */
  primaryTableId: string | null;

  /** Daten der primären Quelle (Layer oder Tabelle) */
  geoJsonData: FeatureCollection | null;

  // Cross-Filtering
  chartFilter: { attribute: string; value: string | number } | null;
  mapBoundsFilter: [[number, number], [number, number]] | null;

  // Einstellungen der Auswertungs-Widgets
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

  /** Gibt die ID des neuen Layers zurück. */
  addLayer: (layer: Omit<MapLayer, "id" | "color" | "opacity">) => string;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<MapLayer>) => void;
  setPrimaryLayer: (id: string) => void;
  clearLayers: () => void;

  /** Gibt die ID der neuen Tabelle zurück. */
  addTable: (table: Omit<DataTable, "id">) => string;
  removeTable: (id: string) => void;
  updateTable: (id: string, patch: Partial<DataTable>) => void;
  setPrimaryTable: (id: string) => void;
  clearTables: () => void;

  // Layout & Dashboards
  widgetOrder: string[];
  hiddenWidgets: string[];
  setWidgetOrder: (order: string[]) => void;
  toggleWidgetVisibility: (id: string) => void;

  // Cross-Filtering
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

// Erste freie Farbe. Sind alle vergeben, geht es reihum weiter.
function nextColor(layers: MapLayer[]): LayerColor {
  const used = new Set(layers.map((l) => l.color));
  return LAYER_COLORS.find((c) => !used.has(c)) ?? LAYER_COLORS[layers.length % LAYER_COLORS.length];
}

// Wird die primäre Tabelle entfernt, übernimmt der erste Layer (falls es einen gibt).
function primaryLayerFallback(layers: MapLayer[]): Partial<DashboardState> {
  const layer = layers[0] ?? null;
  return {
    primaryLayerId: layer?.id ?? null,
    geoJsonData: layer?.geoJson ?? null,
  };
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
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

  // Layer

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

    // Primär nur, solange noch gar nichts geladen ist. Eine aktive Tabelle
    // soll nicht einfach verdrängt werden.
    const isPrimary = state.layers.length === 0 && state.tables.length === 0;

    set((s) => ({
      layers: [...s.layers, newLayer],
      primaryLayerId: isPrimary ? id : s.primaryLayerId,
      ...(isPrimary && { geoJsonData: layerData.geoJson }),
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

      // Ist gerade eine Tabelle primär, bleibt geoJsonData unverändert
      const layerWasPrimarySource = state.primaryLayerId !== null;

      // Letzter Layer weg: eine vorhandene Tabelle rückt nach
      const tableFallback = layerWasPrimarySource && !primaryLayer ? state.tables[0] ?? null : null;

      return {
        layers: newLayers,
        primaryLayerId: newPrimary,
        ...(layerWasPrimarySource && {
          geoJsonData: primaryLayer?.geoJson ?? tableFallback?.geoJson ?? null,
        }),
        ...(tableFallback && { primaryTableId: tableFallback.id }),
        // Vorschläge für den gelöschten Layer sind hinfällig
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
        geoJsonData: primaryLayer?.geoJson ?? state.geoJsonData,
      };
    });
  },

  setPrimaryLayer: (id) => {
    set((state) => {
      const layer = state.layers.find((l) => l.id === id);
      return {
        primaryLayerId: id,
        primaryTableId: null,
        geoJsonData: layer?.geoJson ?? null,
      };
    });
  },

  clearLayers: () =>
    set((state) => ({
      layers: [],
      primaryLayerId: null,
      pendingSuggestions: [],
      // War ein Layer primär, rückt eine vorhandene Tabelle nach
      ...(state.primaryLayerId !== null && {
        primaryTableId: state.tables[0]?.id ?? null,
        geoJsonData: state.tables[0]?.geoJson ?? null,
      }),
    })),

  // Tabellen

  addTable: (tableData) => {
    const state = get();
    const id = `table-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newTable: DataTable = { ...tableData, id };

    // Wie bei addLayer: primär nur, wenn noch nichts geladen ist
    const isPrimary = state.tables.length === 0 && state.layers.length === 0;

    set((s) => ({
      tables: [...s.tables, newTable],
      primaryTableId: isPrimary ? id : s.primaryTableId,
      ...(isPrimary && {
        geoJsonData: newTable.geoJson,
      }),
    }));

    return id;
  },

  removeTable: (id) => {
    set((state) => {
      const newTables = state.tables.filter((t) => t.id !== id);

      if (state.primaryTableId !== id) {
        return { tables: newTables };
      }

      const fallback = newTables[0] ?? null;
      if (!fallback) {
        // Letzte Tabelle weg: ein Layer übernimmt, falls vorhanden
        return { tables: newTables, primaryTableId: null, ...primaryLayerFallback(state.layers) };
      }
      return {
        tables: newTables,
        primaryTableId: fallback.id,
        geoJsonData: fallback.geoJson,
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
        primaryLayerId: null,
        geoJsonData: table?.geoJson ?? null,
      };
    });
  },

  clearTables: () =>
    set((state) => ({
      tables: [],
      primaryTableId: null,
      ...(state.primaryTableId !== null && primaryLayerFallback(state.layers)),
    })),

  // Layout
  setWidgetOrder: (order: string[]) => set({ widgetOrder: order }),
  toggleWidgetVisibility: (id: string) =>
    set((state) => ({
      hiddenWidgets: state.hiddenWidgets.includes(id)
        ? state.hiddenWidgets.filter((wId) => wId !== id)
        : [...state.hiddenWidgets, id],
    })),

  // Cross-Filtering
  setChartFilter: (filter) => set({ chartFilter: filter }),
  setMapBoundsFilter: (bounds) => set({ mapBoundsFilter: bounds }),

  setVisualAnalyticsAttribute: (attr) => set({ visualAnalyticsAttribute: attr }),
  setCorrelationAttributes: (x, y) => set({ correlationX: x, correlationY: y }),
  setTemporalConfig: (attr, valAttr, cType) => set({
    temporalAttribute: attr,
    temporalValueAttr: valAttr,
    temporalChartType: cType
  }),

  // Vorschläge
  setPendingSuggestions: (suggestions) => set({ pendingSuggestions: suggestions }),
  removeSuggestion: (id) => set((state) => ({
    pendingSuggestions: state.pendingSuggestions.filter(s => s.id !== id)
  })),
  clearPendingSuggestions: () => set({ pendingSuggestions: [] }),
}));
