"use client";

import { useShallow } from "zustand/react/shallow";
import { useDashboardStore } from "@/store/useDashboardStore";
import {
  Flame,
  Palette,
  Calendar,
  TrendingUp,
  BarChart2,
  AlertCircle,
  Zap,
  X,
  Check,
  ChevronDown,
  ChevronUp,
  CheckCheck,
  Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "motion/react";
import { useState, useCallback, useMemo } from "react";
import type { Suggestion, SuggestionType } from "@/lib/dataset-suggestions";

const TYPE_CONFIG: Record<
  SuggestionType,
  { icon: React.ElementType; color: string; badge: string }
> = {
  HEATMAP: {
    icon: Flame,
    color: "text-orange-500",
    badge: "Visualisierung",
  },
  THEMATIC_NUMERIC: {
    icon: Palette,
    color: "text-blue-500",
    badge: "Styling",
  },
  THEMATIC_CATEGORICAL: {
    icon: Palette,
    color: "text-violet-500",
    badge: "Styling",
  },
  TEMPORAL_FOCUS: {
    icon: Calendar,
    color: "text-emerald-500",
    badge: "Zeitreihe",
  },
  CORRELATION: {
    icon: TrendingUp,
    color: "text-pink-500",
    badge: "Analyse",
  },
  VISUAL_ANALYTICS: {
    icon: BarChart2,
    color: "text-cyan-500",
    badge: "Diagramm",
  },
  DATA_QUALITY: {
    icon: AlertCircle,
    color: "text-amber-500",
    badge: "Qualität",
  },
  LARGE_DATASET: {
    icon: Zap,
    color: "text-yellow-500",
    badge: "Performance",
  },
  CLUSTERING: {
    icon: Lightbulb,
    color: "text-indigo-500",
    badge: "Clustering",
  },
};

// `Suggestion.meta` ist ein offenes Record (jeder Typ liefert andere Kennzahlen);
// diese Lesefunktionen prüfen die Struktur zur Laufzeit und liefern null bei Fehlen.

interface CategoryEntry {
  name: string;
  percentage: number;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every((entry) => typeof entry === "string") ? (value as string[]) : null;
}

function readCategoryList(value: unknown): CategoryEntry[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const valid = value.every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as CategoryEntry).name === "string"
  );
  return valid ? (value as CategoryEntry[]) : null;
}

function PriorityBar({ priority }: { priority: number }) {
  // Priorität 0–100 → 1–4 Punkte
  const bars = Math.min(4, Math.max(1, Math.ceil(priority / 25)));
  return (
    <div className="flex gap-0.5 items-center" title={`Priorität: ${priority}`}>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`h-1.5 w-1.5 rounded-full transition-colors ${
            i <= bars
              ? "bg-primary"
              : "bg-muted-foreground/20"
          }`}
        />
      ))}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onApply,
  onDismiss,
}: {
  suggestion: Suggestion;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const config = TYPE_CONFIG[suggestion.type] ?? {
    icon: Lightbulb,
    color: "text-primary",
    badge: "Vorschlag",
  };
  const Icon = config.icon;

  const correlation = readNumber(suggestion.meta?.r);
  const palette = readStringArray(suggestion.meta?.palette);
  const topCategories = readCategoryList(suggestion.meta?.topCategories);

  return (
    <div className="bg-card text-card-foreground border shadow-lg rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Icon className={`h-3.5 w-3.5 ${config.color} shrink-0`} />
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-muted ${config.color}`}
          >
            {config.badge}
          </span>
          <PriorityBar priority={suggestion.priority} />
        </div>
        <button
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors rounded-sm p-0.5 hover:bg-muted"
          title="Ignorieren (für diese Session)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 py-2.5">
        <h4 className="text-sm font-semibold mb-1 leading-snug">{suggestion.title}</h4>
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
          {suggestion.description}
        </p>

        {suggestion.type === "CORRELATION" && correlation !== null && (
          <div className="mb-2.5 flex items-center gap-2 px-2 py-1.5 bg-muted/40 rounded-md">
            <TrendingUp className="h-3 w-3 text-pink-500 shrink-0" />
            <span className="text-xs font-mono font-medium text-foreground">
              r = {correlation.toFixed(3)}
            </span>
            <div
              className="ml-auto h-1.5 rounded-full bg-gradient-to-r from-blue-400 to-pink-500"
              style={{ width: `${Math.abs(correlation) * 56}px` }}
            />
          </div>
        )}

        {suggestion.type === "THEMATIC_NUMERIC" && palette && (
          <div className="mb-2.5 flex gap-1">
            {palette.map((c, i) => (
              <div
                key={i}
                className="h-3 flex-1 rounded-sm first:rounded-l-md last:rounded-r-md"
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        )}

        {suggestion.type === "THEMATIC_CATEGORICAL" && topCategories && (
          <div className="mb-2.5 flex flex-wrap gap-1">
            {topCategories.slice(0, 4).map((cat, i) => (
              <span
                key={i}
                className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full truncate max-w-[80px]"
                title={cat.name}
              >
                {cat.name}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1 h-7 text-xs bg-primary hover:bg-primary/90"
            onClick={onApply}
          >
            <Check className="h-3 w-3 mr-1" />
            Anwenden
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-7 text-xs"
            onClick={onDismiss}
          >
            Ignorieren
          </Button>
        </div>
      </div>
    </div>
  );
}

function persistDismissed(id: string) {
  try {
    const raw = localStorage.getItem("dismissed-suggestion-ids");
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (!ids.includes(id)) {
      ids.push(id);
      if (ids.length > 200) ids.shift(); // älteste ID verdrängen
      localStorage.setItem("dismissed-suggestion-ids", JSON.stringify(ids));
    }
  } catch {
    // localStorage nicht verfügbar: still ignorieren
  }
}

export function SuggestionPanel() {
  const { pendingSuggestions, removeSuggestion, clearPendingSuggestions } = useDashboardStore(
    useShallow((s) => ({
      pendingSuggestions: s.pendingSuggestions,
      removeSuggestion: s.removeSuggestion,
      clearPendingSuggestions: s.clearPendingSuggestions,
    }))
  );

  // Initial nur den Top-Vorschlag zeigen, der Rest ist klappbar
  const [expanded, setExpanded] = useState(false);

  // Vorschläge mehrerer Layer landen blockweise in der Queue; global sortieren,
  // damit oben wirklich der relevanteste steht
  const orderedSuggestions = useMemo(
    () => [...pendingSuggestions].sort((a, b) => b.priority - a.priority),
    [pendingSuggestions]
  );

  const handleDismiss = useCallback(
    (suggestion: Suggestion) => {
      persistDismissed(suggestion.id);
      removeSuggestion(suggestion.id);
      if (pendingSuggestions.length <= 1) setExpanded(false);
    },
    [pendingSuggestions.length, removeSuggestion]
  );

  const handleApply = useCallback(
    (suggestion: Suggestion) => {
      const store = useDashboardStore.getState();
      suggestion.action(store, suggestion.layerId);
      removeSuggestion(suggestion.id);

      if (pendingSuggestions.length <= 1) setExpanded(false);
    },
    [pendingSuggestions.length, removeSuggestion]
  );

  const handleApplyAll = useCallback(() => {
    const store = useDashboardStore.getState();
    // Je Layer nur den ersten (höchstpriorisierten) Vorschlag einer Konfliktgruppe
    // anwenden, sonst überschreibt der letzte alle vorherigen still
    const claimedGroups = new Set<string>();

    for (const suggestion of orderedSuggestions) {
      if (suggestion.conflictGroup) {
        const groupKey = `${suggestion.layerId}:${suggestion.conflictGroup}`;
        if (claimedGroups.has(groupKey)) continue;
        claimedGroups.add(groupKey);
      }
      suggestion.action(store, suggestion.layerId);
    }

    clearPendingSuggestions();
    setExpanded(false);
  }, [orderedSuggestions, clearPendingSuggestions]);

  if (orderedSuggestions.length === 0) return null;

  const topSuggestion = orderedSuggestions[0];
  const restSuggestions = orderedSuggestions.slice(1);
  const hasMore = restSuggestions.length > 0;

  return (
    <div className="absolute top-4 right-4 z-[1000] w-80 max-w-[calc(100vw-2rem)] flex flex-col gap-2">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={topSuggestion.id}
          initial={{ opacity: 0, x: 50, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9, x: 30, transition: { duration: 0.18 } }}
          layout
        >
          <SuggestionCard
            suggestion={topSuggestion}
            onApply={() => handleApply(topSuggestion)}
            onDismiss={() => handleDismiss(topSuggestion)}
          />
        </motion.div>

        {expanded &&
          restSuggestions.map((suggestion) => (
            <motion.div
              key={suggestion.id}
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.93, transition: { duration: 0.15 } }}
              layout
            >
              <SuggestionCard
                suggestion={suggestion}
                onApply={() => handleApply(suggestion)}
                onDismiss={() => handleDismiss(suggestion)}
              />
            </motion.div>
          ))}
      </AnimatePresence>

      {hasMore && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-between px-1"
        >
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" />
                Weniger anzeigen
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                {restSuggestions.length} weitere{restSuggestions.length > 1 ? " Vorschläge" : "r Vorschlag"}
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={handleApplyAll}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
              title="Alle Vorschläge anwenden"
            >
              <CheckCheck className="h-3 w-3" />
              Alle anwenden
            </button>
            <span className="text-muted-foreground/40">·</span>
            <button
              onClick={() => {
                clearPendingSuggestions();
                setExpanded(false);
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-2 transition-colors"
            >
              Alle verwerfen
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
