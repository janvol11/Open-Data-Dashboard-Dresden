"use client";

import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDashboardStore } from "@/store/useDashboardStore";
import { matchesCategoryValue } from "@/lib/stats-utils";
import { useAnalysisData } from "@/hooks/use-analysis-data";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BarChart3, X } from "lucide-react";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

export function VisualAnalytics() {
  const { chartFilter, setChartFilter, visualAnalyticsAttribute, setVisualAnalyticsAttribute } =
    useDashboardStore(
      useShallow((s) => ({
        chartFilter: s.chartFilter,
        setChartFilter: s.setChartFilter,
        visualAnalyticsAttribute: s.visualAnalyticsAttribute,
        setVisualAnalyticsAttribute: s.setVisualAnalyticsAttribute,
      }))
    );

  // Gefiltert und ausgewertet wird einmal zentral für alle Widgets
  const { geoJsonData, stats } = useAnalysisData();

  useEffect(() => {
    if (!visualAnalyticsAttribute && stats.length > 0) {
      const bestStat = stats.find(s => s.type === "string" && s.uniqueCount > 1 && s.uniqueCount <= 15);
      setVisualAnalyticsAttribute(bestStat ? bestStat.name : stats[0].name);
    }
  }, [stats, visualAnalyticsAttribute, setVisualAnalyticsAttribute]);

  const activeStat = stats.find(s => s.name === visualAnalyticsAttribute) || stats[0];

  if (!geoJsonData || stats.length === 0) {
    return (
      <div className="w-full h-full flex flex-col">
        <h3 className="font-medium text-sm flex items-center gap-2 mb-3">
          <BarChart3 className="h-4 w-4 text-orange-500" />
          Visual Analytics
        </h3>
        <div className="flex-1 rounded-lg border border-dashed flex flex-col items-center justify-center text-muted-foreground text-sm">
          <BarChart3 className="h-8 w-8 mb-2 opacity-50" />
          <p>Wähle einen Datensatz aus</p>
          <span className="text-xs opacity-70">Hier erscheinen dynamische Diagramme</span>
        </div>
      </div>
    );
  }

  const chartData = activeStat?.frequencies || [];
  const isPieChart = chartData.length <= 5 && chartData.length > 0;

  /** Setzt oder löscht den Diagrammfilter für den angeklickten Wert. */
  const applyFilter = (name: string | number | undefined) => {
    if (name !== undefined && activeStat) {
      const isActive =
        chartFilter?.attribute === activeStat.name &&
        matchesCategoryValue(name, chartFilter.value);
      if (isActive) {
        setChartFilter(null);
      } else {
        setChartFilter({ attribute: activeStat.name, value: name });
      }
    }
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-orange-500" />
          Attribut-Verteilung
          {chartFilter && chartFilter.attribute === activeStat?.name && (
            <button
              onClick={() => setChartFilter(null)}
              className="ml-2 flex items-center gap-1 text-[10px] bg-primary/10 text-primary hover:bg-primary/20 px-1.5 py-0.5 rounded-full transition-colors"
            >
              {chartFilter.value}
              <X className="h-3 w-3" />
            </button>
          )}
        </h3>
        <Select value={visualAnalyticsAttribute || ""} onValueChange={setVisualAnalyticsAttribute}>
          <SelectTrigger className="w-[180px] h-8 text-xs bg-background">
            <SelectValue placeholder="Attribut wählen" />
          </SelectTrigger>
          <SelectContent>
            {stats.map(s => (
              <SelectItem key={s.name} value={s.name} className="text-xs">
                {s.name} <span className="text-muted-foreground ml-1">({s.type})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 min-h-0 bg-background rounded-lg border flex flex-col items-center justify-center p-4 overflow-hidden">
        {chartData.length === 0 ? (
          <p className="text-muted-foreground text-xs text-center max-w-[200px]">
            Dieses Attribut {activeStat?.type === 'number' && activeStat.uniqueCount > 20 ? '(stetige Zahlenwerte)' : '(zu viele Einzelwerte)'} eignet sich nicht optimal für eine Häufigkeitsverteilung.
          </p>
        ) : isPieChart ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                onClick={(entry) => applyFilter(entry?.name)}
                className="cursor-pointer"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
                labelLine={false}
                label={({ cx, cy, midAngle, innerRadius, outerRadius, value }: {
                  cx?: number; cy?: number; midAngle?: number;
                  innerRadius?: number; outerRadius?: number; value?: number;
                }) => {
                  if (cx == null || cy == null || midAngle == null ||
                      innerRadius == null || outerRadius == null) return null;
                  const RADIAN = Math.PI / 180;
                  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                  const x = cx + radius * Math.cos(-midAngle * RADIAN);
                  const y = cy + radius * Math.sin(-midAngle * RADIAN);
                  return (
                    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11}>
                      {value}
                    </text>
                  );
                }}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" className="opacity-50" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                angle={-45}
                textAnchor="end"
                height={60}
                interval={0}
              />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Bar
                dataKey="value"
                name="Anzahl"
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
                onClick={(entry) => applyFilter(entry?.name)}
                className="cursor-pointer hover:opacity-80 transition-opacity"
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
