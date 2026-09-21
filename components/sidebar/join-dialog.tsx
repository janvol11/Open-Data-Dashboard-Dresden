"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Link2, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDashboardStore, DataTable } from "@/store/useDashboardStore";
import { inferTableColumns } from "@/lib/table-utils";
import { detectTimeAttributes } from "@/lib/time-utils";
import { detectBezugsebene, Bezugsebene } from "@/lib/bezugsebenen";
import { joinTableToGeometry, suggestResultAttributeName, AggregateMethod, JoinMetric, JoinReport } from "@/lib/join-utils";
import { buildThematicStyling } from "@/lib/thematic-styling";
import { fetchWfsFeatures } from "@/lib/wfs-service";

/** Spalte, aus deren Namen sich eine Bezugsebene erkennen ließ. */
interface CandidateColumn {
  column: string;
  ebene: Bezugsebene;
}

const AGGREGATE_OPTIONS: { value: AggregateMethod; label: string }[] = [
  { value: "sum", label: "Summe" },
  { value: "mean", label: "Mittelwert" },
  { value: "count", label: "Anzahl Zeilen" },
];

/** Maximal in der Liste angezeigte Namen, bevor auf "+N weitere" umgeschaltet wird (vgl. Popup-/Legenden-Konvention andernorts). */
const MAX_REPORT_ROWS = 12;

function ReportList({ title, items, tone }: { title: string; items: string[]; tone: "warn" | "muted" }) {
  if (items.length === 0) return null;
  const visible = items.slice(0, MAX_REPORT_ROWS);
  const rest = items.length - visible.length;

  return (
    <div className={tone === "warn" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
      <p className="text-xs font-medium mb-1">{title} ({items.length})</p>
      <p className="text-[11px] leading-relaxed break-words">
        {visible.join(", ")}
        {rest > 0 && ` +${rest} weitere`}
      </p>
    </div>
  );
}

function JoinReportView({ report, resultLabel }: { report: JoinReport; resultLabel: string }) {
  const allGood = report.unmatchedFeatureNames.length === 0 && report.unmatchedKeyValues.length === 0;

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center gap-2">
        {allGood ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        )}
        <p className="text-xs font-medium">
          {report.matchedFeatures} von {report.totalFeatures} Geometrien erhielten „{resultLabel}“ ·{" "}
          {report.matchedKeys} von {report.totalKeys} Tabellenschlüsseln fanden eine Geometrie
        </p>
      </div>

      <ReportList
        title="Geometrien ohne Daten"
        items={report.unmatchedFeatureNames}
        tone={report.unmatchedFeatureNames.length > 0 ? "warn" : "muted"}
      />
      <ReportList
        title="Tabellenschlüssel ohne Geometrie"
        items={report.unmatchedKeyValues}
        tone={report.unmatchedKeyValues.length > 0 ? "warn" : "muted"}
      />
      {report.unparsableRows > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {report.unparsableRows} Tabellenzeile{report.unparsableRows === 1 ? "" : "n"} ohne lesbaren Schlüsselwert übersprungen.
        </p>
      )}
    </div>
  );
}

export function JoinDialog({ table, onClose }: { table: DataTable; onClose: () => void }) {
  const addLayer = useDashboardStore((s) => s.addLayer);
  const updateLayer = useDashboardStore((s) => s.updateLayer);

  const columns = useMemo(() => inferTableColumns(table.geoJson), [table.geoJson]);
  const timeColumn = useMemo(() => detectTimeAttributes(table.geoJson)[0] ?? null, [table.geoJson]);

  // Die Zeitspalte (meist "Jahr") ist numerisch lesbar, aber als Kennzahl
  // sinnlos – sie dient bereits als Zeitfilter, nicht als Wert zum Aggregieren
  const numericColumns = useMemo(
    () => columns.filter((c) => c.type === "number" && !c.isCode && c.name !== timeColumn).map((c) => c.name),
    [columns, timeColumn]
  );

  const candidates = useMemo<CandidateColumn[]>(() => {
    const found: CandidateColumn[] = [];
    for (const col of columns) {
      const ebene = detectBezugsebene(col.name);
      if (ebene) found.push({ column: col.name, ebene });
    }
    // Ebenen mit Geometrie zuerst, damit der Default direkt einsatzbereit ist
    return found.sort((a, b) => Number(!!b.ebene.geometry) - Number(!!a.ebene.geometry));
  }, [columns]);

  const columnOptions = useMemo(
    () => candidates.map((c) => ({ value: c.column, label: `${c.column} → ${c.ebene.label}` })),
    [candidates]
  );

  const [selectedColumn, setSelectedColumn] = useState(candidates[0]?.column ?? "");
  const selectedCandidate = candidates.find((c) => c.column === selectedColumn) ?? candidates[0];
  const timeValues = useMemo(() => {
    if (!timeColumn) return [];
    const values = new Set<string>();
    for (const feature of table.geoJson.features) {
      const v = feature.properties?.[timeColumn];
      if (v !== null && v !== undefined && v !== "") values.add(String(v));
    }
    return [...values].sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
  }, [table.geoJson, timeColumn]);
  const needsTimeFilter = timeValues.length > 1;
  const [selectedTimeValue, setSelectedTimeValue] = useState(timeValues[timeValues.length - 1] ?? "");

  const [metricMode, setMetricMode] = useState<"ratio" | "aggregate">(
    numericColumns.length >= 2 ? "ratio" : "aggregate"
  );
  const [numerator, setNumerator] = useState(numericColumns[0] ?? "");
  const [denominator, setDenominator] = useState(numericColumns[1] ?? numericColumns[0] ?? "");
  const [aggregateColumn, setAggregateColumn] = useState(numericColumns[0] ?? "");
  const [aggregateMethod, setAggregateMethod] = useState<AggregateMethod>("sum");

  const [isJoining, setIsJoining] = useState(false);
  const [result, setResult] = useState<{ report: JoinReport; label: string } | null>(null);

  const metric: JoinMetric | null =
    metricMode === "ratio"
      ? numerator && denominator
        ? { kind: "ratio", numerator, denominator, scale: 100 }
        : null
      : aggregateMethod === "count"
      ? { kind: "aggregate", column: "", method: "count" }
      : aggregateColumn
      ? { kind: "aggregate", column: aggregateColumn, method: aggregateMethod }
      : null;

  const canJoin =
    !!selectedCandidate &&
    !!selectedCandidate.ebene.geometry &&
    !!metric &&
    (!needsTimeFilter || !!selectedTimeValue) &&
    !isJoining;

  const handleJoin = async () => {
    if (!selectedCandidate || !metric) return;
    const { ebene } = selectedCandidate;
    const { geometry } = ebene;
    if (!geometry) return; // erneute Prüfung, damit TS geometry ab hier als nicht-null führt

    setIsJoining(true);
    try {
      let rows = table.geoJson.features.map((f) => f.properties ?? {});
      if (needsTimeFilter && timeColumn) {
        rows = rows.filter((r) => String(r[timeColumn]) === selectedTimeValue);
      }

      const geometryUrl = `https://kommisdd.dresden.de/net3/public/ogc.ashx?NodeId=${geometry.nodeId}&Service=WFS&Request=GetCapabilities`;
      const geoJson = await fetchWfsFeatures(geometryUrl, geometry.typeName);

      const resultAttribute = suggestResultAttributeName(metric);
      const { geoJson: joinedGeoJson, report } = joinTableToGeometry(
        rows,
        selectedCandidate.column,
        geoJson,
        ebene,
        metric,
        resultAttribute
      );

      const timeSuffix = needsTimeFilter ? ` ${selectedTimeValue}` : "";
      const label = `${table.label} × ${ebene.label}${timeSuffix}`;

      const layerId = addLayer({
        label,
        wfsUrl: `local-join://${table.id}-${ebene.id}-${Date.now()}`,
        typeName: geometry.typeName,
        geoJson: joinedGeoJson,
        visible: true,
        isLoading: false,
      });

      // Direkt einfärben statt einfarbig darzustellen – der Join wurde
      // explizit für diese Kennzahl angestoßen (vgl. data-stories.tsx)
      const freshLayer = useDashboardStore.getState().layers.find((l) => l.id === layerId);
      if (freshLayer) {
        updateLayer(layerId, {
          thematicStyling: buildThematicStyling(joinedGeoJson, resultAttribute, freshLayer.color),
        });
      }

      setResult({ report, label: resultAttribute });
      toast.success(`„${label}“ als neuer Layer angelegt.`, {
        description: `${report.matchedFeatures} von ${report.totalFeatures} Geometrien erhielten einen Wert.`,
      });
    } catch (error) {
      console.error("Join fehlgeschlagen:", error);
      toast.error("Verknüpfung fehlgeschlagen", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="join-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="join-panel"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: "spring", stiffness: 340, damping: 30 }}
        className="fixed inset-0 z-[10000] flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="pointer-events-auto w-full max-w-md max-h-[85vh] overflow-y-auto bg-card border shadow-2xl rounded-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-card z-10">
            <h3 className="font-medium text-sm flex items-center gap-2">
              <Link2 className="h-4 w-4 text-primary" />
              Mit Geometrie verknüpfen
            </h3>
            <button onClick={onClose} aria-label="Schließen" className="p-1 rounded hover:bg-muted text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <p className="text-xs text-muted-foreground truncate" title={table.label}>
              Tabelle: <span className="font-medium text-foreground">{table.label}</span>
            </p>

            {candidates.length === 0 ? (
              <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground text-center">
                Keine erkennbare Bezugsebene (Stadtteil, Stadtbezirk/Ortschaft, Statistischer Bezirk, Stadtraum)
                in den Spaltennamen gefunden. Diese Tabelle hat vermutlich keinen Raumbezug.
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Raumbezug-Spalte</label>
                  <Select items={columnOptions} value={selectedColumn || candidates[0].column} onValueChange={(v) => v && setSelectedColumn(v)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {columnOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedCandidate && !selectedCandidate.ebene.geometry && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      {selectedCandidate.ebene.note ?? "Für diese Ebene ist keine Geometrie hinterlegt."}
                    </p>
                  )}
                </div>

                {needsTimeFilter && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Zeitpunkt</label>
                    <Select value={selectedTimeValue} onValueChange={(v) => v && setSelectedTimeValue(v)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {timeValues.map((v) => (
                          <SelectItem key={v} value={v}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      „{timeColumn}“ hat {timeValues.length} verschiedene Werte – ohne Auswahl würde die Kennzahl über alle hinweg summiert.
                    </p>
                  </div>
                )}

                {numericColumns.length === 0 ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Keine numerischen Spalten gefunden – ohne Kennzahl ist keine Verknüpfung möglich.
                  </p>
                ) : (
                  <div className="space-y-2 pt-2 border-t">
                    <label className="text-xs font-medium">Kennzahl</label>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setMetricMode("ratio")}
                        className={`flex-1 h-7 text-[11px] font-medium rounded-md border transition-colors ${
                          metricMode === "ratio" ? "bg-primary text-primary-foreground border-primary" : "bg-muted/50 hover:bg-muted"
                        }`}
                      >
                        Verhältnis
                      </button>
                      <button
                        onClick={() => setMetricMode("aggregate")}
                        className={`flex-1 h-7 text-[11px] font-medium rounded-md border transition-colors ${
                          metricMode === "aggregate" ? "bg-primary text-primary-foreground border-primary" : "bg-muted/50 hover:bg-muted"
                        }`}
                      >
                        Absoluter Wert
                      </button>
                    </div>

                    {metricMode === "ratio" ? (
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                        <Select value={numerator} onValueChange={(v) => v && setNumerator(v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Zähler" /></SelectTrigger>
                          <SelectContent>
                            {numericColumns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground">÷</span>
                        <Select value={denominator} onValueChange={(v) => v && setDenominator(v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Nenner" /></SelectTrigger>
                          <SelectContent>
                            {numericColumns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        <Select items={AGGREGATE_OPTIONS} value={aggregateMethod} onValueChange={(v) => v && setAggregateMethod(v as AggregateMethod)}>
                          <SelectTrigger className="h-8 text-xs w-28 shrink-0"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {AGGREGATE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {aggregateMethod !== "count" && (
                          <Select value={aggregateColumn} onValueChange={(v) => v && setAggregateColumn(v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Spalte" /></SelectTrigger>
                            <SelectContent>
                              {numericColumns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )}
                    {metricMode === "aggregate" && aggregateMethod !== "count" && (
                      <p className="text-[11px] text-muted-foreground">
                        Absolute Werte eignen sich selten zum Einfärben – ein großes Gebiet hat immer mehr von allem. Ein Verhältnis ist meist aussagekräftiger.
                      </p>
                    )}
                  </div>
                )}

                <button
                  onClick={handleJoin}
                  disabled={!canJoin}
                  className="w-full h-8 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
                >
                  {isJoining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  Jetzt verknüpfen
                </button>
              </>
            )}

            {result && <JoinReportView report={result.report} resultLabel={result.label} />}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
