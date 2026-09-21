"use client";

import { useState, useEffect, useCallback } from "react";
import { Joyride, STATUS, type EventData, type Step } from "react-joyride";
import { useTheme } from "next-themes";
import { OnboardingWelcomeModal } from "@/components/onboarding-welcome-modal";

/** Platz, den der Tooltip (ca. 210 px hoch) samt Abstand über bzw. unter seinem Ziel braucht. */
const TOOLTIP_SPACE = 260;

/** Nächster Vorfahre, der selbst scrollt (overflow auto/scroll mit Überlauf), oder null. */
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
 * Scrollt das Ziel eines Schritts selbst passend zur Tooltip-Platzierung ins
 * Bild, bevor Joyride den Tooltip positioniert. Die Widgets liegen in einem
 * eigenen Scroll-Container (Panel mit overflow-y-auto), den react-joyride 3.1
 * nicht zuverlässig mitscrollt – die Tooltips der unteren Widgets lagen sonst
 * außerhalb des sichtbaren Bereichs. Bei "top" bleibt über dem Ziel Platz für
 * den Tooltip, bei "bottom" darunter; ein bloßes Zentrieren reichte bei den
 * hohen Widgets dafür nicht. Das Setzen von scrollTop springt sofort, der Hook
 * muss daher auf kein Scroll-Ende warten (der Browser begrenzt den Wert selbst).
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

      // Zwei Frames warten, bis das Layout die neue Scroll-Position kennt
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

const STEP_DEFINITIONS: Step[] = [
  {
    target: "#tour-sidebar",
    title: "Daten auswählen",
    content:
      "Wähle vorgefertigte Highlights mit einem Klick oder suche im gesamten Dresdner Geodatenkatalog. CSV-Dateien kannst du direkt hochladen.",
    skipBeacon: true,
    placement: "right",
  },
  {
    target: "#tour-layer-panel",
    title: "Layer verwalten",
    content:
      "Jeder geladene Datensatz erscheint hier als eigener Layer. Ändere Farbe, Transparenz, schalte auf Heatmap um oder blende Layer ein/aus.",
    placement: "right",
    skipBeacon: true,
  },
  {
    target: "#tour-map",
    title: "Karte erkunden",
    content:
      "Alle geladenen Daten erscheinen hier. Zoome rein, klicke auf Marker für Details und nutze den Kartenausschnitt als räumlichen Filter für alle Diagramme.",
    // Die Karte ist so breit wie der ganze Bereich – links daneben ist kein Platz
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: "#tour-temporal",
    title: "Zeitreihenanalyse",
    content:
      "Erkenne zeitliche Muster in deinen Daten. Wähle ein Datumsattribut und ein Wertefeld, um Trends über die Zeit als Linien- oder Balkendiagramm zu visualisieren.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: "#tour-analytics",
    title: "Diagramme & Cross-Filtering",
    content:
      "Diagramme passen sich dynamisch an deinen Kartenausschnitt an. Klicke auf Balken oder Segmente, um die Karte weiter einzugrenzen — das sogenannte Cross-Filtering.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: "#tour-data-quality",
    title: "Datenqualität prüfen",
    content:
      "Automatische Auswertung der Vollständigkeit aller Attribute. Erkenne auf einen Blick, welche Felder lückenhafte Daten enthalten.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: "#tour-correlation",
    title: "Korrelationsanalyse",
    content:
      "Das Streudiagramm sucht automatisch nach statistischen Zusammenhängen zwischen numerischen Attributen. Entdecke versteckte Muster in deinen Daten.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: "#tour-attribute-table",
    title: "Attributtabelle",
    content:
      "Hier siehst du die Rohdaten des aktiven Datensatzes Zeile für Zeile – auch reine Tabellen ohne Geometrie. Wie die Diagramme folgt sie dem Kartenausschnitt.",
    placement: "top",
    skipBeacon: true,
  },
  {
    target: "#tour-view-settings",
    title: "Ansicht anpassen",
    content:
      "Unter „Ansicht“ blendest du einzelne Widgets wie Karte, Diagramme oder Attributtabelle ein und aus. Außerdem kannst du hier diese Tour jederzeit neu starten.",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: "#tour-share",
    title: "Workspace teilen",
    content:
      "Mit „Share“ kopierst du einen Link in die Zwischenablage, der deine geladenen Layer, deren Styling, Filter und Diagramm-Einstellungen enthält. Wer den Link öffnet, sieht denselben Workspace.",
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

// Feste Farbwerte, da react-joyride sein Overlay außerhalb des Tailwind-Baums
// rendert und dessen CSS-Variablen nicht kennt
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
    // mounted-Flag synchron im ersten Client-Effect setzen, da der Server
    // localStorage nicht kennt
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
    const hasSeenTour = localStorage.getItem(STORAGE_KEY);
    if (!hasSeenTour) {
      const t = setTimeout(() => setShowWelcome(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  const startTour = useCallback(() => {
    setShowWelcome(false);
    setRunTour(false);
    // Kurze Pause, damit das Modal aus dem DOM verschwindet und der State zurückgesetzt ist
    setTimeout(() => {
      // Nur Schritte behalten, deren Ziel im DOM steht: Das Layer-Panel
      // rendert erst nach dem ersten Datensatz, Widgets lassen sich ausblenden.
      // Ohne diesen Filter überspringt Joyride sie still (TARGET_NOT_FOUND),
      // während die Fortschrittsanzeige sie weiter mitzählt ("2 von 7").
      // getClientRects fängt zusätzlich per CSS versteckte Ziele ab (der
      // "Ansicht"-Button ist unterhalb von md mit display:none ausgeblendet).
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
    localStorage.setItem(STORAGE_KEY, "true");
  }, []);

  // Joyride zählt die Schritte selbst weiter (kein stepIndex von außen): Im
  // kontrollierten Modus hing die Tour an Schritten, die erst ins Bild
  // gescrollt werden müssen – react-joyride 3.1 beendet dort mitunter die
  // Scroll-Phase nicht und meldet beim Klick auf "Weiter" dann kein
  // STEP_AFTER, sodass nur noch das Overlay stehen blieb
  const handleJoyrideCallback = useCallback((data: EventData) => {
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
      setRunTour(false);
      localStorage.setItem(STORAGE_KEY, "true");
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
          // v3: Button-Key heißt "buttonPrimary", nicht mehr "buttonNext"
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

/** Löscht den localStorage-Key, sodass die Tour beim nächsten Reload wieder startet. */
export function resetOnboardingTour() {
  localStorage.removeItem(STORAGE_KEY);
}
