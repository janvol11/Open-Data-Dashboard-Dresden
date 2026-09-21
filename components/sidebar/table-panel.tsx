"use client";

import { useShallow } from "zustand/react/shallow";
import { useDashboardStore, DataTable } from "@/store/useDashboardStore";
import { Trash2, Table2, ChevronDown, ChevronUp, Star, Link2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { JoinDialog } from "./join-dialog";

function TableRow({ table, onJoin }: { table: DataTable; onJoin: () => void }) {
  const { removeTable, setPrimaryTable, primaryTableId } = useDashboardStore(
    useShallow((s) => ({
      removeTable: s.removeTable,
      setPrimaryTable: s.setPrimaryTable,
      primaryTableId: s.primaryTableId,
    }))
  );
  const isPrimary = table.id === primaryTableId;
  const rowCount = table.geoJson.features.length;
  const columnCount = rowCount > 0 ? Object.keys(table.geoJson.features[0].properties ?? {}).length : 0;

  return (
    <div
      className={cn(
        "flex items-start gap-2 p-2.5 rounded-lg border transition-all",
        isPrimary ? "border-l-2 border-l-primary bg-muted/30" : "border-border bg-card hover:bg-muted/20"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Table2 className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium truncate leading-tight" title={table.label}>
            {table.label}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground pl-[18px]">
          {rowCount.toLocaleString("de-DE")} Zeilen · {columnCount} Spalten
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onJoin}
          title="Mit Geometrie verknüpfen"
          className="p-1 rounded hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors"
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>

        {!isPrimary && (
          <button
            onClick={() => setPrimaryTable(table.id)}
            title="Als primäre Quelle für Analytics setzen"
            className="p-1 rounded hover:bg-amber-100 hover:text-amber-600 text-muted-foreground transition-colors"
          >
            <Star className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          onClick={() => removeTable(table.id)}
          title="Tabelle entfernen"
          className="p-1 rounded hover:bg-red-50 hover:text-red-500 text-muted-foreground transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function TablePanel() {
  const { tables, clearTables } = useDashboardStore(
    useShallow((s) => ({
      tables: s.tables,
      clearTables: s.clearTables,
    }))
  );
  const [collapsed, setCollapsed] = useState(false);
  const [joinTableId, setJoinTableId] = useState<string | null>(null);
  const joinTable = tables.find((t) => t.id === joinTableId) ?? null;

  if (tables.length === 0) return null;

  return (
    <div id="tour-table-panel" className="border-t bg-card/50">
      {/* Kein äußeres <button>: siehe layer-panel.tsx für die Begründung. */}
      <div className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors">
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls="table-panel-list"
          className="flex flex-1 min-w-0 items-center gap-2 text-left"
        >
          <Table2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold text-foreground">
            Tabellen ({tables.length})
          </span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={clearTables}
            className="text-[10px] text-muted-foreground hover:text-destructive transition-colors px-1"
            title="Alle Tabellen entfernen"
          >
            Alle löschen
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-controls="table-panel-list"
            aria-label={collapsed ? "Tabellenliste ausklappen" : "Tabellenliste einklappen"}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div id="table-panel-list" className="px-3 pb-3 flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          {tables.map((table) => (
            <TableRow key={table.id} table={table} onJoin={() => setJoinTableId(table.id)} />
          ))}
          <p className="text-[10px] text-muted-foreground text-center pt-1">
            Die markierte Tabelle ist die Grundlage aller Auswertungen
          </p>
        </div>
      )}

      {joinTable && <JoinDialog table={joinTable} onClose={() => setJoinTableId(null)} />}
    </div>
  );
}
