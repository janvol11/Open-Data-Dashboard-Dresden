"use client";

import { useState, useMemo, useCallback, useEffect, Fragment } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDashboardStore } from "@/store/useDashboardStore";
import { toFiniteNumber } from "@/lib/stats-utils";
import { useAnalysisData } from "@/hooks/use-analysis-data";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TrendingUp, ArrowRightLeft, Grid3X3, MousePointerClick } from "lucide-react";
import { InfoHint } from "@/components/info-hint";

function pearsonR(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX, dy = ys[i] - meanY;
    cov += dx * dy; varX += dx * dx; varY += dy * dy;
  }
  const denom = Math.sqrt(varX * varY);
  return denom === 0 ? null : cov / denom;
}

function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: meanY - slope * meanX };
}

/** Extrahiert Zahlenwert-Paare zweier Attribute; ein Feature zählt nur, wenn beide Werte vorhanden sind. */
function extractPairs(features: GeoJSON.Feature[], attrA: string, attrB: string) {
  const xs: number[] = [], ys: number[] = [];
  features.forEach((f) => {
    if (!f.properties) return;
    const x = toFiniteNumber(f.properties[attrA]);
    const y = toFiniteNumber(f.properties[attrB]);
    if (x !== null && y !== null) { xs.push(x); ys.push(y); }
  });
  return { xs, ys };
}

/** CSS-Farbe für r ∈ [-1, 1]: |r| steuert Sättigung/Helligkeit, Vorzeichen den Farbton (0 → weiß, +1 → Violett, −1 → Rot). */
function heatmapColor(r: number | null, isDiag = false): string {
  if (isDiag) return "hsl(220 15% 92%)";
  if (r === null) return "hsl(220 10% 88%)";

  const abs = Math.abs(r);
  if (r >= 0) {
    // weiß → violett
    const l = Math.round(96 - abs * 46);
    const s = Math.round(abs * 83);
    return `hsl(263 ${s}% ${l}%)`;
  } else {
    // weiß → rot
    const l = Math.round(96 - abs * 50);
    const s = Math.round(abs * 76);
    return `hsl(4 ${s}% ${l}%)`;
  }
}

function heatmapTextColor(r: number | null, isDiag = false): string {
  if (isDiag) return "hsl(220 15% 45%)";
  if (r === null) return "hsl(220 10% 55%)";
  const abs = Math.abs(r);
  return abs >= 0.5 ? "white" : "hsl(220 15% 20%)";
}

function correlationLabel(r: number | null): string {
  if (r === null) return "Keine Daten";
  const abs = Math.abs(r);
  const dir = r >= 0 ? "positive" : "negative";
  if (abs >= 0.9) return `Sehr starke ${dir} Korrelation`;
  if (abs >= 0.7) return `Starke ${dir} Korrelation`;
  if (abs >= 0.4) return `Moderate ${dir} Korrelation`;
  if (abs >= 0.2) return `Schwache ${dir} Korrelation`;
  return "Kein linearer Zusammenhang";
}

function badgeClasses(r: number | null) {
  if (r === null) return { text: "text-muted-foreground", bg: "bg-muted/30", border: "border-muted" };
  const abs = Math.abs(r);
  if (abs >= 0.7) return { text: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-950/40", border: "border-violet-200 dark:border-violet-800" };
  if (abs >= 0.4) return { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/40", border: "border-amber-200 dark:border-amber-800" };
  return { text: "text-slate-500 dark:text-slate-400", bg: "bg-slate-50 dark:bg-slate-950/40", border: "border-slate-200 dark:border-slate-700" };
}

interface ScatterTooltipProps {
  active?: boolean;
  payload?: { payload?: { x: number; y: number } }[];
  xAttr: string;
  yAttr: string;
}

function ScatterTooltip({ active, payload, xAttr, yAttr }: ScatterTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const fmt = (v: number) => v.toLocaleString("de-DE", { maximumFractionDigits: 3 });
  return (
    <div className="rounded-lg border bg-card/95 backdrop-blur-sm px-3 py-2 shadow-lg text-xs space-y-0.5">
      <p className="font-semibold text-foreground mb-1">Datenpunkt</p>
      <p className="text-muted-foreground"><span className="font-medium text-foreground">{xAttr}:</span> {fmt(d.x)}</p>
      <p className="text-muted-foreground"><span className="font-medium text-foreground">{yAttr}:</span> {fmt(d.y)}</p>
    </div>
  );
}

interface MatrixProps {
  attrs: string[];
  matrix: Map<string, number | null>;
  selectedX: string;
  selectedY: string;
  onSelect: (x: string, y: string) => void;
}

function CorrelationMatrix({ attrs, matrix, selectedX, selectedY, onSelect }: MatrixProps) {
  const [hovered, setHovered] = useState<{ row: string; col: string } | null>(null);

  // Abkürzung langer Attributnamen
  const short = (name: string) => name.length > 8 ? name.slice(0, 7) + "…" : name;
  const cellKey = (a: string, b: string) => `${a}|||${b}`;

  return (
    <div className="flex flex-col gap-1.5 h-full">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Grid3X3 className="h-3.5 w-3.5" />
        <span>Korrelationsmatrix</span>
        <span className="ml-auto text-[10px] opacity-60 flex items-center gap-1">
          <MousePointerClick className="h-3 w-3" /> Zelle anklicken
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        <div
          className="grid gap-0.5"
          style={{ gridTemplateColumns: `auto repeat(${attrs.length}, minmax(0, 1fr))` }}
        >
          <div />
          {attrs.map((col) => (
            <div
              key={col}
              title={col}
              className="text-center text-[9px] font-medium text-muted-foreground px-0.5 pb-1 truncate"
            >
              {short(col)}
            </div>
          ))}

          {attrs.map((row) => (
            <Fragment key={row}>
              <div
                key={`label-${row}`}
                title={row}
                className="text-[9px] font-medium text-muted-foreground pr-1.5 flex items-center justify-end truncate max-w-[60px]"
              >
                {short(row)}
              </div>

              {attrs.map((col) => {
                const isDiag = row === col;
                const r = isDiag ? 1 : matrix.get(cellKey(row, col)) ?? null;
                const isSelected =
                  (selectedX === col && selectedY === row) ||
                  (selectedX === row && selectedY === col);
                const isHov = hovered?.row === row && hovered?.col === col;

                return (
                  <button
                    key={`${row}-${col}`}
                    title={isDiag ? row : `${col} ↔ ${row}: r = ${r?.toFixed(3) ?? "n/a"}`}
                    disabled={isDiag}
                    onClick={() => !isDiag && onSelect(col, row)}
                    onMouseEnter={() => setHovered({ row, col })}
                    onMouseLeave={() => setHovered(null)}
                    className="relative aspect-square rounded-[3px] flex items-center justify-center transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-violet-400"
                    style={{
                      backgroundColor: heatmapColor(isDiag ? 1 : r, isDiag),
                      color: heatmapTextColor(isDiag ? 1 : r, isDiag),
                      opacity: isDiag ? 0.55 : 1,
                      transform: isHov && !isDiag ? "scale(1.08)" : "scale(1)",
                      boxShadow: isSelected
                        ? "0 0 0 2px #8b5cf6, 0 0 0 4px rgba(139,92,246,0.25)"
                        : isHov && !isDiag
                        ? "0 2px 8px rgba(0,0,0,0.18)"
                        : "none",
                      zIndex: isHov ? 10 : 1,
                    }}
                  >
                    <span className="text-[8px] font-bold leading-none tabular-nums select-none">
                      {isDiag ? "1" : r !== null ? r.toFixed(2) : "—"}
                    </span>
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <span className="text-[9px] text-muted-foreground">−1</span>
        <div
          className="flex-1 h-2 rounded-full"
          style={{
            background: "linear-gradient(to right, hsl(4 76% 46%), hsl(4 38% 73%), hsl(220 10% 95%), hsl(263 42% 73%), hsl(263 83% 50%))",
          }}
        />
        <span className="text-[9px] text-muted-foreground">+1</span>
      </div>
    </div>
  );
}

export function CorrelationScatterplot() {
  const { correlationX, correlationY, setCorrelationAttributes } = useDashboardStore(
    useShallow((s) => ({
      correlationX: s.correlationX,
      correlationY: s.correlationY,
      setCorrelationAttributes: s.setCorrelationAttributes,
    }))
  );

  // Gefiltert und ausgewertet wird einmal zentral für alle Widgets
  const { geoJsonData, dataToAnalyze, stats } = useAnalysisData();

  const numericStats = useMemo(() => stats.filter((s) => s.type === "number"), [stats]);

  const attrs = useMemo(() => numericStats.map((s) => s.name), [numericStats]);

  useEffect(() => {
    if (attrs.length >= 2) {
      if (!correlationX || !attrs.includes(correlationX) || !correlationY || !attrs.includes(correlationY)) {
        setCorrelationAttributes(attrs[0], attrs[1]);
      }
    } else if (attrs.length === 1) {
      if (!correlationX || !correlationY) {
        setCorrelationAttributes(attrs[0], attrs[0]);
      }
    }
  }, [attrs, correlationX, correlationY, setCorrelationAttributes]);

  // Nur oberes Dreieck berechnen, dann gespiegelt
  const corrMatrix = useMemo(() => {
    const map = new Map<string, number | null>();
    if (!dataToAnalyze) return map;
    const features = dataToAnalyze.features;
    for (let i = 0; i < attrs.length; i++) {
      for (let j = i + 1; j < attrs.length; j++) {
        const a = attrs[i], b = attrs[j];
        const { xs, ys } = extractPairs(features, a, b);
        const r = pearsonR(xs, ys);
        map.set(`${a}|||${b}`, r);
        map.set(`${b}|||${a}`, r);
      }
    }
    return map;
  }, [dataToAnalyze, attrs]);

  const { scatterData, xs, ys } = useMemo(() => {
    if (!dataToAnalyze || !correlationX || !correlationY) return { scatterData: [], xs: [], ys: [] };
    const { xs, ys } = extractPairs(dataToAnalyze.features, correlationX, correlationY);
    return { scatterData: xs.map((x, i) => ({ x, y: ys[i] })), xs, ys };
  }, [dataToAnalyze, correlationX, correlationY]);

  const r = useMemo(() => pearsonR(xs, ys), [xs, ys]);
  const regression = useMemo(() => linearRegression(xs, ys), [xs, ys]);

  const trendlinePoints = useMemo(() => {
    if (!regression || xs.length < 2) return null;
    // Schleife statt Math.min(...xs): Der Spread wirft ab rund 100.000 Werten
    // (große CSV-Importe) einen RangeError, weil jedes Element ein Argument wird
    let minX = Infinity, maxX = -Infinity;
    for (const x of xs) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    return [
      { x: minX, y: regression.slope * minX + regression.intercept },
      { x: maxX, y: regression.slope * maxX + regression.intercept },
    ];
  }, [regression, xs]);

  const handleMatrixSelect = useCallback((col: string, row: string) => {
    setCorrelationAttributes(col, row);
  }, [setCorrelationAttributes]);

  const tickFmt = (v: number) =>
    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
    : v >= 1000 ? `${(v / 1000).toFixed(1)}k`
    : v.toFixed(0);

  const badge = badgeClasses(r);

  if (!geoJsonData || attrs.length === 0) {
    return (
      <div className="w-full h-full flex flex-col">
        <h3 className="font-medium text-sm flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-violet-500" />
          Korrelationsanalyse
        </h3>
        <div className="flex-1 rounded-lg border border-dashed flex flex-col items-center justify-center text-muted-foreground text-sm">
          <TrendingUp className="h-8 w-8 mb-2 opacity-50" />
          <p>Wähle einen Datensatz aus</p>
          <span className="text-xs opacity-70">Streudiagramm und Matrix erscheinen für Zahlenwerte</span>
        </div>
      </div>
    );
  }

  if (attrs.length < 2) {
    return (
      <div className="w-full h-full flex flex-col">
        <h3 className="font-medium text-sm flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-violet-500" />
          Korrelationsanalyse
        </h3>
        <div className="flex-1 rounded-lg border border-dashed flex flex-col items-center justify-center text-muted-foreground text-sm p-4 text-center">
          <TrendingUp className="h-8 w-8 mb-2 opacity-40" />
          <p>Nicht genug numerische Attribute</p>
          <span className="text-xs opacity-70 mt-1">
            Mindestens 2 numerische Attribute werden benötigt
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium text-sm flex items-center gap-2 mr-auto">
          <TrendingUp className="h-4 w-4 text-violet-500" />
          Korrelationsanalyse
          <InfoHint title="Korrelationsanalyse">
            <p>Prüft, ob zwei Zahlenwerte zusammenhängen, zum Beispiel ob höhere Bäume auch einen dickeren Stamm haben. Jeder Punkt im Streudiagramm ist ein Eintrag.</p>
            <p><strong>Pearson r</strong> fasst den Zusammenhang in einer Zahl zwischen −1 und 1: Nahe 1 steigen beide Werte gemeinsam, nahe −1 sinkt der eine, wenn der andere steigt, um 0 gibt es keinen erkennbaren Zusammenhang.</p>
            <p>Ein Zusammenhang heißt nicht, dass das eine das andere verursacht.</p>
          </InfoHint>
        </h3>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">X:</span>
          <Select value={correlationX || ""} onValueChange={(v) => { if (v) setCorrelationAttributes(v, correlationY || ""); }}>
            <SelectTrigger className="w-[140px] h-8 text-xs bg-background">
              <SelectValue placeholder="X-Attribut" />
            </SelectTrigger>
            <SelectContent>
              {attrs.map((a) => (
                <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <button
          onClick={() => { if(correlationX && correlationY) setCorrelationAttributes(correlationY, correlationX); }}
          title="Achsen tauschen"
          className="h-8 w-8 rounded-md border bg-background hover:bg-muted transition-colors flex items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">Y:</span>
          <Select value={correlationY || ""} onValueChange={(v) => { if (v) setCorrelationAttributes(correlationX || "", v); }}>
            <SelectTrigger className="w-[140px] h-8 text-xs bg-background">
              <SelectValue placeholder="Y-Attribut" />
            </SelectTrigger>
            <SelectContent>
              {attrs.map((a) => (
                <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {r !== null && (
        <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${badge.bg} ${badge.border}`}>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground">Pearson r</span>
            <span className={`text-xl font-bold tabular-nums ${badge.text}`}>{r.toFixed(3)}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <span className={`text-xs font-medium ${badge.text}`}>{correlationLabel(r)}</span>
          {regression && (
            <>
              <div className="h-4 w-px bg-border hidden sm:block" />
              <span className="text-xs text-muted-foreground hidden sm:block tabular-nums">
                y = {regression.slope.toFixed(3)}x {regression.intercept >= 0 ? "+" : "−"} {Math.abs(regression.intercept).toFixed(2)}
              </span>
            </>
          )}
          <div className="ml-auto text-xs text-muted-foreground">{scatterData.length} Punkte</div>
        </div>
      )}

      <div className="flex gap-4" style={{ minHeight: 340 }}>

        <div
          className="rounded-xl border bg-background p-3 flex flex-col shrink-0"
          style={{
            // Matrix-Breite skaliert mit Anzahl Attribute, min 220px
            width: Math.max(220, Math.min(attrs.length * 44 + 72, 420)),
          }}
        >
          <CorrelationMatrix
            attrs={attrs}
            matrix={corrMatrix}
            selectedX={correlationX || ""}
            selectedY={correlationY || ""}
            onSelect={handleMatrixSelect}
          />
        </div>

        <div className="flex-1 min-w-0 rounded-xl border bg-background p-2 flex flex-col">
          {scatterData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
              Keine gültigen Wertepaare gefunden
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 20, left: -10, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="opacity-10" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name={correlationX || ""}
                      tick={{ fontSize: 9 }}
                      tickLine={false}
                      axisLine={false}
                      label={{ value: correlationX, position: "insideBottom", offset: -12, fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      domain={["auto", "auto"]}
                      tickFormatter={tickFmt}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name={correlationY || ""}
                      tick={{ fontSize: 9 }}
                      tickLine={false}
                      axisLine={false}
                      label={{ value: correlationY, angle: -90, position: "insideLeft", offset: 12, fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      domain={["auto", "auto"]}
                      tickFormatter={tickFmt}
                    />
                    <Tooltip
                      content={<ScatterTooltip xAttr={correlationX || ""} yAttr={correlationY || ""} />}
                      cursor={{ strokeDasharray: "3 3", stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.4 }}
                    />

                    <Scatter
                      data={scatterData}
                      fill="#8b5cf6"
                      fillOpacity={0.6}
                      stroke="#7c3aed"
                      strokeWidth={0.5}
                      r={3.5}
                    />

                    {trendlinePoints && (
                      <Scatter
                        data={trendlinePoints}
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth={2}
                        strokeDasharray="6 3"
                        strokeOpacity={0.85}
                        r={0}
                        line
                        lineType="fitting"
                      />
                    )}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              <div className="flex items-center gap-4 mt-1 text-[10px] text-muted-foreground px-2">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-violet-500 opacity-70" />
                  Datenpunkte
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-4 border-t-2 border-dashed border-red-500 opacity-80" />
                  Trendlinie (OLS)
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
