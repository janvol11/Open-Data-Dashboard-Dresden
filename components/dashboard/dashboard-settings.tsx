"use client";

import { useShallow } from "zustand/react/shallow";
import { useDashboardStore } from "@/store/useDashboardStore";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Settings2, Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { resetOnboardingTour } from "@/components/onboarding-tour";

export const WIDGET_TITLES: Record<string, string> = {
  map: "Karte",
  temporal: "Zeitreihenanalyse",
  visual_analytics: "Attribut-Verteilung",
  data_quality: "Datenqualität",
  correlation: "Korrelationsanalyse",
  attribute_table: "Attributtabelle",
};

export function DashboardSettings() {
  const { widgetOrder, hiddenWidgets, toggleWidgetVisibility } = useDashboardStore(
    useShallow((s) => ({
      widgetOrder: s.widgetOrder,
      hiddenWidgets: s.hiddenWidgets,
      toggleWidgetVisibility: s.toggleWidgetVisibility,
    }))
  );

  const handleRestartTour = () => {
    // Über den Helfer statt direkt über den localStorage-Key, der bleibt
    // allein in onboarding-tour.tsx definiert
    resetOnboardingTour();
    toast.success("Tour zurückgesetzt", {
      description: "Beim nächsten Laden startet die Einführungstour neu.",
      action: {
        label: "Jetzt neu laden",
        onClick: () => window.location.reload(),
      },
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger id="tour-view-settings" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3 gap-1.5 hidden md:flex">
        <Settings2 className="h-4 w-4" />
        Ansicht
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Widgets anzeigen</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {widgetOrder.map((widgetId) => {
            const isVisible = !hiddenWidgets.includes(widgetId);
            return (
              <DropdownMenuItem
                key={widgetId}
                onClick={() => toggleWidgetVisibility(widgetId)}
                className="flex items-center gap-2 cursor-pointer"
              >
                <div className="w-4 h-4 flex items-center justify-center">
                  {isVisible && <Check className="h-4 w-4" />}
                </div>
                <span>{WIDGET_TITLES[widgetId] || widgetId}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>Einführung</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={handleRestartTour}
            className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Tour neu starten</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
