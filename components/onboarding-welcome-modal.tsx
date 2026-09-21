"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Map,
  BarChart3,
  Share2,
  Lightbulb,
  ArrowRight,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: Map,
    color: "bg-blue-500/15 text-blue-500",
    title: "Geodaten visualisieren",
    desc: "WFS-Datensätze der Stadt Dresden direkt auf der interaktiven Karte erkunden.",
  },
  {
    icon: BarChart3,
    color: "bg-violet-500/15 text-violet-500",
    title: "Muster analysieren",
    desc: "Zeitreihen, Korrelationen und Datenqualität automatisch auswerten lassen.",
  },
  {
    icon: Lightbulb,
    color: "bg-amber-500/15 text-amber-500",
    title: "Automatische Vorschläge",
    desc: "Regelbasierte Auswertung von Attributen und Geometrie empfiehlt passende Visualisierungen.",
  },
  {
    icon: Share2,
    color: "bg-emerald-500/15 text-emerald-500",
    title: "Workspace teilen",
    desc: "Konfiguration per Link an Kolleg:innen weitergeben – inkl. Layer & Filter.",
  },
];

interface OnboardingWelcomeModalProps {
  onStartTour: () => void;
  onDismiss: () => void;
}

export function OnboardingWelcomeModal({
  onStartTour,
  onDismiss,
}: OnboardingWelcomeModalProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Kleine Verzögerung, damit die Seite zuerst rendert
    const t = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm"
            onClick={onDismiss}
          />

          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="fixed inset-0 z-[10000] flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="pointer-events-auto w-full max-w-md bg-card border shadow-2xl rounded-2xl overflow-hidden">

              <div className="relative bg-gradient-to-br from-blue-600 via-violet-600 to-indigo-700 px-6 pt-8 pb-6 text-white overflow-hidden">
                <div className="absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/10" />
                <div className="absolute -bottom-4 -left-4 h-24 w-24 rounded-full bg-white/5" />

                <button
                  onClick={onDismiss}
                  className="absolute top-3 right-3 p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Schließen"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="relative flex items-center gap-3 mb-4">
                  <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-white/20 backdrop-blur-sm shadow-inner">
                    <Map className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-white/70 uppercase tracking-widest">
                      Dresden
                    </div>
                    <h2 className="text-xl font-bold leading-tight">
                      Data Workspace
                    </h2>
                  </div>
                </div>

                <p className="text-sm text-white/80 leading-relaxed">
                  Erkunde offene Geodaten der Landeshauptstadt Dresden —
                  visualisiere, analysiere und teile Erkenntnisse in Sekunden.
                </p>
              </div>

              <div className="px-5 py-4 grid grid-cols-2 gap-3">
                {FEATURES.map((f) => {
                  const Icon = f.icon;
                  return (
                    <div
                      key={f.title}
                      className="flex flex-col gap-1.5 p-3 rounded-xl bg-muted/40 border border-border/60"
                    >
                      <div
                        className={`flex items-center justify-center h-8 w-8 rounded-lg ${f.color}`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <p className="text-xs font-semibold text-foreground leading-tight">
                        {f.title}
                      </p>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        {f.desc}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="px-5 pb-5 flex flex-col gap-2">
                <Button
                  className="w-full gap-2 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 text-white shadow-md"
                  onClick={onStartTour}
                >
                  Interaktive Tour starten
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground hover:text-foreground text-sm"
                  onClick={onDismiss}
                >
                  Direkt loslegen
                </Button>
              </div>

              <div className="flex items-center justify-center gap-1.5 pb-4">
                <div className="h-1.5 w-4 rounded-full bg-primary" />
                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
