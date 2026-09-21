"use client";

import { useMemo } from "react";
import { getOverallDataHealth } from "@/lib/stats-utils";
import { useAnalysisData } from "@/hooks/use-analysis-data";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShieldCheck, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";

export function DataQualityReport() {
  // Gefiltert und ausgewertet wird einmal zentral für alle Widgets
  const { geoJsonData, stats } = useAnalysisData();

  const healthScore = useMemo(() => getOverallDataHealth(stats), [stats]);

  if (!geoJsonData || stats.length === 0) {
    return (
      <div className="w-full h-full flex flex-col">
        <h3 className="font-medium text-sm flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-emerald-500" />
          Datenqualität
        </h3>
        <div className="flex-1 rounded-lg border border-dashed flex flex-col items-center justify-center text-muted-foreground text-sm p-4 text-center">
          <ShieldCheck className="h-8 w-8 mb-2 opacity-50" />
          <p>Wähle einen Datensatz aus</p>
          <span className="text-xs opacity-70">Der Health Score wird hier ermittelt</span>
        </div>
      </div>
    );
  }

  let healthColor = "text-emerald-500";
  let HealthIcon = CheckCircle2;
  if (healthScore < 50) {
    healthColor = "text-red-500";
    HealthIcon = AlertTriangle;
  } else if (healthScore < 80) {
    healthColor = "text-amber-500";
    HealthIcon = AlertCircle;
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Qualitätsreport
        </h3>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-background border text-xs font-semibold ${healthColor}`}>
            <HealthIcon className="h-3.5 w-3.5" />
            Score: {Math.round(healthScore)}%
        </div>
      </div>

      <div className="bg-background rounded-lg border flex-1 overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b bg-muted/30 text-xs font-medium grid grid-cols-[1fr_60px] gap-2">
          <span>Attribut</span>
          <span className="text-right">Füllgrad</span>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-1">
            {stats.map((stat) => {
              const completeness = 100 - stat.nullPercentage;
              let progressColor = "bg-emerald-500";
              if (completeness < 50) progressColor = "bg-red-500";
              else if (completeness < 80) progressColor = "bg-amber-500";

              return (
                <div key={stat.name} className="flex flex-col gap-1.5 px-2 py-2.5 hover:bg-muted/50 rounded-md transition-colors">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-medium truncate pr-2" title={stat.name}>{stat.name}</span>
                    <span className="text-muted-foreground">{Math.round(completeness)}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full ${progressColor} transition-all duration-500 ease-out`}
                      style={{ width: `${completeness}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
