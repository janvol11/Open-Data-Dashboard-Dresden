// Räumliche Ebenen, auf die sich Dresdner Statistiktabellen beziehen, und
// wie ihre Schlüssel für den Join aufbereitet werden. NodeIds, Layer- und
// Feldnamen stammen aus kommisdd.dresden.de, die Schreibweisen der Schlüssel
// aus der Landtagswahl-Tabelle (1999 ff.).

// Kombinierende diakritische Zeichen, wie sie nach normalize("NFD") übrig bleiben
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** "Schönfeld" → "Schonfeld" */
function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "");
}

/** Kleinschreibung, ohne Akzente, einfache Leerzeichen */
function normalizeName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return stripDiacritics(trimmed.toLowerCase()).replace(/\s+/g, " ");
}

/** "01 Innere Altstadt" → "01", "4 Wilsdruffer Vorstadt" → "04" */
function normalizeStadtteilKey(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,3})/);
  if (!match) return null;
  return match[1].padStart(2, "0");
}

/**
 * "StB 3 Klotzsche/nördliche Ortschaften" → "klotzsche". Präfix und die nach
 * "/" oder "," angehängten Ortschaften fallen weg.
 */
function normalizeStadtbezirkKey(raw: string): string | null {
  const withoutPrefix = raw.trim().replace(/^StB\s*\d+\s*/i, "");
  const core = withoutPrefix.split(/[/,]/)[0];
  return normalizeName(core);
}

export interface GeometrySource {
  /** NodeId bei kommisdd.dresden.de */
  nodeId: number;
  typeName: string;
  /** Join-Schlüssel in der Geometrie */
  keyField: string;
  /** Name für die Anzeige */
  nameField: string;
  /** Erwartete Anzahl; weicht sie ab, warnt der Join-Dialog */
  featureCount: number;
}

export interface Bezugsebene {
  id: string;
  label: string;
  /** Passt auf Spaltennamen dieser Ebene */
  columnPattern: RegExp;
  /** Bringt Tabellen- und Geometriewerte auf dieselbe Form, null wenn unbrauchbar */
  normalizeKey: (raw: string) => string | null;
  /** null = keine Geometrie veröffentlicht (Stadtraum) */
  geometry: GeometrySource | null;
  note?: string;
}

export const BEZUGSEBENEN: Bezugsebene[] = [
  {
    id: "stadtteil",
    label: "Stadtteil",
    columnPattern: /stadtteil/i,
    normalizeKey: normalizeStadtteilKey,
    geometry: {
      nodeId: 188,
      typeName: "cls:L137",
      keyField: "blocknr",
      nameField: "bez",
      featureCount: 64,
    },
    note: "Verknüpft über die Nummer. Tabellen kürzen lange Stadtteilnamen gern ab, über den Namen gingen deshalb Treffer verloren.",
  },
  {
    id: "stadtbezirk",
    label: "Stadtbezirk / Ortschaft",
    columnPattern: /stadtbezirk|ortsamt|ortschaft/i,
    normalizeKey: normalizeStadtbezirkKey,
    geometry: {
      nodeId: 190,
      typeName: "cls:L139",
      keyField: "bez",
      nameField: "bez",
      featureCount: 19,
    },
    note: 'Ein gemeinsamer Layer für beide: 10 Objekte mit art="Stadtbezirk", 9 mit art="Ortschaft". Es gibt keine Nummer, verknüpft wird über den Namen.',
  },
  {
    id: "statistischer_bezirk",
    label: "Statistischer Bezirk",
    columnPattern: /statistische[rn]?\s*bezirk/i,
    normalizeKey: normalizeName,
    geometry: {
      nodeId: 189,
      typeName: "cls:L138",
      keyField: "bez",
      nameField: "bez_lang",
      featureCount: 401,
    },
    note: "Die 401 Bezirke tragen auch stadtteilnummer und stadtbezirk. Darüber lässt sich eine feinere Tabelle auf Stadtteile oder Stadtbezirke hochrechnen.",
  },
  {
    id: "stadtraum",
    label: "Stadtraum",
    columnPattern: /stadtraum/i,
    normalizeKey: normalizeName,
    geometry: null,
    note:
      "Für Stadträume gibt es keine veröffentlichte Geometrie. Die 18 Stadträume liegen quer zu Stadtteilen und Stadtbezirken, teils mit Ausnahmen wie „mit“ bzw. „ohne Sternhäuser, Am Koitschgraben“. " +
      "Welcher Stadtteil gemeint ist, lässt sich daraus nicht sicher ableiten, deshalb bietet das Dashboard hier keine Verknüpfung an.",
  },
];

export function detectBezugsebene(columnName: string): Bezugsebene | null {
  return BEZUGSEBENEN.find((ebene) => ebene.columnPattern.test(columnName)) ?? null;
}
