"use client";

import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDashboardStore } from "@/store/useDashboardStore";
import { useAnalysisData } from "@/hooks/use-analysis-data";
import { inferTableColumns, type TableColumn } from "@/lib/table-utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Erste Seite an Zeilen, danach wird in diesen Schritten nachgeladen (siehe "Mehr laden" andernorts in der App). */
const PAGE_SIZE = 100;

const TYPE_LABEL: Record<TableColumn["type"], string> = {
  number: "Zahl",
  string: "Text",
  boolean: "Ja/Nein",
  unknown: "?",
};

/** Roh-Zellwert für die Anzeige aufbereiten; unverändert lassen, wo Formatierung Bedeutung verfälschen würde (Codes!). */
function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "number") return value.toLocaleString("de-DE");
  return String(value);
}

export function AttributeTable() {
  const { layers, tables, primaryLayerId, primaryTableId } = useDashboardStore(
    useShallow((s) => ({
      layers: s.layers,
      tables: s.tables,
      primaryLayerId: s.primaryLayerId,
      primaryTableId: s.primaryTableId,
    }))
  );

  const sourceLabel = useMemo(() => {
    if (primaryTableId) return tables.find((t) => t.id === primaryTableId)?.label ?? null;
    if (primaryLayerId) return layers.find((l) => l.id === primaryLayerId)?.label ?? null;
    return null;
  }, [primaryTableId, primaryLayerId, tables, layers]);

  // Derselbe gefilterte Ausschnitt wie in den übrigen Widgets (zentral berechnet)
  const { geoJsonData, dataToAnalyze } = useAnalysisData();

  const columns = useMemo(
    () => (dataToAnalyze ? inferTableColumns(dataToAnalyze) : []),
    [dataToAnalyze]
  );

  // Bei jedem neuen Datensatz (auch nach Kartenausschnitt-Filter) wieder von
  // vorn beginnen – direkt beim Rendern angepasst statt in einem Effect,
  // das spart einen zusätzlichen Render-Durchlauf
  const [prevData, setPrevData] = useState(dataToAnalyze);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  if (dataToAnalyze !== prevData) {
    setPrevData(dataToAnalyze);
    setVisibleCount(PAGE_SIZE);
  }

  if (!geoJsonData || columns.length === 0) {
    return (
      <div className="w-full h-full flex flex-col">
        <h3 className="font-medium text-sm flex items-center gap-2 mb-3">
          <Table2 className="h-4 w-4 text-indigo-500" />
          Attributtabelle
        </h3>
        <div className="flex-1 rounded-lg border border-dashed flex flex-col items-center justify-center text-muted-foreground text-sm p-4 text-center">
          <Table2 className="h-8 w-8 mb-2 opacity-50" />
          <p>Wähle einen Datensatz aus</p>
          <span className="text-xs opacity-70">Layer und Tabellen erscheinen hier als Rohdaten</span>
        </div>
      </div>
    );
  }

  const totalRows = dataToAnalyze!.features.length;
  const rows = dataToAnalyze!.features.slice(0, visibleCount).map((f) => f.properties ?? {});

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="font-medium text-sm flex items-center gap-2 min-w-0">
          <Table2 className="h-4 w-4 text-indigo-500 shrink-0" />
          <span className="truncate">Attributtabelle{sourceLabel ? ` – ${sourceLabel}` : ""}</span>
        </h3>
        <span className="shrink-0 text-xs font-medium text-muted-foreground bg-background border rounded-full px-2 py-0.5 tabular-nums">
          {totalRows.toLocaleString("de-DE")} Zeilen · {columns.length} Spalten
        </span>
      </div>

      <div className="bg-background rounded-lg border flex-1 overflow-hidden flex flex-col">
        <ScrollArea className="flex-1">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-muted/30 backdrop-blur-sm z-10">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.name}
                      scope="col"
                      className={cn(
                        "px-3 py-2 border-b font-medium whitespace-nowrap",
                        col.type === "number" && !col.isCode ? "text-right" : "text-left"
                      )}
                      title={col.isCode ? "Numerisch lesbar, aber als Code geführt (z.B. führende Nullen) – bleibt für Schlüsselvergleiche als Text erhalten" : undefined}
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="truncate max-w-[16ch]">{col.name}</span>
                        <span className="text-[9px] font-mono font-normal text-muted-foreground uppercase tracking-wide">
                          {col.isCode ? "Code" : TYPE_LABEL[col.type]}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-muted/30 transition-colors">
                    {columns.map((col) => {
                      const value = row[col.name];
                      const isNumeric = col.type === "number" && !col.isCode;
                      return (
                        <td
                          key={col.name}
                          className={cn(
                            "px-3 py-1.5 border-b border-border/60 whitespace-nowrap",
                            isNumeric ? "text-right tabular-nums" : "text-left",
                            col.isCode && "font-mono text-muted-foreground"
                          )}
                        >
                          {formatCell(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ScrollArea>

        {visibleCount < totalRows && (
          <button
            onClick={() => setVisibleCount((c) => Math.min(c + PAGE_SIZE, totalRows))}
            className="shrink-0 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 border-t transition-colors"
          >
            {visibleCount.toLocaleString("de-DE")} von {totalRows.toLocaleString("de-DE")} Zeilen –
            weitere {Math.min(PAGE_SIZE, totalRows - visibleCount).toLocaleString("de-DE")} anzeigen
          </button>
        )}
      </div>
    </div>
  );
}
