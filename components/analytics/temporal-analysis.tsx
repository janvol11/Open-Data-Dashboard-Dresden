"use client";

import { useMemo, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDashboardStore } from "@/store/useDashboardStore";
import { detectTimeAttributes, aggregateTimeSeries, getRawTimeSeries, TimeSeriesDataPoint, RawTimeSeriesDataPoint } from "@/lib/time-utils";
import { useAnalysisData } from "@/hooks/use-analysis-data";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";

/** Der ValueType, den Recharts an Tooltip-Formatter übergibt. */
type RechartsValueType = number | string | readonly (string | number)[];

// Die Metrik-Auswahl kodiert die Aggregationsart als Präfix ("raw_"/"sum_").
// Abschneiden über die Präfixlänge statt replace(): replace() träfe bei einem
// Attribut wie "sum_flaeche" das falsche Vorkommen im Wert "raw_sum_flaeche".
const RAW_PREFIX = "raw_";
const SUM_PREFIX = "sum_";

const isRawMetric = (metric: string) => metric.startsWith(RAW_PREFIX);
const isSumMetric = (metric: string) => metric.startsWith(SUM_PREFIX);

function stripMetricPrefix(metric: string): string {
  if (isRawMetric(metric)) return metric.slice(RAW_PREFIX.length);
  if (isSumMetric(metric)) return metric.slice(SUM_PREFIX.length);
  return metric;
}
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, BarChart3, Activity } from "lucide-react";
import { InfoHint } from "@/components/info-hint";

export function TemporalAnalysis() {
  // Gefiltert und ausgewertet wird einmal zentral für alle Widgets
  const { geoJsonData, dataToAnalyze, stats } = useAnalysisData();

  const timeAttributes = useMemo(() => {
    if (!dataToAnalyze) return [];
    return detectTimeAttributes(dataToAnalyze);
  }, [dataToAnalyze]);

  const numericAttributes = useMemo(
    () => stats.filter(s => s.type === "number").map(s => s.name),
    [stats]
  );

  const metricOptions = useMemo(
    () => [
      { value: "__count", label: "Einträge (Anzahl)" },
      ...numericAttributes.map((a) => ({ value: `raw_${a}`, label: `Einzelwerte: ${a}` })),
      ...numericAttributes.map((a) => ({ value: `sum_${a}`, label: `Summe: ${a}` })),
    ],
    [numericAttributes]
  );

  const { temporalAttribute, temporalValueAttr, temporalChartType, setTemporalConfig } = useDashboardStore(
    useShallow((s) => ({
      temporalAttribute: s.temporalAttribute,
      temporalValueAttr: s.temporalValueAttr,
      temporalChartType: s.temporalChartType,
      setTemporalConfig: s.setTemporalConfig,
    }))
  );

  const selectedTimeAttr = temporalAttribute || "";
  const selectedValueAttr = temporalValueAttr || "__count";
  const chartType = temporalChartType || "bar";

  const setSelectedTimeAttr = (val: string | null) => setTemporalConfig(val, selectedValueAttr, chartType);
  const setSelectedValueAttr = (val: string | null) => setTemporalConfig(selectedTimeAttr, val, chartType);
  const setChartType = (val: "bar" | "line") => setTemporalConfig(selectedTimeAttr, selectedValueAttr, val);

  useEffect(() => {
    if (timeAttributes.length > 0 && (!selectedTimeAttr || !timeAttributes.includes(selectedTimeAttr))) {
      setSelectedTimeAttr(timeAttributes[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeAttributes, selectedTimeAttr]);

  const chartData = useMemo(() => {
    if (!dataToAnalyze || !selectedTimeAttr) return [];

    if (isRawMetric(selectedValueAttr)) {
      return getRawTimeSeries(dataToAnalyze, selectedTimeAttr, stripMetricPrefix(selectedValueAttr));
    }

    if (isSumMetric(selectedValueAttr)) {
      return aggregateTimeSeries(dataToAnalyze, selectedTimeAttr, stripMetricPrefix(selectedValueAttr));
    }

    return aggregateTimeSeries(dataToAnalyze, selectedTimeAttr, null);
  }, [dataToAnalyze, selectedTimeAttr, selectedValueAttr]);

  if (!geoJsonData || timeAttributes.length === 0) {
    return (
      <div className="w-full h-full flex flex-col">
        <h3 className="font-medium text-sm flex items-center gap-2 mb-3">
          <Clock className="h-4 w-4 text-blue-500" />
          Zeitreihenanalyse
        </h3>
        <div className="flex-1 rounded-lg border border-dashed flex flex-col items-center justify-center text-muted-foreground text-sm p-4 text-center">
          <Clock className="h-8 w-8 mb-2 opacity-40" />
          <p>{!geoJsonData ? "Wähle einen Datensatz aus" : "Keine zeitlichen Daten gefunden"}</p>
          <span className="text-xs opacity-70 mt-1">
            Diese Ansicht benötigt Datums- oder Jahresangaben im Datensatz.
          </span>
        </div>
      </div>
    );
  }

  const isRaw = isRawMetric(selectedValueAttr);
  const actualValueAttr = stripMetricPrefix(selectedValueAttr);

  const yAxisLabel = selectedValueAttr === "__count" ? "Anzahl" : (isRaw ? `Einzelwert ${actualValueAttr}` : `Summe ${actualValueAttr}`);
  const dataKey = selectedValueAttr === "__count" ? "count" : (isRaw ? "value" : "sum");

  const tickFmt = (v: number) =>
    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
      : v >= 1000 ? `${(v / 1000).toFixed(1)}k`
        : v.toFixed(0);

  /** Formatiert numerische Tooltip-Werte, lässt andere Typen unverändert. */
  const tooltipFormatter = (value: RechartsValueType | undefined) => {
    const formatted =
      typeof value === "number" && !Number.isInteger(value)
        ? value.toFixed(2)
        : typeof value === "number" || typeof value === "string"
        ? value
        : "";
    return [formatted, yAxisLabel] as [number | string, string];
  };

  return (
    <div className="w-full h-full flex flex-col min-h-[300px]">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="font-medium text-sm flex items-center gap-2 mr-auto">
          <Clock className="h-4 w-4 text-blue-500" />
          Zeitreihenanalyse
          <InfoHint title="Zeitreihenanalyse">
            <p>Zeigt, wie sich die Daten über die Zeit entwickeln, etwa wie viele Bäume pro Jahr gepflanzt wurden.</p>
            <p><strong>Zeitachse</strong> ist die Spalte mit Datum oder Jahr. <strong>Metrik</strong> legt fest, was gezählt wird: die Anzahl der Einträge, die Summe einer Zahlenspalte oder deren Einzelwerte.</p>
          </InfoHint>
        </h3>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">Zeitachse:</span>
          <Select value={selectedTimeAttr} onValueChange={setSelectedTimeAttr}>
            <SelectTrigger className="w-[120px] h-8 text-xs bg-background">
              <SelectValue placeholder="Attribut wählen" />
            </SelectTrigger>
            <SelectContent>
              {timeAttributes.map(a => (
                <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-medium">Metrik:</span>
          <Select items={metricOptions} value={selectedValueAttr} onValueChange={setSelectedValueAttr}>
            <SelectTrigger className="w-[120px] h-8 text-xs bg-background">
              <SelectValue placeholder="Anzahl" />
            </SelectTrigger>
            <SelectContent>
              {metricOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-xs">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex border rounded-md overflow-hidden bg-background">
          <button
            onClick={() => setChartType("bar")}
            className={`p-1.5 transition-colors ${chartType === "bar" ? "bg-muted" : "hover:bg-muted/50"}`}
            title="Balkendiagramm"
          >
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </button>
          <button
            onClick={() => setChartType("line")}
            className={`p-1.5 transition-colors ${chartType === "line" ? "bg-muted" : "hover:bg-muted/50"}`}
            title="Liniendiagramm"
          >
            <Activity className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-background rounded-lg border p-3 flex flex-col min-h-[220px]">
        {chartData.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
            Keine aggregierten Daten verfügbar
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {chartType === "bar" ? (
              <BarChart data={chartData as TimeSeriesDataPoint[]} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="opacity-30" />
                <XAxis
                  dataKey="timeLabel"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  angle={-45}
                  textAnchor="end"
                  height={40}
                />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={tickFmt} />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                  contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={tooltipFormatter}
                />
                <Bar
                  dataKey={dataKey}
                  name={yAxisLabel}
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            ) : isRaw ? (
              <ScatterChart margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="opacity-30" />
                <XAxis
                  dataKey="timeLabel"
                  name="Zeit"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  angle={-45}
                  textAnchor="end"
                  height={40}
                />
                <YAxis
                  dataKey={dataKey}
                  name={yAxisLabel}
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={tickFmt}
                />
                <ZAxis range={[15, 15]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={tooltipFormatter}
                />
                <Scatter
                  data={chartData as RawTimeSeriesDataPoint[]}
                  fill="#3b82f6"
                  fillOpacity={0.6}
                  line={chartType === "line"}
                  lineType="joint"
                />
              </ScatterChart>
            ) : (
              <LineChart data={chartData as TimeSeriesDataPoint[]} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="opacity-30" />
                <XAxis
                  dataKey="timeLabel"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  angle={-45}
                  textAnchor="end"
                  height={40}
                />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={tickFmt} />
                <Tooltip
                  contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={tooltipFormatter}
                />
                <Line
                  type="monotone"
                  dataKey={dataKey}
                  name={yAxisLabel}
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
