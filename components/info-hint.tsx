"use client";

import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Info-Symbol neben einem Widget-Titel, das Fachbegriffe in Alltagssprache
 * erklärt. Öffnet beim Überfahren und per Klick bzw. Tippen (Touch-Geräte).
 */
export function InfoHint({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        aria-label={`Erklärung: ${title}`}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 text-xs leading-relaxed">
        <p className="font-semibold text-sm">{title}</p>
        <div className="text-muted-foreground space-y-1.5">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
