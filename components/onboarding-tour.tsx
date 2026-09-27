"use client";

import { useState, useEffect, useCallback } from "react";
import { Joyride, STATUS, type EventData, type Step } from "react-joyride";
import { useTheme } from "next-themes";
import { OnboardingWelcomeModal } from "@/components/onboarding-welcome-modal";

/** Tooltip ist ca. 210 px hoch, plus Abstand */
const TOOLTIP_SPACE = 260;

/** Nächster Vorfahre mit eigenem Scrollbereich */
function findScrollParent(element: Element): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
  }
  return null;
}

/**
 * Scrollt das Ziel selbst ins Bild. react-joyride scrollt den inneren
 * Container der Widgets nicht zuverlässig mit. Je nach Platzierung bleibt
 * über oder unter dem Ziel Platz für den Tooltip.
 */
function scrollTargetIntoView(selector: string, placement: Step["placement"]): () => Promise<void> {
  return () =>
    new Promise((resolve) => {
      const element = document.querySelector(selector);
      const scroller = element ? findScrollParent(element) : null;

      if (element && scroller) {
        const target = element.getBoundingClientRect();
        const view = scroller.getBoundingClientRect();
        if (placement === "top") {
          scroller.scrollTop += target.top - (view.top + TOOLTIP_SPACE);
        } else if (placement === "bottom") {
          scroller.scrollTop += target.bottom - (view.bottom - TOOLTIP_SPACE);
        } else {
          scroller.scrollTop += target.top + target.height / 2 - (view.top + view.height / 2);
        }
      }

      // Zwei Frames, bis das Layout die neue Position kennt
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

const STEP_DEFINITIONS: Step[] = [
  {
    target: "#tour-sidebar",
    title: "Daten auswählen",
    content:
      "Unter „Highlights“ liegen fertig ausgewählte Datensätze, unter „Suche & Katalog“ die Geodienste der Stadt. Eigene CSV-Dateien kannst du dort ebenfalls laden.",
    skipBeacon: true,
    placement: "right",
  },
  {
    target: "#tour-layer-panel",
    title: "Layer verwalten",
    content:
      "Jeder geladene Datensatz wird ein eigener Layer. Hier stellst du Deckkraft, Heatmap und Einfärbung ein oder blendest ihn aus. Der Stern legt fest, welcher Layer in die Diagramme eingeht.",
    placement: "right",
    skipBeacon: true,
  },
  {
    target: "#tour-map",
    title: "Karte erkunden",
    content:
      "Ein Klick auf ein Objekt zeigt seine Attribute. Die Diagramme darunter beziehen sich immer auf den sichtbaren Kartenausschnitt.",
    // Neben der Karte ist kein Platz, sie ist volle Breite
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: "#tour-temporal",
    title: "Zeitreihenanalyse",
    content:
      "Hat der Datensatz ein Datum oder eine Jahreszahl, siehst du hier die Entwicklung über die Zeit, als Balken oder Linie.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: "#tour-analytics",
    title: "Diagramme & Filter",
    content:
      "Ein Klick auf einen Balken filtert Karte, Tabelle und die anderen Diagramme auf diesen Wert. Ein zweiter Klick hebt den Filter wieder auf.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: "#tour-data-quality",
    title: "Datenqualität prüfen",
    content:
      "Zeigt für jedes Attribut, wie viele Einträge ausgefüllt sind. Lückenhafte Felder fallen so schnell auf.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: "#tour-correlation",
    title: "Korrelationsanalyse",
    content:
      "Die Matrix zeigt, wie stark Zahlenwerte zusammenhängen. Ein Klick auf eine Zelle öffnet das passende Streudiagramm.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: "#tour-attribute-table",
    title: "Attributtabelle",
    content:
      "Die Rohdaten des aktiven Datensatzes, auch von CSV-Tabellen ohne Geometrie. Wie die Diagramme folgt die Tabelle dem Kartenausschnitt.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: "#tour-view-settings",
    title: "Ansicht anpassen",
    content:
      "Unter „Ansicht“ blendest du einzelne Widgets ein und aus. Dort lässt sich auch diese Tour neu starten.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: "#tour-share",
    title: "Workspace teilen",
    content:
      "„Teilen“ kopiert einen Link mit deinen Layern, Filtern und Diagramm-Einstellungen. Der Link zeigt auf deinen Rechner. Wer das Dashboard selbst laufen hat, kann ihn dort öffnen.",
    placement: "bottom",
    skipBeacon: true,
  },
];

const TOUR_STEPS: Step[] = STEP_DEFINITIONS.map((step) =>
  typeof step.target === "string"
    ? { ...step, skipScroll: true, before: scrollTargetIntoView(step.target, step.placement) }
    : step
);

const STORAGE_KEY = "dresden-dashboard-tour-completed";

// Sind Website-Daten blockiert, wirft schon der Zugriff auf localStorage.
// Die Tour gilt dann als gesehen und erscheint nicht bei jedem Aufruf neu.
function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return true;
  }
}

function markTourSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // blockiert, siehe oben
  }
}

// Feste Farben, das Joyride-Overlay sieht unsere CSS-Variablen nicht
const TOUR_PALETTES = {
  light: {
    background: "#ffffff",
    text: "#0f172a",
    body: "#475569",
    muted: "#94a3b8",
    border: "#f1f5f9",
    overlay: "rgba(0, 0, 0, 0.55)",
  },
  dark: {
    background: "#1e293b",
    text: "#f1f5f9",
    body: "#cbd5e1",
    muted: "#94a3b8",
    border: "#334155",
    overlay: "rgba(0, 0, 0, 0.7)",
  },
} as const;

export function OnboardingTour() {
  const { resolvedTheme } = useTheme();
  const palette = resolvedTheme === "dark" ? TOUR_PALETTES.dark : TOUR_PALETTES.light;
  const [isMounted, setIsMounted] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [runTour, setRunTour] = useState(false);
  const [activeSteps, setActiveSteps] = useState<Step[]>(TOUR_STEPS);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
    if (!hasSeenTour()) {
      const t = setTimeout(() => setShowWelcome(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  const startTour = useCallback(() => {
    setShowWelcome(false);
    setRunTour(false);
    // Kurz warten, bis das Modal weg ist
    setTimeout(() => {
      // Nur Schritte mit sichtbarem Ziel, damit "2 von 7" stimmt. Das Layer-Panel
      // gibt es erst nach dem ersten Datensatz, "Ansicht" erst ab md.
      setActiveSteps(
        TOUR_STEPS.filter((step) => {
          if (typeof step.target !== "string") return true;
          const element = document.querySelector(step.target);
          return element !== null && element.getClientRects().length > 0;
        })
      );
      setRunTour(true);
    }, 400);
  }, []);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    markTourSeen();
  }, []);

  // Unkontrolliert (ohne stepIndex): Im kontrollierten Modus bleibt
  // react-joyride 3.1 bei Schritten hängen, die erst gescrollt werden müssen.
  const handleJoyrideCallback = useCallback((data: EventData) => {
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
      setRunTour(false);
      markTourSeen();
    }
  }, []);

  if (!isMounted) return null;

  return (
    <>
      {showWelcome && (
        <OnboardingWelcomeModal onStartTour={startTour} onDismiss={dismissWelcome} />
      )}

      <Joyride
        onEvent={handleJoyrideCallback}
        continuous
        run={runTour}
        steps={activeSteps}
        options={{
          zIndex: 10000,
          primaryColor: "#6366f1",
          textColor: palette.text,
          backgroundColor: palette.background,
          overlayColor: palette.overlay,
          arrowColor: palette.background,
          showProgress: true,
          buttons: ["back", "primary", "skip"],
          overlayClickAction: false,
          spotlightRadius: 12,
        }}
        styles={{
          tooltip: {
            borderRadius: "14px",
            fontFamily: "inherit",
            padding: "0px",
            boxShadow:
              "0 20px 40px -8px rgba(0, 0, 0, 0.18), 0 8px 16px -4px rgba(0, 0, 0, 0.10)",
            maxWidth: "340px",
          },
          tooltipContainer: {
            textAlign: "left",
            padding: "0px",
          },
          tooltipTitle: {
            fontSize: "15px",
            fontWeight: 700,
            padding: "16px 20px 0 20px",
            color: palette.text,
            lineHeight: "1.3",
          },
          tooltipContent: {
            fontSize: "13px",
            lineHeight: 1.55,
            color: palette.body,
            padding: "8px 20px 4px 20px",
          },
          tooltipFooter: {
            padding: "12px 20px 16px 20px",
            borderTop: `1px solid ${palette.border}`,
            marginTop: "12px",
          },
          // heißt seit v3 buttonPrimary
          buttonPrimary: {
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 600,
            padding: "8px 18px",
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            boxShadow: "0 2px 8px rgba(99,102,241,0.35)",
          },
          buttonBack: {
            color: palette.body,
            fontSize: "13px",
            fontWeight: 500,
            marginRight: "10px",
          },
          buttonSkip: {
            color: palette.muted,
            fontSize: "12px",
            fontWeight: 400,
          },
        }}
        locale={{
          back: "← Zurück",
          close: "Schließen",
          last: "✓ Fertig",
          next: "Weiter →",
          nextWithProgress: "Weiter → ({current} von {total})",
          open: "Tour öffnen",
          skip: "Tour überspringen",
        }}
      />
    </>
  );
}

/** Tour beim nächsten Laden wieder zeigen */
export function resetOnboardingTour() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
  }
}
